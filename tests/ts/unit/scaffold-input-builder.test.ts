/**
 * scaffold-input-builder.test.ts — generateScaffoldInput 聚合单测
 *
 * 用合成 inventory + packages + tables 样本验证：
 *   - 仅保留 scaffold 消费的窄字段，丢弃噪声（subprograms 不读；packages 的 types/exceptions/
 *     bodyPath/estimatedLoc/complexity 丢；tables 的 ddlFile 丢）
 *   - sourcePath 取 absolutePaths[0] ?? headerPath（constants/variables 空时兜底读源码用）
 *   - 稳定顺序保持（packageNames 序 → 包内 procedures/functions 原序）
 *   - 单文件缺失容错（warn 跳过，不阻断）
 */

import { describe, it, expect, beforeAll } from "vitest"
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { generateScaffoldInput } from "@workflow/scaffold-input-builder"

describe("generateScaffoldInput", () => {
  let dir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "scaffold-input-"))
    mkdirSync(join(dir, "packages"), { recursive: true })
    mkdirSync(join(dir, "tables"), { recursive: true })

    writeFileSync(join(dir, "inventory.json"), JSON.stringify({
      packageNames: ["SCHEMA.PKG_A", "SCHEMA.PKG_B"],
      tableNames: ["SCHEMA.T_FOO", "SCHEMA.T_BAR"],
      sequences: [{ name: "SCHEMA.SEQ_FOO", startWith: 1, incrementBy: 1 }],
      views: [{ name: "SCHEMA.V_FOO", columns: ["c1", "c2"] }],
      triggers: [{ name: "NOISE_TRIGGER" }], // 不应进 scaffold-input
    }))

    writeFileSync(join(dir, "packages", "SCHEMA.PKG_A.json"), JSON.stringify({
      packageName: "SCHEMA.PKG_A",
      absolutePaths: ["/proj/resources/SCHEMA/PACKAGE/PKG_A.sql"],
      headerPath: "/proj/resources/SCHEMA/PACKAGE/PKG_A.sql",
      bodyPath: null,
      constants: [{ name: "C_RATE", value: "0.1", type: "NUMBER" }],
      variables: [], // 扫描器留空 → 兜底读 source.sql
      exceptions: [{ name: "E_NOISY" }], // 噪声，应丢
      types: [{ name: "T_NOISY" }], // 噪声，应丢
      procedures: ["DO_A", "DO_B"],
      functions: ["GET_A"],
      estimatedLoc: 999, // 噪声
      complexity: 999, // 噪声
    }))

    writeFileSync(join(dir, "packages", "SCHEMA.PKG_B.json"), JSON.stringify({
      packageName: "SCHEMA.PKG_B",
      absolutePaths: [], // 空 → 回退 headerPath
      headerPath: "/proj/resources/SCHEMA/PACKAGE/PKG_B.sql",
      constants: [],
      variables: [{ name: "G_STATE", type: "VARCHAR2", defaultValue: null }],
      procedures: [],
      functions: ["GET_B"],
    }))

    writeFileSync(join(dir, "tables", "SCHEMA.T_FOO.json"), JSON.stringify({
      name: "SCHEMA.T_FOO",
      ddlFile: "/proj/resources/SCHEMA/TABLE/FOO.SQL", // 噪声，应丢
      columns: [{ name: "ID", plsqlType: "NUMBER(18)", nullable: false, isPrimaryKey: true, defaultValue: null }],
      primaryKey: { columns: ["ID"] },
      foreignKeys: [],
    }))

    writeFileSync(join(dir, "tables", "SCHEMA.T_BAR.json"), JSON.stringify({
      name: "SCHEMA.T_BAR",
      columns: [{ name: "CODE", plsqlType: "VARCHAR2(40)", nullable: false, isPrimaryKey: false, defaultValue: null }],
      primaryKey: null,
      foreignKeys: [{ name: "FK_BAR", columns: ["FOO_ID"], refTable: "T_FOO", refColumns: ["ID"] }],
    }))
  })

  it("落盘 scaffold-input.json 且结构完整", () => {
    generateScaffoldInput(dir)
    const out = JSON.parse(readFileSync(join(dir, "scaffold-input.json"), "utf-8"))
    expect(out.packageNames).toEqual(["SCHEMA.PKG_A", "SCHEMA.PKG_B"])
    expect(out.sequences).toHaveLength(1)
    expect(out.views).toHaveLength(1)
    // 噪声字段不进产物
    expect(out.triggers).toBeUndefined()
  })

  it("packages 仅保留窄字段 + sourcePath，丢弃 types/exceptions/bodyPath/loc/complexity", () => {
    const out = JSON.parse(readFileSync(join(dir, "scaffold-input.json"), "utf-8"))
    const a = out.packages[0]
    expect(a.packageName).toBe("SCHEMA.PKG_A")
    expect(a.sourcePath).toBe("/proj/resources/SCHEMA/PACKAGE/PKG_A.sql")
    expect(a.constants).toEqual([{ name: "C_RATE", value: "0.1", type: "NUMBER" }])
    expect(a.variables).toEqual([])
    expect(a.procedures).toEqual(["DO_A", "DO_B"])
    expect(a.functions).toEqual(["GET_A"])
    // 噪声字段已丢
    expect(a.types).toBeUndefined()
    expect(a.exceptions).toBeUndefined()
    expect(a.bodyPath).toBeUndefined()
    expect(a.estimatedLoc).toBeUndefined()
    expect(a.complexity).toBeUndefined()
  })

  it("sourcePath 在 absolutePaths 空时回退 headerPath", () => {
    const out = JSON.parse(readFileSync(join(dir, "scaffold-input.json"), "utf-8"))
    expect(out.packages[1].sourcePath).toBe("/proj/resources/SCHEMA/PACKAGE/PKG_B.sql")
  })

  it("packages 保持 packageNames 稳定顺序", () => {
    const out = JSON.parse(readFileSync(join(dir, "scaffold-input.json"), "utf-8"))
    expect(out.packages.map((p: any) => p.packageName)).toEqual(["SCHEMA.PKG_A", "SCHEMA.PKG_B"])
  })

  it("tables 保留 columns/primaryKey/foreignKeys，丢弃 ddlFile，保持 tableNames 顺序", () => {
    const out = JSON.parse(readFileSync(join(dir, "scaffold-input.json"), "utf-8"))
    expect(out.tables.map((t: any) => t.name)).toEqual(["SCHEMA.T_FOO", "SCHEMA.T_BAR"])
    expect(out.tables[0].columns).toHaveLength(1)
    expect(out.tables[0].primaryKey).toEqual({ columns: ["ID"] })
    expect(out.tables[0].foreignKeys).toEqual([])
    expect(out.tables[1].foreignKeys).toHaveLength(1)
    expect(out.tables[0].ddlFile).toBeUndefined()
  })

  it("不读 subprograms（聚合器根本不碰该目录）", () => {
    // 放一个 subprograms 文件，确认聚合产物无 subprograms 字段、且不读它
    mkdirSync(join(dir, "subprograms"), { recursive: true })
    writeFileSync(join(dir, "subprograms", "SCHEMA.PKG_A.DO_A.json"), JSON.stringify({ directCalls: ["X"] }))
    const out = generateScaffoldInput(dir)
    expect((out as any).subprograms).toBeUndefined()
  })

  it("inventory.json 缺失时容错返回空结构（不抛）", () => {
    const empty = mkdtempSync(join(tmpdir(), "scaffold-input-empty-"))
    const out = generateScaffoldInput(empty)
    expect(out.packageNames).toEqual([])
    expect(out.packages).toEqual([])
    // 不落盘空产物
    expect(existsSync(join(empty, "scaffold-input.json"))).toBe(false)
  })
})
