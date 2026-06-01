/**
 * Workflow Engine Plugin
 *
 * 确定性多阶段状态机插件，驱动 Oracle PL/SQL → Spring Boot + MyBatis 翻译工作流。
 * 核心引擎位于 workflow/engine-core.ts。
 *
 * 设计决策：
 *   D4:  confirm 时序（advance 返回 waitingForConfirmation=true 时不激活 agent）
 *   D5:  agent 写 artifact，advance 时从磁盘做 Zod 校验
 *   D8:  advance 流程 result 自动推导
 *   D11: system prompt 精确注入（只注入当前 Phase section）
 */

import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import { WorkflowEngine, type PhaseConfig, type WorkflowRun } from "../workflow/engine-core"
import { SQL2JAVA_WORKFLOW, UPSTREAM_ARTIFACTS } from "../workflow/workflow-definitions"
import { getSchemaForPhase, getPerPackageSchema, getSummarySchema } from "../workflow/artifact-schemas"
import { readFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs"
import { join } from "node:path"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ARTIFACT_DIR = ".workflow-artifacts"

// ---------------------------------------------------------------------------
// Engine Singleton
// ---------------------------------------------------------------------------

const engine = new WorkflowEngine()
engine.registerDefinition(SQL2JAVA_WORKFLOW)

// ---------------------------------------------------------------------------
// Workflow Context — 用于 hooks 中确定当前运行状态
// ---------------------------------------------------------------------------

interface WorkflowContext {
  runId: string
  phase: string
  agentFile: string
  temperature: number
  tools: string[]
}

let currentWorkflowContext: WorkflowContext | null = null

function setWorkflowContext(run: WorkflowRun): void {
  const phaseConfig = SQL2JAVA_WORKFLOW.phases.find(p => p.name === run.currentPhase)
  if (!phaseConfig || !run.currentPhase) {
    currentWorkflowContext = null
    return
  }
  currentWorkflowContext = {
    runId: run.runId,
    phase: run.currentPhase,
    agentFile: phaseConfig.agentFile,
    temperature: phaseConfig.temperature,
    tools: phaseConfig.tools,
  }
}

export function getWorkflowContext(): WorkflowContext | null {
  return currentWorkflowContext
}

// ---------------------------------------------------------------------------
// Artifact Validation (D5)
// ---------------------------------------------------------------------------

interface ValidationResult {
  valid: boolean
  errors?: string[]
}

function validateArtifactOnDisk(artifactsDir: string, phase: string): ValidationResult {
  // Per-package phases: check each package directory
  if (phase === "translate" || phase === "review" || phase === "verify") {
    return validatePerPackageArtifacts(artifactsDir, phase)
  }

  // Fix phase: validate fix.json
  if (phase === "fix") {
    return validateSingleArtifact(artifactsDir, "fix", "fix.json")
  }

  // Top-level artifact phases
  return validateSingleArtifact(artifactsDir, phase, `${phase}.json`)
}

function validateSingleArtifact(
  artifactsDir: string,
  phase: string,
  fileName: string,
): ValidationResult {
  const filePath = join(artifactsDir, fileName)
  if (!existsSync(filePath)) {
    return { valid: false, errors: [`Artifact file not found: ${fileName}`] }
  }

  // For summary phases, try summary schema
  const summarySchema = getSummarySchema(phase)
  if (summarySchema) {
    return parseAndValidate(filePath, summarySchema)
  }

  // For regular phases
  const schema = getSchemaForPhase(phase)
  if (schema) {
    return parseAndValidate(filePath, schema)
  }

  // No schema defined for this phase — skip validation
  return { valid: true }
}

function validatePerPackageArtifacts(
  artifactsDir: string,
  phase: string,
): ValidationResult {
  const schema = getPerPackageSchema(phase)
  if (!schema) return { valid: true }

  const translationsDir = join(artifactsDir, "translations")
  if (!existsSync(translationsDir)) {
    return { valid: false, errors: ["translations directory not found"] }
  }

  // For review/verify, also check summary
  if (phase === "review" || phase === "verify") {
    const summaryFileName = `${phase}-summary.json`
    const summaryPath = join(artifactsDir, summaryFileName)
    if (!existsSync(summaryPath)) {
      return { valid: false, errors: [`Summary file not found: ${summaryFileName}`] }
    }
    const summarySchema = getSummarySchema(phase)
    if (summarySchema) {
      const result = parseAndValidate(summaryPath, summarySchema)
      if (!result.valid) return result
    }
  }

  return { valid: true }
}

function parseAndValidate(filePath: string, schema: z.ZodTypeAny): ValidationResult {
  try {
    const content = readFileSync(filePath, "utf-8")
    const data = JSON.parse(content)
    const result = schema.safeParse(data)
    if (!result.success) {
      const errors = result.error.issues.map(
        i => `${i.path.join(".")}: ${i.message}`
      )
      return { valid: false, errors }
    }
    return { valid: true }
  } catch (err: any) {
    return { valid: false, errors: [`Failed to read/parse ${filePath}: ${err.message}`] }
  }
}

// ---------------------------------------------------------------------------
// System Prompt Construction (D11)
// ---------------------------------------------------------------------------

function buildSystemPrompt(phase: string, run: WorkflowRun): string | null {
  const phaseConfig = SQL2JAVA_WORKFLOW.phases.find(p => p.name === phase)
  if (!phaseConfig) return null

  const agentPath = phaseConfig.agentFile
  if (!existsSync(agentPath)) {
    // Try relative to project root
    const altPath = join(process.cwd(), agentPath)
    if (!existsSync(altPath)) return null
  }

  try {
    const fullPath = existsSync(agentPath) ? agentPath : join(process.cwd(), agentPath)
    let agentContent = readFileSync(fullPath, "utf-8")

    // Strip YAML frontmatter
    agentContent = agentContent.replace(/^---[\s\S]*?---\n*/, "")

    // Parse ## Phase: xxx section boundaries
    const sections = parsePhaseSections(agentContent)

    // Extract common portion (file header to first ## Phase:)
    const commonPart = sections.commonPart

    // Extract current phase's section
    const phaseSection = sections.phaseSections.get(phase) ?? ""

    // Build Runtime Context block
    const artifactsDir = join(ARTIFACT_DIR, run.runId)
    const upstream = UPSTREAM_ARTIFACTS[phase] ?? []
    const runtimeCtx = buildRuntimeContextBlock(run, artifactsDir, upstream)

    return `${commonPart}\n\n---\n\n${phaseSection}\n\n${runtimeCtx}`
  } catch {
    return null
  }
}

function parsePhaseSections(content: string): {
  commonPart: string
  phaseSections: Map<string, string>
} {
  const phaseSections = new Map<string, string>()
  const lines = content.split("\n")

  let commonEndIndex = lines.length
  const phaseStarts: { name: string; lineIndex: number }[] = []

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^## Phase:\s*(\S+)/)
    if (match) {
      if (phaseStarts.length === 0) {
        commonEndIndex = i
      }
      phaseStarts.push({ name: match[1], lineIndex: i })
    }
  }

  const commonPart = lines.slice(0, commonEndIndex).join("\n").trim()

  for (let idx = 0; idx < phaseStarts.length; idx++) {
    const start = phaseStarts[idx].lineIndex
    const end = idx + 1 < phaseStarts.length ? phaseStarts[idx + 1].lineIndex : lines.length
    const section = lines.slice(start, end).join("\n").trim()
    phaseSections.set(phaseStarts[idx].name, section)
  }

  return { commonPart, phaseSections }
}

