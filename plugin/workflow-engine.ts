/**
 * Workflow Engine Plugin
 *
 * 确定性多阶段状态机插件，驱动 Oracle PL/SQL → Spring Boot + MyBatis 翻译工作流。
 * 核心引擎位于 workflow/engine-core.ts。
 */

import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import { WorkflowEngine, type WorkflowDefinition, type PhaseConfig, type WorkflowRun } from "../workflow/engine-core"

// ---------------------------------------------------------------------------
// Artifact 存储辅助
// ---------------------------------------------------------------------------

const ARTIFACT_DIR = ".workflow-artifacts"

/** 将阶段产物写入文件系统，返回相对路径 */
async function storeArtifact(
  $: any,
  runId: string,
  phase: string,
  data: any,
): Promise<string> {
  const dir = `${ARTIFACT_DIR}/${runId}`
  await $`mkdir -p ${dir}`.quiet()

  const filename = `${dir}/${phase}.json`
  const json = typeof data === "string" ? data : JSON.stringify(data, null, 2)

  // 用 Bun.write 或 Node fs — 这里用 shell
  await $`cat > ${filename} << '___ARTIFACT_EOF___'
${json}
___ARTIFACT_EOF___`

  return filename
}

/** 从文件系统读取产物 */
async function loadArtifact($: any, runId: string, phase: string): Promise<any> {
  const path = `${ARTIFACT_DIR}/${runId}/${phase}.json`
  try {
    const content = await $`cat ${path}`.quiet()
    return JSON.parse(content.toString())
  } catch {
    return null
  }
}

/** 生成摘要（用于 schema 收敛，避免大产物占满上下文） */
function summarizeArtifact(phase: string, artifact: any): Record<string, any> {
  if (!artifact) return { phase, status: "empty" }

  switch (phase) {
    case "inventory":
      return {
        phase,
        packageCount: artifact.packages?.length ?? 0,
        tableCount: artifact.tables?.length ?? 0,
        standaloneCount: artifact.standaloneProcedures?.length ?? 0,
      }

    case "analyze":
      return {
        phase,
        packageOrder: artifact.translationOrder ?? [],
        highRiskCount: Object.values(artifact.complexity ?? {})
          .filter((c: any) => c.riskLevel === "high" || c.riskLevel === "manual-required")
          .length,
      }

    case "plan":
      return {
        phase,
        totalBatches: artifact.packageMappings?.length ?? 0,
        rules: artifact.rules ?? {},
        manualReviewCount: artifact.manualReviewList?.length ?? 0,
      }

    case "scaffold":
      return {
        phase,
        generatedFiles: artifact.files?.length ?? 0,
      }

    case "parse":
      return {
        phase,
        packageName: artifact.package?.name,
        routineCount: artifact.routines?.length ?? 0,
        typeCount: artifact.typeDefinitions?.length ?? 0,
        unknownCount: artifact.routines?.reduce(
          (sum: number, r: any) => sum + (r.summary?.unknownCount ?? 0), 0,
        ) ?? 0,
      }

    case "translate":
      return {
        phase,
        packageName: artifact.packageName,
        fileCount: artifact.files?.length ?? 0,
        todoCount: artifact.todos?.length ?? 0,
        manualRequiredCount: artifact.manualRequired?.length ?? 0,
      }

    case "review":
      return {
        phase,
        passed: artifact.passed,
        score: artifact.overallScore,
        mustFixCount: artifact.mustFix?.length ?? 0,
      }

    case "verify":
      return {
        phase,
        passed: artifact.passed,
        compileSuccess: artifact.compilation?.success,
        mybatisValid: artifact.mybatisValidation?.mapperXmlValid,
      }

    default:
      return { phase, keys: Object.keys(artifact) }
  }
}

// ---------------------------------------------------------------------------
// Workflow Context — 用于 hooks 中确定当前运行状态
// ---------------------------------------------------------------------------

let currentWorkflowContext: { runId: string; phase: string; agent: string; temperature: number } | null = null

/** 设置当前工作流上下文（由 start / advance 自动调用） */
function setWorkflowContext(run: WorkflowRun): void {
  const phaseConfig = run.definition.phases.find((p) => p.name === run.currentPhase)
  currentWorkflowContext = {
    runId: run.runId,
    phase: run.currentPhase,
    agent: phaseConfig?.agent ?? "unknown",
    temperature: phaseConfig?.temperature ?? 0.1,
  }
}

/** 获取当前工作流上下文 */
export function getWorkflowContext(): typeof currentWorkflowContext {
  return currentWorkflowContext
}

// ---------------------------------------------------------------------------
// Plugin Export
// ---------------------------------------------------------------------------

const engine = new WorkflowEngine()

