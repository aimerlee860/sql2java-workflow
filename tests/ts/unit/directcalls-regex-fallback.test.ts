/**
 * directcalls-regex-fallback.test.ts — directCalls 正则兜底测试
 *
 * GaussDB 项目用 Oracle 改编 grammar 解析错误率较高，AST 语法错误恢复漏抽调用节点 → directCalls
 * 为空。extractCallsByRegex 用正则从 body 区间文本抽调用，三段形式（schema.pkg.proc / pkg.proc /
 * proc）兼容，走 resolveQualifiedName 归一化 + 已知子程序收窄。repairMissingDirectCalls 在
 * buildInventoryFromIndex 里对 directCalls 为空者兜底回填。
 *
 * 两层测试：
 *   1) extractCallsByRegex / resolveQualifiedName 单元测试（三段形式 / 噪声过滤 / 声明头排除 / 区间隔离）
 *   2) buildInventoryFromIndex 集成测试（directCalls=[] → 回填 subprograms/*.json + warning）
 */

import { describe, it, expect, beforeAll } from "vitest"
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { extractCallsByRegex, resolveQualifiedName } from "@workflow/plsql-file-scanner"
import { buildInventoryFromIndex } from "@workflow/inventory-builder"
import type { InventoryIndex, PackageInfo, SubprogramInfo } from "@workflow/plsql-scanner"

// ── 单元：resolveQualifiedName 三段归一化 ──────────────────────────────────────

describe("resolveQualifiedName 三段归一化", () => {
  it("1段裸名→callerPkg；2段补callerSchema；3段精确", () => {
    expect(resolveQualifiedName("proc", "MFG_ERP.P_FOO")).toEqual({ pkg: "MFG_ERP.P_FOO", member: "PROC" })
    expect(resolveQualifiedName("P_BAR.DO_BAR", "MFG_ERP.P_FOO")).toEqual({ pkg: "MFG_ERP.P_BAR", member: "DO_BAR" })
    expect(resolveQualifiedName("MFG_ERP.P_BAR.DO_BAR", "MFG_ERP.P_FOO")).toEqual({ pkg: "MFG_ERP.P_BAR", member: "DO_BAR" })
  })

  it("去引号 + 大写归一化", () => {
    expect(resolveQualifiedName('"p_bar".do_bar', "MFG_ERP.P_FOO")).toEqual({ pkg: "MFG_ERP.P_BAR", member: "DO_BAR" })
  })

  it("caller 无 schema 前缀时 2 段不补 schema", () => {
    expect(resolveQualifiedName("P_BAR.DO_BAR", "P_FOO")).toEqual({ pkg: "P_BAR", member: "DO_BAR" })
  })
})

// ── 单元：extractCallsByRegex ──────────────────────────────────────────────────

/** 已知子程序索引：MFG_ERP.P_FOO{FOO_PROC,HELPER} / MFG_ERP.P_BAR{DO_BAR} / MFG_ERP.P_BAZ{DO_BAZ} */
function makeIndex(): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>()
  idx.set("MFG_ERP.P_FOO", new Set(["FOO_PROC", "HELPER"]))
  idx.set("MFG_ERP.P_BAR", new Set(["DO_BAR"]))
  idx.set("MFG_ERP.P_BAZ", new Set(["DO_BAZ"]))
  return idx
}

// foo_proc 声明头 + 三段调用 + 噪声（类型构造/集合访问/SQL内建/嵌套声明头/未解析包）
const CODE_MIXED = `PROCEDURE foo_proc(p IN NUMBER) IS
  v NUMBER;
BEGIN
  MFG_ERP.P_BAR.DO_BAR(p);
  P_BAZ.DO_BAZ(p);
  helper(p);
  pkg.t_rec_type(p);
  pkg.g_array(1);
  TO_CHAR(p);
  v := pkg.compute(p);
  PROCEDURE inner(x NUMBER) IS BEGIN NULL; END inner;
END foo_proc;
`

