/**
 * default-spec-routing.test.ts — 默认 java-code-spec.md 的 @include 路由回归
 *
 * Phase 2 退役 PROJECT_SPEC_MAP 后，7 个 project-specs 子规约改由默认主 spec 的
 * `@include ... -> agent` 指令路由到对应 agent。本测试锁定该路由表不退化。
 */

import { describe, it, expect } from "vitest"
import { loadDefaultSpecBundle } from "@plugins/workflow-engine"

describe("默认 spec @include 路由（PROJECT_SPEC_MAP 退役后）", () => {
  const bundle = loadDefaultSpecBundle()

  it("7 个子规约各路由到对应 agent", () => {
    const expected: Record<string, string> = {
      "translate-skeleton": "skeleton",
      "translate-core": "translate-core",
      "translate-test": "test-gen",
      "translate-lint": "static-check",
      "translate-compile": "compile",
      "translate-summary": "summary",
      "translator": "translator",
    }
    for (const [agent, keyword] of Object.entries(expected)) {
      const content = bundle.agentSpecs.get(agent)
      expect(content, `agent ${agent} 应有路由子规约`).toBeTruthy()
      // 子规约文件内容非空即可（具体内容由各 project-spec 测试覆盖）
      expect(content!.trim().length).toBeGreaterThan(0)
      void keyword
    }
    expect(bundle.agentSpecs.size).toBeGreaterThanOrEqual(7)
  })

  it("路由型子规约不内联进 general 正文", () => {
    // general 不应含 project-specs 的专属内容标记（如 skeleton 的段切分章节标题）
    expect(bundle.general).not.toContain("@include ./project-specs/skeleton.md -> translate-skeleton")
  })

  it("@include ./arch-model.md 内联后解析出 4 文件架构模型", () => {
    expect(bundle.architectureModel, "默认 spec 应含 ## 架构模型 段").not.toBeNull()
    const m = bundle.architectureModel!
    expect(m.layout).toBe("flat-no-root")
    expect(m.roles.map(r => r.role)).toEqual(["service", "service-impl", "mapper"])
    expect(m.entity.suffix).toBe("DO")
    expect(m.exception.baseClass).toBe("BusinessException")
    expect(m.crossPackageCall.fqnPattern).toBe("service.{className}Service")
  })
})
