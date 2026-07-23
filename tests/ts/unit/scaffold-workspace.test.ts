import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  activeProjectRootFor,
  commitScaffoldWorkspace,
  ensureScaffoldWorkspace,
  recordScaffoldFailure,
  rotateScaffoldWorkspace,
} from "@workflow/scaffold-workspace"

let temp: string
let artifactsDir: string
let finalRoot: string

function makeRun(runId = "run-A") {
  return { runId, currentPhase: "scaffold", metadata: {} as Record<string, unknown> }
}

beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), "scaffold-workspace-"))
  artifactsDir = join(temp, "artifacts", "run-A")
  finalRoot = join(temp, "generated", "app")
})

afterEach(() => {
  rmSync(temp, { recursive: true, force: true })
})

describe("scaffold 事务工作区", () => {
  it("首次创建 attempt-1，scaffold 使用临时根目录", () => {
    const run = makeRun()
    const state = ensureScaffoldWorkspace(run, artifactsDir, finalRoot)
    expect(state.attempt).toBe(1)
    expect(state.root).toBe(join(artifactsDir, "workspace", "scaffold", "attempt-1", "project"))
    expect(activeProjectRootFor(run, finalRoot, artifactsDir)).toBe(state.root)
    run.currentPhase = "inventory"
    expect(activeProjectRootFor(run, finalRoot, artifactsDir)).toBe(finalRoot)
  })

  it("同 run 的旧正式目录可无损迁移到工作区继续执行", () => {
    mkdirSync(finalRoot, { recursive: true })
    writeFileSync(join(finalRoot, ".sql2java-run-id"), "run-A", "utf-8")
    writeFileSync(join(finalRoot, "pom.xml"), "legacy", "utf-8")
    const state = ensureScaffoldWorkspace(makeRun(), artifactsDir, finalRoot)
    expect(readFileSync(join(state.root, "pom.xml"), "utf-8")).toBe("legacy")
  })

  it("内容失败时隔离旧尝试并创建空白下一尝试", () => {
    const run = makeRun()
    const first = ensureScaffoldWorkspace(run, artifactsDir, finalRoot)
    writeFileSync(join(first.root, "stale.java"), "stale", "utf-8")
    writeFileSync(join(artifactsDir, "scaffold.json"), "{}", "utf-8")
    recordScaffoldFailure(run, "content", "布局错误")
    const second = rotateScaffoldWorkspace(run, artifactsDir)
    expect(second.attempt).toBe(2)
    expect(second.lastFailureKind).toBe("content")
    expect(existsSync(join(second.root, "stale.java"))).toBe(false)
    const quarantineName = readdirSync(join(artifactsDir, "quarantine")).find(name => name.startsWith("scaffold-attempt-1-"))
    expect(quarantineName).toBeTruthy()
    expect(existsSync(join(artifactsDir, "scaffold.json"))).toBe(false)
    expect(quarantineName && existsSync(join(artifactsDir, "quarantine", quarantineName, "scaffold.json"))).toBe(true)
  })

  it("通过后原子提升，并备份既有正式目录", () => {
    mkdirSync(finalRoot, { recursive: true })
    writeFileSync(join(finalRoot, "old.txt"), "old", "utf-8")
    const run = makeRun()
    const state = ensureScaffoldWorkspace(run, artifactsDir, finalRoot)
    writeFileSync(join(state.root, "pom.xml"), "new", "utf-8")

    const result = commitScaffoldWorkspace(run, artifactsDir, finalRoot)
    expect(result.ok).toBe(true)
    expect(readFileSync(join(finalRoot, "pom.xml"), "utf-8")).toBe("new")
    expect(readFileSync(join(finalRoot, ".sql2java-run-id"), "utf-8")).toBe("run-A")
    expect(result.backupPath && existsSync(join(result.backupPath, "old.txt"))).toBe(true)
    expect(commitScaffoldWorkspace(run, artifactsDir, finalRoot).ok).toBe(true)
  })
})