describe("extractCallsByRegex 三段调用形式 + 噪声过滤 + 声明头排除", () => {
  const calls = extractCallsByRegex(CODE_MIXED, "MFG_ERP.P_FOO", [1, 20], makeIndex())
  const keys = calls.map(c => `${c.package}.${c.name}`).sort()

  it("抽得三段形式调用（schema.pkg.proc / pkg.proc / 裸名同包）", () => {
    expect(keys).toEqual([
      "MFG_ERP.P_BAR.DO_BAR",   // 3 段 schema.pkg.proc
      "MFG_ERP.P_BAZ.DO_BAZ",   // 2 段 pkg.proc（补 callerSchema=MFG_ERP）
      "MFG_ERP.P_FOO.HELPER",   // 1 段裸名同包
    ])
  })

  it("kind 统一标 procedure", () => {
    expect(calls.every(c => c.kind === "procedure")).toBe(true)
  })

  it("line 为调用点所在文件行号", () => {
    const doBar = calls.find(c => c.name === "DO_BAR")!
    expect(doBar.line).toBe(4) // CODE_MIXED 第 4 行
  })

  it("排除声明头：foo_proc 声明头（在索引里）不被误抽为自调用", () => {
    expect(keys).not.toContain("MFG_ERP.P_FOO.FOO_PROC")
  })

  it("排除嵌套声明头 inner（行首 PROCEDURE）", () => {
    expect(keys).not.toContain("MFG_ERP.P_FOO.INNER")
  })

  it("收窄丢弃未解析包的类型构造 / 集合访问 / 变量方法（pkg.* 不在索引）", () => {
    expect(keys).not.toContain("MFG_ERP.PKG.T_REC_TYPE")
    expect(keys).not.toContain("MFG_ERP.PKG.G_ARRAY")
    expect(keys).not.toContain("MFG_ERP.PKG.COMPUTE")
  })

  it("SQL_PSEUDO 内建函数 TO_CHAR 丢弃", () => {
    expect(keys).not.toContain("MFG_ERP.P_FOO.TO_CHAR")
  })
})

describe("extractCallsByRegex 区间隔离", () => {
  // 同包两个子程序：a_proc 调 DO_BAR，b_proc 调 DO_BAZ，body 分处不同行区间
  const CODE_TWO = `PROCEDURE a_proc IS
BEGIN
  P_BAR.DO_BAR(1);
END a_proc;
PROCEDURE b_proc IS
BEGIN
  P_BAZ.DO_BAZ(1);
END b_proc;
`
  it("a_proc 区间 [1,3] 只抽 DO_BAR，不串到 b_proc 的 DO_BAZ", () => {
    const calls = extractCallsByRegex(CODE_TWO, "MFG_ERP.P_FOO", [1, 3], makeIndex())
    expect(calls.map(c => c.name).sort()).toEqual(["DO_BAR"])
  })
  it("b_proc 区间 [5,7] 只抽 DO_BAZ，不串到 a_proc 的 DO_BAR", () => {
    const calls = extractCallsByRegex(CODE_TWO, "MFG_ERP.P_FOO", [5, 7], makeIndex())
    expect(calls.map(c => c.name).sort()).toEqual(["DO_BAZ"])
  })
})

describe("extractCallsByRegex 去重", () => {
  it("同一调用点不重复；不同行同 callee 各保留", () => {
    const code = `BEGIN
  P_BAR.DO_BAR(1);
  P_BAR.DO_BAR(2);
END;
`
    const calls = extractCallsByRegex(code, "MFG_ERP.P_FOO", [1, 10], makeIndex())
    expect(calls.length).toBe(2) // 两行各一条，line 不同
    expect(calls.every(c => c.name === "DO_BAR")).toBe(true)
  })
})

describe("extractCallsByRegex 剥注释", () => {
  it("行注释 / 块注释里的调用不被抽（AST 不解析注释，regex 兜底须对齐）", () => {
    const code = `BEGIN
  -- P_BAR.DO_BAR(1);
  /* P_BAZ.DO_BAZ(2); */
  P_BAR.DO_BAR(3);
END;
`
    const calls = extractCallsByRegex(code, "MFG_ERP.P_FOO", [1, 10], makeIndex())
    expect(calls.length).toBe(1)             // 仅第 4 行真实调用
    expect(calls[0].name).toBe("DO_BAR")
    expect(calls[0].line).toBe(4)
  })
})

// ── 集成：buildInventoryFromIndex 兜底回填 ─────────────────────────────────────

const BODY_SQL = `CREATE OR REPLACE PACKAGE BODY MFG_ERP.P_FOO IS
  PROCEDURE foo_proc(p IN NUMBER) IS
  BEGIN
    MFG_ERP.P_BAR.DO_BAR(p);
    P_BAZ.DO_BAZ(p);
    helper(p);
  END foo_proc;
  PROCEDURE helper IS BEGIN NULL; END helper;
END P_FOO;
`

let dir: string
let bodyFile: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "inv-dc-fallback-"))
  bodyFile = join(dir, "P_FOO.body.sql")
  writeFileSync(bodyFile, BODY_SQL, "utf-8")
})

