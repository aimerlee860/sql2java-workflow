import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  loadPureConstantPackages,
  normalizeScaffoldArtifact,
  validateScaffoldProjectLayout,
  validateScaffoldRelations,
} from "@workflow/scaffold-artifact"

let root: string

function baseScaffold() {
  return {
    targetProject: {
      groupId: "com.acme",
      javaVersion: "17",
      springBootVersion: "3.3.0",
    },
    packageMappings: [{
      plsqlSchema: "",
      plsqlPackage: "PKG_CONST",
      components: [{ role: "constant" }],
    }],
    projectRoot: "/final/project",
    structure: {
      directories: ["src/main/java/com/acme/app/pkg", "src/main/resources"],
      pomXml: "pom.xml",
    },
    generated: {
      entities: [],
      procClassNames: [],
      constants: [],
      stateDtos: [{
        file: "src/main/java/com/acme/app/pkg/PkgConstState.java",
        plsqlSchema: "",
        plsqlPackage: "PKG_CONST",
      }],
      commonClasses: [],
      extraFiles: [{ file: "src/main/resources/application.yml", purpose: "应用配置" }],
    },
  }
}

function writeValidProject(): void {
  mkdirSync(join(root, "src/main/java/com/acme/app/pkg"), { recursive: true })
  mkdirSync(join(root, "src/main/resources"), { recursive: true })
  writeFileSync(join(root, "pom.xml"), "<project/>", "utf-8")
  writeFileSync(
    join(root, "src/main/java/com/acme/app/pkg/PkgConstState.java"),
    "package com.acme.app.pkg;\npublic class PkgConstState {}\n",
    "utf-8",
  )
  writeFileSync(join(root, "src/main/resources/application.yml"), "spring: {}\n", "utf-8")
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "scaffold-artifact-"))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("scaffold 确定性规范化", () => {
  it("只给 inventory 确认的纯常量包补 constant 角色", () => {
    const packagesDir = join(root, "packages")
    mkdirSync(packagesDir, { recursive: true })
    writeFileSync(join(packagesDir, "PKG_CONST.json"), '\uFEFF{"packageName":"PKG_CONST","procedures":[],"functions":[],"constants":[{"name":"C_A"}]}', "utf-8")
    writeFileSync(join(packagesDir, "PKG_BIZ.json"), '{"packageName":"PKG_BIZ","procedures":["RUN"],"functions":[],"constants":[{"name":"C_B"}]}', "utf-8")

    const pureConstants = loadPureConstantPackages(root)
    const input = baseScaffold()
    input.packageMappings.push({
      plsqlSchema: "",
      plsqlPackage: "PKG_BIZ",
      components: [],
    })
    input.packageMappings[0].components = []

    const result = normalizeScaffoldArtifact(input, "/expected/final", pureConstants)
    expect(result.data.projectRoot).toBe("/expected/final")
    expect(result.data.packageMappings[0].components).toEqual([{ role: "constant" }])
    expect(result.data.packageMappings[1].components).toEqual([])
  })
})

describe("scaffold 交叉字段校验", () => {
  it("拒绝重复 packageMapping 和无映射包级产物", () => {
    const input = baseScaffold()
    input.packageMappings.push({ ...input.packageMappings[0], plsqlPackage: "pkg_const" })
    input.generated.stateDtos.push({
      file: "src/main/java/com/acme/app/pkg/OrphanState.java",
      plsqlSchema: "",
      plsqlPackage: "PKG_ORPHAN",
    })
    const errors = validateScaffoldRelations(input)
    expect(errors.some(error => error.includes("重复"))).toBe(true)
    expect(errors.some(error => error.includes("PKG_ORPHAN"))).toBe(true)
  })
})

describe("scaffold 项目布局校验", () => {
  it("声明、磁盘路径和 Java package 一致时通过", () => {
    writeValidProject()
    expect(validateScaffoldProjectLayout(baseScaffold(), root)).toEqual([])
  })

  it("报告缺失声明文件", () => {
    writeValidProject()
    const input = baseScaffold()
    input.generated.extraFiles.push({ file: "src/main/resources/missing.yml", purpose: "缺失" })
    expect(validateScaffoldProjectLayout(input, root).some(error => error.includes("missing.yml"))).toBe(true)
  })

  it("报告 Java package 与路径不一致", () => {
    writeValidProject()
    writeFileSync(
      join(root, "src/main/java/com/acme/app/pkg/PkgConstState.java"),
      "package com.acme.wrong;\npublic class PkgConstState {}\n",
      "utf-8",
    )
    expect(validateScaffoldProjectLayout(baseScaffold(), root).some(error => error.includes("package 声明"))).toBe(true)
  })

  it("拒绝声明逃逸工作区的相对路径", () => {
    writeValidProject()
    const input = baseScaffold()
    input.generated.extraFiles.push({ file: "../escape.yml", purpose: "非法路径" })
    expect(validateScaffoldProjectLayout(input, root).some(error => error.includes("不安全文件路径"))).toBe(true)
  })

  it("拒绝遗留 com.example 示例命名空间", () => {
    writeValidProject()
    const input = baseScaffold()
    input.targetProject.groupId = "com.example"
    expect(validateScaffoldProjectLayout(input, root).some(error => error.includes("示例占位命名空间"))).toBe(true)
  })

  it("报告未登记的相关项目文件", () => {
    writeValidProject()
    writeFileSync(
      join(root, "src/main/java/com/acme/app/pkg/Unexpected.java"),
      "package com.acme.app.pkg;\npublic class Unexpected {}\n",
      "utf-8",
    )
    expect(validateScaffoldProjectLayout(baseScaffold(), root).some(error => error.includes("未登记") && error.includes("Unexpected.java"))).toBe(true)
  })
})
