/**
 * spec-include.test.ts — @include 解析（内联 + 路由 + 防环 + 缺失）单测
 *
 * 覆盖主 spec 引用子 spec 的两种语义：
 *   - `@include <path>`        → 内联进通用正文
 *   - `@include <path> -> agent` → 路由为 agent 专属段（不内联）
 * 递归 include、循环/重复跳过、缺失文件保留原行。
 */

import { describe, it, expect } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { resolveIncludes } from "@plugins/workflow-engine"

function setup(): string {
  const dir = mkdtempSync(join(tmpdir(), "spec-inc-"))
  return dir
}

describe("resolveIncludes — 内联", () => {
  it("无 @include 的文本原样返回", () => {
    const dir = setup()
    const out = resolveIncludes("## 一、x\n正文\n", dir, new Map())
    expect(out).toBe("## 一、x\n正文\n")
  })
  it("@include 子文件内容内联到指令位置", () => {
    const dir = setup()
    writeFileSync(join(dir, "sub.md"), "子内容")
    const main = "前文\n@include ./sub.md\n后文"
    expect(resolveIncludes(main, dir, new Map())).toBe("前文\n子内容\n后文")
  })
  it("递归 include（子文件再 include）", () => {
    const dir = setup()
    writeFileSync(join(dir, "a.md"), "A起\n@include ./b.md\nA终")
    writeFileSync(join(dir, "b.md"), "B内容")
    expect(resolveIncludes("@include ./a.md", dir, new Map())).toBe("A起\nB内容\nA终")
  })
})

describe("resolveIncludes — 路由", () => {
  it("@include -> agent 登记到 agentSpecs 且不内联", () => {
    const dir = setup()
    mkdirSync(join(dir, "translation-specs"), { recursive: true })
    writeFileSync(join(dir, "translation-specs", "skeleton.md"), "skeleton 专属规则")
    const agentSpecs = new Map<string, string>()
    const out = resolveIncludes(
      "通用\n@include ./translation-specs/skeleton.md -> translate-skeleton\n尾部", dir, agentSpecs,
    )
    expect(out).toBe("通用\n尾部")  // 路由行被移除
    expect(agentSpecs.get("translate-skeleton")).toBe("skeleton 专属规则")
  })
  it("同一文件可路由给多个 agent", () => {
    const dir = setup()
    writeFileSync(join(dir, "shared.md"), "公共规则")
    const agentSpecs = new Map<string, string>()
    resolveIncludes(
      "@include ./shared.md -> a\n@include ./shared.md -> b", dir, agentSpecs,
    )
    expect(agentSpecs.get("a")).toBe("公共规则")
    expect(agentSpecs.get("b")).toBe("公共规则")
  })
})

describe("resolveIncludes — 容错", () => {
  it("缺失文件 warn 并保留原指令行", () => {
    const dir = setup()
    const out = resolveIncludes("@include ./nope.md", dir, new Map())
    expect(out).toBe("@include ./nope.md")
  })
  it("循环引用跳过（不无限递归）", () => {
    const dir = setup()
    writeFileSync(join(dir, "a.md"), "A\n@include ./b.md")
    writeFileSync(join(dir, "b.md"), "B\n@include ./a.md")
    const out = resolveIncludes("@include ./a.md", dir, new Map())
    // a 展开 → b 展开 → 再遇 a 跳过
    expect(out).toContain("A")
    expect(out).toContain("B")
    expect(out.match(/@include \/tmp|A\n@include/g)).toBeNull()
  })
  it("同一内联文件重复引用只展开一次", () => {
    const dir = setup()
    writeFileSync(join(dir, "sub.md"), "X")
    const out = resolveIncludes("@include ./sub.md\n---\n@include ./sub.md", dir, new Map())
    expect(out).toBe("X\n---")  // 第二次跳过，不重复
  })
  it("代码围栏内的 @include 不当指令处理", () => {
    const dir = setup()
    writeFileSync(join(dir, "real.md"), "真实内容")
    const main = [
      "正文上",
      "```",
      "@include ./real.md   ← 代码块内示例，不应处理",
      "@include ./nope.md -> fake-agent",
      "```",
      "正文下",
    ].join("\n")
    const agentSpecs = new Map<string, string>()
    const out = resolveIncludes(main, dir, agentSpecs)
    // 围栏内 @include 原样保留，不内联、不路由
    expect(out).toContain("@include ./real.md   ← 代码块内示例，不应处理")
    expect(agentSpecs.has("fake-agent")).toBe(false)
    // 围栏外若有真实 @include 仍正常（此处无，仅验证围栏内被跳过）
    expect(out).toContain("正文上")
    expect(out).toContain("正文下")
  })
})
