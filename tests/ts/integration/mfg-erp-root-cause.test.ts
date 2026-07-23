/**
 * MFG_ERP 真实失败根因回归：签名/包状态/无括号零参函数依赖必须在 inventory 阶段确定。
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { resolve, join } from "node:path"
import { tmpdir } from "node:os"
import { scanSource, type InventoryIndex } from "@workflow/plsql-scanner"
import { buildInventoryFromIndex } from "@workflow/inventory-builder"
import { buildDependencyGraph, clearDependencyGraphCache } from "@workflow/dependency-graph"

describe("MFG_ERP inventory 根因回归", () => {
  let index: InventoryIndex
  let artifactsDir: string

  beforeAll(async () => {
    const sourceRoot = resolve(import.meta.dirname, "../../../resources/MFG_ERP")
    artifactsDir = mkdtempSync(join(tmpdir(), "mfg-root-cause-"))
    index = await scanSource(sourceRoot)
    buildInventoryFromIndex(artifactsDir, index)
  }, 180000)

  afterAll(() => {
    clearDependencyGraphCache()
    rmSync(artifactsDir, { recursive: true, force: true })
  })

  it("GEN_DOC_NO 的参数、返回类型和 CURR_BIZ_DATE 调用不再交给 LLM 猜测", () => {
    const unit = index.subprograms.find(sub => sub.belongToPackage === "MFG_ERP.F_UTIL" && sub.name === "GEN_DOC_NO")!
    expect(unit.parameters).toHaveLength(3)
    expect(unit.returnType).toContain("VARCHAR2")
    expect(unit.directCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ package: "MFG_ERP.F_UTIL", name: "CURR_BIZ_DATE", kind: "function" }),
    ]))
  })

  it("F_UTIL 包状态一次性完整进入 scaffold 输入", () => {
    const pkg = index.packages.find(value => value.packageName === "MFG_ERP.F_UTIL")!
    expect(pkg.variables.map(value => value.name)).toEqual(expect.arrayContaining([
      "G_CURR_BIZ_DATE", "G_LAST_BIZ_DATE", "G_NEXT_BIZ_DATE", "G_CURR_OPERATOR", "G_SESSION_ID",
    ]))
  })

  it("依赖图保证 CURR_BIZ_DATE 先于 GEN_DOC_NO 翻译", () => {
    const graph = buildDependencyGraph(artifactsDir)
    expect(graph.callGraph["MFG_ERP.F_UTIL.GEN_DOC_NO"]).toContain("MFG_ERP.F_UTIL.CURR_BIZ_DATE")
    const order = graph.procedureOrder.flat()
    expect(order.indexOf("MFG_ERP.F_UTIL.CURR_BIZ_DATE")).toBeLessThan(order.indexOf("MFG_ERP.F_UTIL.GEN_DOC_NO"))
  })
})