function buildRuntimeContextBlock(
  run: WorkflowRun,
  artifactsDir: string,
  upstreamArtifacts: string[],
): string {
  const currentEntry = run.phaseHistory[run.phaseHistory.length - 1]
  const incremental = currentEntry?.incrementalContext

  const lines = [
    "## Runtime Context",
    "",
    "| 字段 | 值 |",
    "|------|-----|",
    `| currentPhase | ${run.currentPhase} |`,
    `| runId | ${run.runId} |`,
    `| artifactsDir | ${artifactsDir} |`,
  ]

  if (run.metadata?.sourcePath) {
    lines.push(`| sourcePath | ${run.metadata.sourcePath} |`)
  }

  if (incremental) {
    lines.push(`| incrementalContext.targetPackages | ${JSON.stringify(incremental.targetPackages)} |`)
  }

  lines.push("")
  lines.push("### Upstream Artifacts")
  lines.push("")

  for (const artifact of upstreamArtifacts) {
    lines.push(`- \`${artifactsDir}/${artifact}\``)
  }

  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Event Logging
// ---------------------------------------------------------------------------

function appendEvent(runId: string, eventType: string, phase: string, message: string): void {
  const dir = join(ARTIFACT_DIR, runId)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const logPath = join(dir, "_events.log")
  const now = new Date().toISOString()
  const line = `[${now}] [${eventType}] [${runId}] [${phase}] ${message}\n`
  appendFileSync(logPath, line, "utf-8")
}

// ---------------------------------------------------------------------------
// Plugin Export
// ---------------------------------------------------------------------------

export const WorkflowEnginePlugin = async ({ $ }: { $?: any }) => {
  return {
    tool: {
      /** 主工作流工具：LLM 调用此工具操作状态机 */
      workflow: tool({
        description:
          "Deterministic single-pipeline workflow engine for PL/SQL → Java translation. " +
          "Actions: 'start' to create a run, 'advance' to move to the next phase, " +
          "'confirm' to approve a paused phase, 'retry' on failure, " +
          "'status' to inspect, 'abort' to cancel, 'list' to see all runs.",
        args: {
          action: z.enum(["start", "advance", "confirm", "retry", "status", "abort", "list"]),
          runId: z.string().optional(),
          result: z.enum(["passed", "failed"]).optional(),
          metadata: z.any().optional(),
        },
        execute: async (args: any) => {
          switch (args.action) {
            // ── start ──────────────────────────────────────────
            case "start": {
              const runId = args.runId ?? `run-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15)}`
              const metadata = args.metadata ?? {}

              // Create artifacts directory
              const dir = join(ARTIFACT_DIR, runId)
              if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true })
              }

              const run = engine.start("sql2java", runId, metadata)
              setWorkflowContext(run)

              const phaseConfig = SQL2JAVA_WORKFLOW.phases[0]
              return {
                title: `Workflow "sql2java" started`,
                output: [
                  `Run ID: ${runId}`,
                  `Phase: ${run.currentPhase}`,
                  `Agent: ${phaseConfig?.agentFile}`,
                  `Temperature: ${phaseConfig?.temperature}`,
                  `Artifacts Dir: ${dir}`,
                ].join("\n"),
                metadata: { runId, phase: run.currentPhase, agentFile: phaseConfig?.agentFile },
              }
            }

            // ── advance ──────────────────────────────────────
            case "advance": {
              if (!args.runId) throw new Error("runId is required for 'advance'")
              const runId = args.runId
              const run = engine.status(runId)
              if (!run) throw new Error(`Run "${runId}" not found`)

              const artifactsDir = join(ARTIFACT_DIR, runId)
              const currentPhase = run.currentPhase

              // D5: Artifact disk validation before advance
              const validation = validateArtifactOnDisk(artifactsDir, currentPhase ?? "")
              if (!validation.valid) {
                return {
                  title: `Artifact validation failed for phase: ${currentPhase}`,
                  output: [
                    `Phase: ${currentPhase}`,
                    `Rejected: artifact validation failed`,
                    ``,
                    `Errors:`,
                    ...(validation.errors ?? []).map(e => `  - ${e}`),
                    ``,
                    `Please fix the artifact and retry advance.`,
                  ].join("\n"),
                  metadata: {
                    runId,
                    phase: currentPhase,
                    rejected: true,
                    rejectionReason: validation.errors?.join("; "),
                  },
                }
              }

              // D9: Cross-schema validation (analyze/plan completion)
              if (currentPhase === "analyze" || currentPhase === "plan") {
                const warnings = engine.validateCrossSchema(run, currentPhase)
                if (warnings.length > 0) {
                  appendEvent(runId, "WARN", currentPhase, warnings.join("; "))
                }
              }

              // Execute advance
              const result = engine.advance(runId, { result: args.result })
              const { run: updatedRun, nextPhase, finished, waitingForConfirmation, rejected, rejectionReason } = result

              if (rejected) {
                return {
                  title: `Advance rejected for phase: ${currentPhase}`,
                  output: [
                    `Phase: ${currentPhase}`,
                    `Rejected: ${rejectionReason}`,
                    ``,
                    `Please correct and retry advance.`,
                  ].join("\n"),
                  metadata: { runId, phase: currentPhase, rejected: true, rejectionReason },
                }
              }

              if (finished) {
                currentWorkflowContext = null
                return {
                  title: `Workflow completed: ${updatedRun.status}`,
                  output: [
                    `Run ID: ${runId}`,
                    `Status: ${updatedRun.status}`,
                    `Phases completed: ${updatedRun.phaseHistory.filter(h => h.status === "completed").length}`,
                  ].join("\n"),
                  metadata: { runId, status: updatedRun.status },
                }
              }

              // D4: waitingForConfirmation → do NOT activate agent
              if (waitingForConfirmation) {
                currentWorkflowContext = null
                return {
                  title: `Paused for confirmation: ${updatedRun.currentPhase}`,
                  output: [
                    `Phase: ${updatedRun.currentPhase}`,
                    `Status: waiting for user confirmation`,
                    ``,
                    `User must call: workflow({ action: "confirm", runId: "${runId}" })`,
                  ].join("\n"),
                  metadata: { runId, phase: updatedRun.currentPhase, waitingForConfirmation: true },
                }
              }

              // Normal advance → activate agent
              setWorkflowContext(updatedRun)

              return {
                title: `Advanced to phase: ${updatedRun.currentPhase}`,
                output: [
                  `Phase: ${updatedRun.currentPhase}`,
                  `Agent: ${nextPhase?.agentFile}`,
                  `Temperature: ${nextPhase?.temperature}`,
                  `Tools: ${nextPhase?.tools.join(", ")}`,
                ].join("\n"),
                metadata: {
                  runId,
                  phase: updatedRun.currentPhase,
                  agentFile: nextPhase?.agentFile,
                },
              }
            }

            // ── confirm ──────────────────────────────────────
            case "confirm": {
              if (!args.runId) throw new Error("runId is required for 'confirm'")
              const run = engine.confirm(args.runId)
              setWorkflowContext(run)

              const phaseConfig = SQL2JAVA_WORKFLOW.phases.find(p => p.name === run.currentPhase)
              return {
                title: `Confirmed: ${run.currentPhase}`,
                output: [
                  `Phase: ${run.currentPhase}`,
                  `Status: running`,
                  `Agent: ${phaseConfig?.agentFile}`,
                  `Temperature: ${phaseConfig?.temperature}`,
                ].join("\n"),
                metadata: { runId: args.runId, phase: run.currentPhase, status: "running" },
              }
            }

            // ── retry ────────────────────────────────────────
            case "retry": {
              if (!args.runId) throw new Error("runId is required for 'retry'")
              const { run, retryCount, exhausted, terminalState } = engine.retry(args.runId)

              if (exhausted && terminalState) {
                currentWorkflowContext = null
                return {
                  title: `Retry exhausted: ${terminalState}`,
                  output: [
                    `Run ID: ${args.runId}`,
                    `Phase: ${run.currentPhase}`,
                    `Retries: ${retryCount}`,
                    `Terminal state: ${terminalState}`,
                  ].join("\n"),
                  metadata: { runId: args.runId, status: terminalState, retryCount },
                }
              }

              if (exhausted) {
                return {
                  title: `Max retries exceeded`,
                  output: [
                    `Run ID: ${args.runId}`,
                    `Phase: ${run.currentPhase}`,
                    `Retries: ${retryCount}`,
                    `Consider calling abort() to terminate the workflow.`,
                  ].join("\n"),
                  metadata: { runId: args.runId, phase: run.currentPhase, exhausted: true, retryCount },
                }
              }

              return {
                title: `Retrying phase: ${run.currentPhase}`,
                output: `Retry #${retryCount} for phase "${run.currentPhase}"`,
                metadata: { runId: args.runId, phase: run.currentPhase, retryCount },
              }
            }

            // ── status ───────────────────────────────────────
            case "status": {
              if (!args.runId) throw new Error("runId is required for 'status'")
              const run = engine.status(args.runId)
              if (!run) {
                return { title: "Not found", output: `No workflow run with ID "${args.runId}"`, metadata: {} }
              }

              return {
                title: `Workflow status: ${run.status}`,
                output: JSON.stringify({
                  runId: run.runId,
                  definitionId: run.definitionId,
                  status: run.status,
                  currentPhase: run.currentPhase,
                  createdAt: run.createdAt,
                  updatedAt: run.updatedAt,
                  phases: run.phaseHistory.map(h => ({
                    phase: h.phase,
                    status: h.status,
                    retryCount: h.retryCount,
                    branchedFrom: h.branchedFrom,
                    incrementalContext: h.incrementalContext,
                  })),
                }, null, 2),
              }
            }

            // ── abort ────────────────────────────────────────
            case "abort": {
              if (!args.runId) throw new Error("runId is required for 'abort'")
              const run = engine.abort(args.runId)
              currentWorkflowContext = null
              return {
                title: `Workflow aborted: ${args.runId}`,
                output: `Status: ${run.status}`,
                metadata: { runId: args.runId, status: run.status },
              }
            }

            // ── list ─────────────────────────────────────────
            case "list": {
              const runs = engine.listRuns()
              return {
                title: `${runs.length} workflow run(s)`,
                output: runs.map(r =>
                  `${r.runId} | ${r.definitionId} | ${r.status} | phase: ${r.currentPhase}`
                ).join("\n"),
                metadata: { count: runs.length },
              }
            }

            default: {
              throw new Error(`Unknown workflow action: ${args.action}`)
            }
          }
        },
      }),
    },

    // ── Hooks ──────────────────────────────────────────────────

    /** beforeLlmCall: 温度控制 + 工具过滤 */
    "chat.params": async (input: any) => {
      if (!currentWorkflowContext) return input
      return {
        ...input,
        temperature: currentWorkflowContext.temperature,
      }
    },

    /** phaseChange: system prompt 构建 (D11) */
    "experimental.chat.system.transform": async (input: any) => {
      if (!currentWorkflowContext) return input
      const run = engine.status(currentWorkflowContext.runId)
      if (!run || !run.currentPhase) return input

      const systemPrompt = buildSystemPrompt(run.currentPhase, run)
      if (!systemPrompt) return input

      return {
        ...input,
        system: systemPrompt,
      }
    },

    /** 工具权限过滤 */
    "tool.call.before": async (input: any) => {
      if (!currentWorkflowContext) return input
      const allowedTools = currentWorkflowContext.tools
      const toolName = input?.tool
      if (toolName && !allowedTools.includes(toolName)) {
        return {
          ...input,
          __blocked: true,
          __reason: `Tool "${toolName}" is not allowed in phase "${currentWorkflowContext.phase}". Allowed: ${allowedTools.join(", ")}`,
        }
      }
      return input
    },
  }
}