export const WorkflowEnginePlugin = async ({ $ }: { $: any }) => {
  return {
    tool: {
      /** 主工作流工具：LLM 调用此工具操作状态机 */
      workflow: tool({
        description:
          "Deterministic multi-phase workflow engine. " +
          "Use 'start' to create a run, 'advance' to move to the next phase, " +
          "'retry' on failure, 'status' to inspect, 'abort' to cancel.",
        args: {
          action: z.enum(["start", "advance", "retry", "status", "abort", "list"]),
          runId: z.string().optional(),
          workflowId: z.string().optional(),
          phase: z.string().optional(),
          artifact: z.any().optional(),
          definition: z.any().optional(),
          metadata: z.any().optional(),
        },
        execute: async (args: any, ctx: any) => {
          switch (args.action) {
            case "start": {
              if (!args.definition) throw new Error("definition is required for 'start'")
              const def = args.definition as WorkflowDefinition
              const runId = args.runId ?? `${def.id}-${Date.now()}`
              const run = engine.start(def, runId, args.metadata)
              setWorkflowContext(run)

              const phaseConfig = run.definition.phases[0]
              return {
                title: `Workflow "${def.id}" started`,
                output: [
                  `Run ID: ${runId}`,
                  `Phase: ${run.currentPhase}`,
                  `Agent: ${phaseConfig?.agent}`,
                  `Temperature: ${phaseConfig?.temperature}`,
                ].join("\n"),
                metadata: { runId, phase: run.currentPhase, agent: phaseConfig?.agent },
              }
            }

            case "advance": {
              if (!args.runId) throw new Error("runId is required for 'advance'")
              const { run, nextPhase, finished } = engine.advance(args.runId, args.artifact)

              // 将完整产物写入文件，返回摘要
              if (args.artifact) {
                const prevPhase = run.phaseHistory[run.phaseHistory.length - 2]?.phase
                if (prevPhase) {
                  const path = await storeArtifact($, args.runId, prevPhase, args.artifact)
                  const entry = run.phaseHistory.find((h) => h.phase === prevPhase)
                  if (entry) entry.artifactPath = path
                }
              }

              if (finished) {
                currentWorkflowContext = null
                return {
                  title: `Workflow "${run.definition.id}" completed`,
                  output: [
                    `Run ID: ${args.runId}`,
                    `Status: completed`,
                    `Phases: ${run.phaseHistory.length}`,
                    `Duration: ${Date.now() - run.startedAt}ms`,
                  ].join("\n"),
                  metadata: { runId: args.runId, status: "completed" },
                }
              }

              setWorkflowContext(run)
              const summary = summarizeArtifact(run.currentPhase, args.artifact)
              return {
                title: `Advanced to phase: ${run.currentPhase}`,
                output: [
                  `Phase: ${run.currentPhase}`,
                  `Agent: ${nextPhase?.agent}`,
                  `Description: ${nextPhase?.description}`,
                  `Temperature: ${nextPhase?.temperature}`,
                  nextPhase?.requireApproval ? "⚠ Requires human approval" : "",
                ].filter(Boolean).join("\n"),
                metadata: {
                  runId: args.runId,
                  phase: run.currentPhase,
                  agent: nextPhase?.agent,
                  previousArtifactSummary: summary,
                },
              }
            }

            case "retry": {
              if (!args.runId) throw new Error("runId is required for 'retry'")
              const { run, retryCount, branchedTo, exhausted } = engine.retry(args.runId)

              if (exhausted && !branchedTo) {
                return {
                  title: `Workflow failed: max retries exceeded`,
                  output: [
                    `Run ID: ${args.runId}`,
                    `Phase: ${run.currentPhase}`,
                    `Retries: ${retryCount}`,
                    `Status: failed`,
                  ].join("\n"),
                  metadata: { runId: args.runId, status: "failed" },
                }
              }

              if (branchedTo) {
                return {
                  title: `Max retries exceeded. Branched to: ${branchedTo}`,
                  output: [
                    `Run ID: ${args.runId}`,
                    `Previous phase: ${run.phaseHistory[run.phaseHistory.length - 2]?.phase}`,
                    `Branched to: ${branchedTo}`,
                  ].join("\n"),
                  metadata: { runId: args.runId, phase: branchedTo, branched: true },
                }
              }

              return {
                title: `Retrying phase: ${run.currentPhase}`,
                output: `Retry ${retryCount} for phase "${run.currentPhase}"`,
                metadata: { runId: args.runId, phase: run.currentPhase, retryCount },
              }
            }

            case "status": {
              if (!args.runId) throw new Error("runId is required for 'status'")
              const run = engine.status(args.runId)
              if (!run) return { title: "Not found", output: `No workflow run with ID "${args.runId}"`, metadata: {} }

              return {
                title: `Workflow status: ${run.status}`,
                output: JSON.stringify({
                  runId: run.runId,
                  workflowId: run.definition.id,
                  status: run.status,
                  currentPhase: run.currentPhase,
                  startedAt: new Date(run.startedAt).toISOString(),
                  durationMs: run.completedAt ? run.completedAt - run.startedAt : Date.now() - run.startedAt,
                  phases: run.phaseHistory.map((h) => ({
                    phase: h.phase,
                    status: h.status,
                    durationMs: h.completedAt ? h.completedAt - h.startedAt : null,
                    retries: h.failureCount,
                    hasArtifact: !!h.artifact,
                  })),
                }, null, 2),
              }
            }

            case "abort": {
              if (!args.runId) throw new Error("runId is required for 'abort'")
              const run = engine.abort(args.runId)
              return {
                title: `Workflow aborted: ${args.runId}`,
                output: `Status: ${run.status}`,
                metadata: { runId: args.runId, status: run.status },
              }
            }

            case "list": {
              const runs = engine.listRuns()
              return {
                title: `${runs.length} workflow run(s)`,
                output: runs.map((r) =>
                  `${r.runId} | ${r.definition.id} | ${r.status} | phase: ${r.currentPhase}`
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

      /** 可观测性工具 */
      "workflow-metrics": tool({
        description: "Get observability metrics for workflow runs",
        args: {
          runId: z.string().optional(),
        },
        execute: async (args: any) => {
          if (args.runId) {
            const run = engine.status(args.runId)
            if (!run) return { title: "Not found", output: "No run with this ID", metadata: {} }

            return {
              title: `Metrics for ${args.runId}`,
              output: JSON.stringify({
                runId: run.runId,
                workflowId: run.definition.id,
                status: run.status,
                totalDurationMs: run.completedAt ? run.completedAt - run.startedAt : null,
                phaseCount: run.phaseHistory.length,
                completedPhases: run.phaseHistory.filter((h) => h.status === "completed").length,
                failedPhases: run.phaseHistory.filter((h) => h.status === "failed").length,
                totalRetries: run.phaseHistory.reduce((sum, h) => sum + h.failureCount, 0),
                phases: run.phaseHistory.map((h) => ({
                  phase: h.phase,
                  status: h.status,
                  durationMs: h.completedAt ? h.completedAt - h.startedAt : null,
                  retries: h.failureCount,
                  hasArtifact: !!h.artifact,
                })),
              }, null, 2),
              metadata: { runId: args.runId },
            }
          }

          // 全局概览
          const allRuns = engine.listRuns()
          return {
            title: "All workflow metrics",
            output: JSON.stringify({
              totalRuns: allRuns.length,
              running: allRuns.filter((r) => r.status === "running").length,
              completed: allRuns.filter((r) => r.status === "completed").length,
              failed: allRuns.filter((r) => r.status === "failed").length,
              runs: allRuns.map((r) => ({
                runId: r.runId,
                workflowId: r.definition.id,
                status: r.status,
                currentPhase: r.currentPhase,
              })),
            }, null, 2),
            metadata: { count: allRuns.length },
          }
        },
      }),
    },

    /** 上下文隔离：拦截子 agent 输出，schema 收敛 */
    "tool.execute.after": async (input: any, output: any) => {
      if (!currentWorkflowContext) return
      if (input.tool === "Agent" || input.tool === "Task") {
        const json = JSON.stringify(output)
        if (json && json.length > 50000) {
          // 大体积输出只保留摘要
          output.__summary = `Output truncated (${json.length} bytes). Full result stored in artifact.`
        }
      }
    },

    /** 按阶段调整 LLM 参数 — 从 workflow context 读取温度 */
    "chat.params": async (input: any, _output: any) => {
      if (!currentWorkflowContext) return input
      return {
        ...input,
        temperature: currentWorkflowContext.temperature,
      }
    },

    /** 按阶段切换 system prompt — 从 agent 文件读取提示词，剥离 YAML frontmatter */
    "experimental.chat.system.transform": async (input: any, _output: any) => {
      if (!currentWorkflowContext) return input
      const agentName = currentWorkflowContext.agent
      if (!agentName || agentName === "unknown") return input

      try {
        const fs = await import("fs")
        const agentPath = `${process.cwd()}/.opencode/agent/${agentName}.md`
        if (fs.existsSync(agentPath)) {
          let agentContent = fs.readFileSync(agentPath, "utf-8")
          // 剥离 YAML frontmatter (--- ... ---)
          agentContent = agentContent.replace(/^---[\s\S]*?---\n*/, "")
          return {
            ...input,
            system: `[Workflow Phase: ${currentWorkflowContext.phase}]\n` +
                    `[Agent: ${agentName}]\n\n${agentContent.trim()}`,
          }
        }
      } catch {
        // 静默失败，使用默认 system prompt
      }
      return input
    },

    /** 事件追踪 */
    event: async ({ event }: any) => {
      if (event.type === "workflow.phase.complete") {
        const ctx = getWorkflowContext()
        if (ctx) {
          const now = new Date().toISOString()
          const logLine = `[${now}] ${ctx.runId} | ${ctx.phase} | ${event.result ?? "done"}\n`
          try {
            const fs = await import("fs")
            fs.appendFileSync(".workflow-artifacts/_events.log", logLine, "utf-8")
          } catch {
            // 静默
          }
        }
      }
    },
  }
}
