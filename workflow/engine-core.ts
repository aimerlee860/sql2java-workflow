/**
 * Engine Core — 工作流引擎核心类型和状态机类
 *
 * 被以下文件引用：
 *   - plugin/workflow-engine.ts（插件入口）
 *   - workflow/workflow-definitions.ts（工作流定义）
 *   - workflow/batch-orchestrator.ts（批量编排器）
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 单阶段配置 */
export interface PhaseConfig {
  name: string
  agent: string
  description: string
  temperature: number
  maxRetries: number
  failureBranch?: string
  requireApproval?: boolean
}

/** 条件转移：根据上一阶段产物的字段值路由到不同下一阶段 */
interface ConditionalTransition {
  _condition: string
  [outcome: string]: any
}

/** 转移表值：字符串数组（无条件）或 ConditionalTransition（条件） */
type TransitionTarget = string[] | ConditionalTransition

/** 工作流定义 */
export interface WorkflowDefinition {
  id: string
  description?: string
  phases: PhaseConfig[]
  transitions: Record<string, TransitionTarget>
}

/** 单次执行中一个阶段的历史记录 */
interface PhaseHistoryEntry {
  phase: string
  status: "running" | "completed" | "failed"
  startedAt: number
  completedAt?: number
  artifact?: any
  artifactPath?: string
  failureCount: number
}

/** 一次工作流运行 */
export interface WorkflowRun {
  runId: string
  definition: WorkflowDefinition
  currentPhase: string
  phaseHistory: PhaseHistoryEntry[]
  artifacts: Map<string, any>
  status: "running" | "completed" | "failed" | "aborted"
  startedAt: number
  completedAt?: number
  metadata: Record<string, any>
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class WorkflowEngine {
  private runs = new Map<string, WorkflowRun>()

  start(def: WorkflowDefinition, runId: string, metadata?: Record<string, any>): WorkflowRun {
    const firstPhase = def.phases[0]
    if (!firstPhase) throw new Error(`Workflow "${def.id}" has no phases`)

    const run: WorkflowRun = {
      runId,
      definition: def,
      currentPhase: firstPhase.name,
      phaseHistory: [
        {
          phase: firstPhase.name,
          status: "running",
          startedAt: Date.now(),
          failureCount: 0,
        },
      ],
      artifacts: new Map(),
      status: "running",
      startedAt: Date.now(),
      metadata: metadata ?? {},
    }
    this.runs.set(runId, run)
    return run
  }

  advance(runId: string, artifact?: any): { run: WorkflowRun; nextPhase: PhaseConfig | null; finished: boolean } {
    const run = this.getRun(runId)
    const entry = this.findRunningEntry(run)
    if (entry) {
      entry.status = "completed"
      entry.completedAt = Date.now()
      if (artifact !== undefined) {
        entry.artifact = artifact
        run.artifacts.set(run.currentPhase, artifact)
      }
    }

    const nextPhaseName = this.resolveTransition(run, artifact)
    if (!nextPhaseName) {
      run.status = "completed"
      run.completedAt = Date.now()
      return { run, nextPhase: null, finished: true }
    }

    run.currentPhase = nextPhaseName
    const nextPhase = run.definition.phases.find((p) => p.name === nextPhaseName) ?? null
    run.phaseHistory.push({
      phase: nextPhaseName,
      status: "running",
      startedAt: Date.now(),
      failureCount: 0,
    })

    return { run, nextPhase, finished: false }
  }

  retry(runId: string): { run: WorkflowRun; retryCount: number; branchedTo?: string; exhausted: boolean } {
    const run = this.getRun(runId)
    const entry = this.findRunningEntry(run)
    if (!entry) throw new Error("No running phase to retry")

    const phaseConfig = this.getPhaseConfig(run, run.currentPhase)
    entry.failureCount++

    const maxRetries = phaseConfig?.maxRetries ?? 2
    if (entry.failureCount >= maxRetries) {
      if (phaseConfig?.failureBranch) {
        entry.status = "failed"
        entry.completedAt = Date.now()
        run.currentPhase = phaseConfig.failureBranch
        run.phaseHistory.push({
          phase: phaseConfig.failureBranch,
          status: "running",
          startedAt: Date.now(),
          failureCount: 0,
        })
        return { run, retryCount: entry.failureCount, branchedTo: phaseConfig.failureBranch, exhausted: true }
      }
      run.status = "failed"
      run.completedAt = Date.now()
      return { run, retryCount: entry.failureCount, exhausted: true }
    }

    return { run, retryCount: entry.failureCount, exhausted: false }
  }

  abort(runId: string): WorkflowRun {
    const run = this.getRun(runId)
    run.status = "aborted"
    run.completedAt = Date.now()
    const entry = this.findRunningEntry(run)
    if (entry) {
      entry.status = "failed"
      entry.completedAt = Date.now()
    }
    return run
  }

  status(runId: string): WorkflowRun | null {
    return this.runs.get(runId) ?? null
  }

  listRuns(): WorkflowRun[] {
    return Array.from(this.runs.values())
  }

  // --- private ---

  private getRun(runId: string): WorkflowRun {
    const run = this.runs.get(runId)
    if (!run) throw new Error(`Workflow run "${runId}" not found`)
    return run
  }

  private findRunningEntry(run: WorkflowRun): PhaseHistoryEntry | undefined {
    return run.phaseHistory.find(
      (h) => h.phase === run.currentPhase && h.status === "running",
    )
  }

  private getPhaseConfig(run: WorkflowRun, phase: string): PhaseConfig | undefined {
    return run.definition.phases.find((p) => p.name === phase)
  }

  private resolveTransition(run: WorkflowRun, artifact?: any): string | null {
    const transDef = run.definition.transitions[run.currentPhase]
    if (!transDef) return null

    if (Array.isArray(transDef)) {
      return transDef[0] ?? null
    }

    if (transDef._condition) {
      const value = this.evaluateCondition(transDef._condition, artifact, run)
      const key = String(value)
      const targets = transDef[key]
      if (Array.isArray(targets)) return targets[0] ?? null
      return null
    }

    return null
  }

  private evaluateCondition(path: string, artifact: any, run: WorkflowRun): any {
    const parts = path.split(".")
    let root: any
    if (parts[0] === "artifact") {
      root = artifact
      parts.shift()
    } else {
      root = run
    }

    let current = root
    for (const part of parts) {
      if (current == null) return undefined
      current = current[part]
    }
    return current
  }
}
