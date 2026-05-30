/**
 * Batch Orchestrator
 *
 * Level 1 完成后，按拓扑排序逐个 Package 启动 Level 2 翻译工作流。
 * 支持断点续传：跳过已完成的 Package。
 */

import { WorkflowEngine } from "./engine-core"
import { projectWorkflow, translationWorkflow, type TranslationProgress } from "./workflow-definitions"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BatchConfig {
  /** PL/SQL 源码根目录 */
  sourceRoot: string
  /** Java 产出根目录 */
  outputRoot: string
  /** translation-plan.json 路径（Level 1 产物） */
  planPath: string
  /** 进度文件路径 */
  progressPath: string
}

interface PackageTranslationInput {
  oraclePackage: string
  sourceFiles: { spec?: string; body?: string }
  mapping: {
    javaPackage: string
    mapperInterface: string
    serviceClass: string
    serviceImplClass: string
    dtoPackage: string
  }
  rules: Record<string, any>
  availableMappers: string[]
}

// ---------------------------------------------------------------------------
// Progress Persistence
// ---------------------------------------------------------------------------

function defaultProgress(totalPackages: number, totalProcedures: number): TranslationProgress {
  return {
    totalPackages,
    completedPackages: [],
    inProgressPackages: [],
    failedPackages: [],
    manualRequired: [],
    totalProcedures,
    translatedProcedures: 0,
    lastUpdated: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class BatchOrchestrator {
  private engine: WorkflowEngine
  private config: BatchConfig

  constructor(engine: WorkflowEngine, config: BatchConfig) {
    this.engine = engine
    this.config = config
  }

  /**
   * 执行完整的批量翻译流程。
   *
   * 1. 读取 translation-plan.json
   * 2. 按拓扑序逐个 Package 启动 Level 2 工作流
   * 3. 记录进度，支持断点续传
   * 4. 汇总结果
   */
  async run(): Promise<BatchResult> {
    const plan = await this.loadPlan()
    const progress = await this.loadOrCreateProgress(plan)

    const results: PackageResult[] = []

    for (const mapping of plan.packageMappings) {
      const pkg = mapping.oraclePackage

      // 跳过已完成
      if (progress.completedPackages.includes(pkg)) {
        results.push({ package: pkg, status: "skipped", reason: "already completed" })
        continue
      }

      // 跳过需要人工处理的
      if (plan.manualReviewList.some((m: any) => m.procedure.startsWith(pkg + "."))) {
        progress.manualRequired.push(pkg)
        progress.lastUpdated = new Date().toISOString()
        await this.saveProgress(progress)
        results.push({ package: pkg, status: "manual", reason: "flagged for manual review" })
        continue
      }

      // 启动 Package 级翻译
      progress.inProgressPackages.push(pkg)
      progress.lastUpdated = new Date().toISOString()
      await this.saveProgress(progress)

      const input = this.buildPackageInput(pkg, mapping, plan, progress)
      const result = await this.translatePackage(input)

      // 更新进度
      progress.inProgressPackages = progress.inProgressPackages.filter((p) => p !== pkg)

      if (result.status === "completed") {
        progress.completedPackages.push(pkg)
      } else {
        progress.failedPackages.push({ name: pkg, reason: result.error ?? "unknown" })
      }

      progress.lastUpdated = new Date().toISOString()
      await this.saveProgress(progress)
      results.push(result)
    }

    return {
      total: plan.packageMappings.length,
      completed: progress.completedPackages.length,
      failed: progress.failedPackages.length,
      manual: progress.manualRequired.length,
      results,
      progress,
    }
  }

  /**
   * 翻译单个 Package。
   * 实际执行中，这会通过 workflow 工具由 LLM 驱动完成。
   * 这里的骨架展示了编排逻辑。
   */
  private async translatePackage(input: PackageTranslationInput): Promise<PackageResult> {
    const runId = `translate-${input.oraclePackage}-${Date.now()}`

    try {
      // 1. 启动 Level 2 工作流
      const run = this.engine.start(translationWorkflow, runId, {
        package: input.oraclePackage,
        sourceRoot: this.config.sourceRoot,
      })

      // 2. LLM 会按阶段调用 workflow advance/retry
      //    编排器在此等待完成（实际由 LLM 驱动，这里返回 runId 供后续追踪）
      return {
        package: input.oraclePackage,
        status: "started",
        runId,
        error: undefined,
      }
    } catch (err: any) {
      return {
        package: input.oraclePackage,
        status: "failed",
        error: err.message,
      }
    }
  }

  // --- helpers ---

  private buildPackageInput(
    pkg: string,
    mapping: any,
    plan: any,
    progress: TranslationProgress,
  ): PackageTranslationInput {
    return {
      oraclePackage: pkg,
      sourceFiles: {
        spec: `${this.config.sourceRoot}/${pkg.toLowerCase()}.pks`,
        body: `${this.config.sourceRoot}/${pkg.toLowerCase()}.pkb`,
      },
      mapping,
      rules: plan.rules,
      availableMappers: progress.completedPackages,
    }
  }

  private async loadPlan(): Promise<any> {
    const fs = await import("fs")
    const content = fs.readFileSync(this.config.planPath, "utf-8")
    return JSON.parse(content)
  }

  private async loadOrCreateProgress(plan: any): Promise<TranslationProgress> {
    const fs = await import("fs")
    try {
      const content = fs.readFileSync(this.config.progressPath, "utf-8")
      return JSON.parse(content)
    } catch {
      const prog = defaultProgress(
        plan.packageMappings?.length ?? 0,
        0,
      )
      await this.saveProgress(prog)
      return prog
    }
  }

  private async saveProgress(progress: TranslationProgress): Promise<void> {
    const fs = await import("fs")
    fs.writeFileSync(this.config.progressPath, JSON.stringify(progress, null, 2), "utf-8")
  }
}

// ---------------------------------------------------------------------------
// Result Types
// ---------------------------------------------------------------------------

interface PackageResult {
  package: string
  status: "completed" | "failed" | "manual" | "skipped" | "started"
  runId?: string
  reason?: string
  error?: string
}

interface BatchResult {
  total: number
  completed: number
  failed: number
  manual: number
  results: PackageResult[]
  progress: TranslationProgress
}
