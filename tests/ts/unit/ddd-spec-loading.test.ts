/**
 * ddd-spec-loading.test.ts — DDD 完整规约体系加载测试
 *
 * 验证 `specs/ddd/java-code-spec.md` 作为 `--spec` 主规约时：
 *   - @include ./arch-model.md 内联并解析出 DDD 架构模型（rooted-module / processor implRole /
 *     Bean 实体 / TranFailException）
 *   - 7 条 @include ./translation-specs/*.md -> agent 路由登记到 agentSpecs，内容为 DDD 子规约
 *   - 路由型子规约不内联进 general 正文
 *
 * 证明 `--spec .opencode/specs/ddd/java-code-spec.md` 能正确驱动 DDD 全套规约注入。
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve, join } from "node:path"
import { resolveIncludes } from "@plugins/workflow-engine"
import { parseArchitectureModel } from "@workflow/architecture-model"

const DDD_SPEC_DIR = resolve(import.meta.dirname, "../../../.opencode/specs/ddd")
const DDD_MAIN = readFileSync(join(DDD_SPEC_DIR, "java-code-spec.md"), "utf-8")

describe("DDD 主规约 @include 路由", () => {
  const agentSpecs = new Map<string, string>()
  const inlined = resolveIncludes(DDD_MAIN, DDD_SPEC_DIR, agentSpecs)

  it("7 个 DDD 子规约各路由到对应 agent", () => {
    const agents = ["translate-skeleton", "translate-core", "translate-test",
      "translate-lint", "translate-compile", "translate-summary", "translator"]
    for (const a of agents) {
      expect(agentSpecs.get(a), `agent ${a} 应有 DDD 路由子规约`).toBeTruthy()
    }
    expect(agentSpecs.size).toBeGreaterThanOrEqual(7)
  })

  it("路由型 DDD 子规约不内联进 general 正文", () => {
    expect(inlined).not.toContain("@include ./translation-specs/skeleton.md -> translate-skeleton")
    // general 应含 DDD 模型段（@include ./arch-model.md 内联）
    expect(inlined).toContain("## 架构模型")
    expect(inlined).toContain("### 角色")
  })

  it("DDD 子规约内容为 DDD 风格（test-gen 含 ProcessorTest）", () => {
    const testGen = agentSpecs.get("translate-test")!
    expect(testGen).toContain("ProcessorTest")
    expect(testGen).toContain("TranFailException")
  })
})

describe("DDD 架构模型解析", () => {
  it("specs/ddd/arch-model.md 解析为 DDD 模型", () => {
    const archModel = readFileSync(join(DDD_SPEC_DIR, "arch-model.md"), "utf-8")
    const m = parseArchitectureModel(archModel)!
    expect(m).not.toBeNull()
    expect(m.layout).toBe("rooted-module")
    expect(m.packageBase).toBe("{packageBase}")
    // 角色含 DDD 分层
    const roles = m.roles.map(r => r.role)
    expect(roles).toContain("access")
    expect(roles).toContain("processor")
    expect(roles).toContain("aggregate")
    expect(roles).toContain("builder")
    expect(roles).toContain("validator")
    // processor 为实现层（test-gen 目标）
    const proc = m.roles.find(r => r.role === "processor")!
    expect(proc.implRole).toBe(true)
    expect(proc.testSuffix).toBe("ProcessorTest")
    // DDD 实体 Bean + TranFailException
    expect(m.entity.suffix).toBe("Bean")
    expect(m.entity.annotations).toEqual(["@Component"])
    expect(m.exception.baseClass).toBe("TranFailException")
    // 跨包调用 FQN 走 access 层（{packageBase} 运行时占位，由 loadArchitectureModel 注入）
    expect(m.crossPackageCall.fqnPattern).toBe("{packageBase}.{module}.access.{className}AccessIntf")
  })
})