function makeIdx(): InventoryIndex {
  const pkg: PackageInfo = {
    packageName: "MFG_ERP.P_FOO",
    absolutePaths: [bodyFile],
    headerPath: null,
    bodyPath: bodyFile,
    constants: [], variables: [], exceptions: [], types: [],
    functions: [], procedures: ["FOO_PROC", "HELPER"], estimatedLoc: 9,
  }
  // foo_proc body 区间 [2,7]（声明行到 END foo_proc;）。模拟 AST 漏抽调用 → directCalls=[]。
  const fooProc: SubprogramInfo = {
    name: "FOO_PROC", type: "PROCEDURE", belongToPackage: "MFG_ERP.P_FOO",
    overloadIndex: null, isPrivate: false,
    headerLocation: { absolutePath: bodyFile, lineRange: [2, 7] },
    bodyLocation: { absolutePath: bodyFile, lineRange: [2, 7] },
    parameters: [], returnType: null, loc: 6,
    directCalls: [], packageRefs: [],
  }
  // helper body 无调用，兜底抽 0 条（不 warn）
  const helper: SubprogramInfo = {
    name: "HELPER", type: "PROCEDURE", belongToPackage: "MFG_ERP.P_FOO",
    overloadIndex: null, isPrivate: false,
    headerLocation: { absolutePath: bodyFile, lineRange: [8, 8] },
    bodyLocation: { absolutePath: bodyFile, lineRange: [8, 8] },
    parameters: [], returnType: null, loc: 1,
    directCalls: [], packageRefs: [],
  }
  // 占位 callee 子程序：让 repairMissingDirectCalls 的 subprogramIndex 含 P_BAR.DO_BAR /
  // P_BAZ.DO_BAZ（真实场景闭包内子程序都在 idx）。bodyLocation=null → 兜底跳过，不读 body。
  const doBar: SubprogramInfo = {
    name: "DO_BAR", type: "PROCEDURE", belongToPackage: "MFG_ERP.P_BAR",
    overloadIndex: null, isPrivate: false,
    headerLocation: null, bodyLocation: null,
    parameters: [], returnType: null, loc: 0,
    directCalls: [], packageRefs: [],
  }
  const doBaz: SubprogramInfo = {
    name: "DO_BAZ", type: "PROCEDURE", belongToPackage: "MFG_ERP.P_BAZ",
    overloadIndex: null, isPrivate: false,
    headerLocation: null, bodyLocation: null,
    parameters: [], returnType: null, loc: 0,
    directCalls: [], packageRefs: [],
  }
  return {
    sourcePath: dir, scannedAt: new Date().toISOString(), scannerUsed: "ast",
    warnings: [],
    packages: [pkg],
    subprograms: [fooProc, helper, doBar, doBaz],
    tables: [], triggers: [], views: [], sequences: [], standaloneProcedures: [],
  } as InventoryIndex
}

describe("buildInventoryFromIndex directCalls 正则兜底回填", () => {
  it("directCalls 为空 → regex 兜底抽得三段调用，落盘 subprograms/*.json", () => {
    const outDir = join(dir, "case1")
    mkdirSync(outDir, { recursive: true })
    const r = buildInventoryFromIndex(outDir, makeIdx())
    const sub = JSON.parse(readFileSync(join(outDir, "subprograms", "MFG_ERP.P_FOO.FOO_PROC.json"), "utf-8"))
    const keys = sub.directCalls.map((c: any) => `${c.package}.${c.name}`).sort()
    expect(keys).toEqual([
      "MFG_ERP.P_BAR.DO_BAR",
      "MFG_ERP.P_BAZ.DO_BAZ",
      "MFG_ERP.P_FOO.HELPER",
    ])
    expect(r.warnings.some(w => w.includes("directCalls 正则兜底命中") && w.includes("FOO_PROC"))).toBe(true)
  })

  it("helper body 无调用：兜底抽 0 条，不 warn", () => {
    const outDir = join(dir, "case2")
    mkdirSync(outDir, { recursive: true })
    const r = buildInventoryFromIndex(outDir, makeIdx())
    const sub = JSON.parse(readFileSync(join(outDir, "subprograms", "MFG_ERP.P_FOO.HELPER.json"), "utf-8"))
    expect(sub.directCalls).toEqual([])
    expect(r.warnings.some(w => w.includes("directCalls 正则兜底命中") && w.includes("HELPER"))).toBe(false)
  })

  it("directCalls 已非空时不重抽（保留 AST 结果）", () => {
    const idx = makeIdx()
    // 手工塞一条 AST 抽出的调用，模拟正常解析——兜底不应覆盖
    idx.subprograms[0].directCalls = [{ package: "MFG_ERP.P_BAR", name: "DO_BAR", line: 99, kind: "procedure" }]
    const outDir = join(dir, "case3")
    mkdirSync(outDir, { recursive: true })
    buildInventoryFromIndex(outDir, idx)
    const sub = JSON.parse(readFileSync(join(outDir, "subprograms", "MFG_ERP.P_FOO.FOO_PROC.json"), "utf-8"))
    // 保留原 AST 调用（line 99），不混入 regex 抽的 DO_BAZ/HELPER
    expect(sub.directCalls).toEqual([{ package: "MFG_ERP.P_BAR", name: "DO_BAR", line: 99, kind: "procedure" }])
  })
})
