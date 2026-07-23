/**
 * arch-model-ddd-builders.test.ts — 验证确定性 builder 在 DDD 架构模型下正确产出
 *
 * Phase 3 关键：do-schema-builder / test-case-enumerator / verify testBelongsToPkg
 * 改为模型驱动后，写入 DDD architecture-model.json 应产出 Bean/@Component/TranFailException
 * 及按 DDD 角色后缀归因——证明 --spec 切架构对确定性逻辑生效。
 */

import { describe, it, expect } from "vitest"
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { generateDoAndH2Schema, tableNameToClassName } from "@workflow/do-schema-builder"
import { enumerateTestCases } from "@workflow/test-case-enumerator"
import { parseArchitectureModel } from "@workflow/architecture-model"

const DDD_BODY = `
### layout
rooted-module

### packageBase
com.example.mfgerp

### 角色
| role | suffix | package | dir | testDir | testSuffix | implRole |
|---|---|---|---|---|---|---|
| access | AccessIntf | com.example.mfgerp.{module}.access | src/main/java/com/example/mfgerp/{module}/access | | | |
| processor | Processor | com.example.mfgerp.{module}.processor | src/main/java/com/example/mfgerp/{module}/processor | src/test/java/com/example/mfgerp/{module}/processor | ProcessorTest | true |
| aggregate | Aggregate | com.example.mfgerp.{module}.domain.aggregate | src/main/java/com/example/mfgerp/{module}/domain/aggregate | | | |

### 包级产物
| artifact | suffix | dir |
|---|---|---|
| constant | Constant | src/main/java/com/example/mfgerp/{module}/common/utils |
| stateDto | StateDTO | src/main/java/com/example/mfgerp/{module}/common/utils |

### 实体
- 后缀: Bean
- 目录: src/main/java/com/example/mfgerp/beans
- 包: com.example.mfgerp.beans
- 注解: @Component
- imports: org.springframework.stereotype.Component

### 异常
- 基类: TranFailException
- 包: com.example.mfgerp.common.infrastructure
- 子类: TranFailException

### 跨包调用
- FQN 模式: com.example.mfgerp.{module}.access.{className}AccessIntf

### 覆盖率排除
common/infrastructure/, beans/

### 主类扫描包
com.example.mfgerp
`

function dddArtifactsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ddd-"))
  writeFileSync(join(dir, "architecture-model.json"), JSON.stringify(parseArchitectureModel(DDD_BODY)!))
  return dir
}

describe("do-schema-builder — DDD 模型", () => {
  it("实体后缀 Bean、注解 @Component、目录/包按模型", () => {
    const artifacts = dddArtifactsDir()
    // inventory.json + tables/{tn}.json
    writeFileSync(join(artifacts, "inventory.json"), JSON.stringify({
      tableNames: ["MFG_ERP.T_BOM_LINE"], sequences: [], views: [],
    }))
    mkdirSync(join(artifacts, "tables"), { recursive: true })
    writeFileSync(join(artifacts, "tables", "MFG_ERP.T_BOM_LINE.json"), JSON.stringify({
      name: "MFG_ERP.T_BOM_LINE",
      columns: [{ name: "ID", plsqlType: "NUMBER(18)", nullable: false }, { name: "NAME", plsqlType: "VARCHAR2(40)" }],
      primaryKey: ["ID"],
    }))
    const projRoot = mkdtempSync(join(tmpdir(), "proj-"))
    const manifest = generateDoAndH2Schema(artifacts, projRoot)
    expect(manifest.entities[0].file).toBe("src/main/java/com/example/mfgerp/beans/BomLineBean.java")
    const java = readFileSync(join(projRoot, manifest.entities[0].file), "utf-8")
    expect(java).toContain("package com.example.mfgerp.beans;")
    expect(java).toContain("@Component")
    expect(java).toContain("import org.springframework.stereotype.Component;")
    expect(java).toContain("public class BomLineBean {")
    expect(java).not.toContain("@Data")
    expect(java).not.toContain("@TableName")
  })
  it("tableNameToClassName 接受模型后缀", () => {
    expect(tableNameToClassName("T_BOM_LINE", "Bean")).toBe("BomLineBean")
    expect(tableNameToClassName("T_BOM_LINE")).toBe("BomLineDO")  // 默认 DO
  })
})

describe("test-case-enumerator — DDD 模型异常基类", () => {
  it("RAISE_APPLICATION_ERROR → throws-TranFailException:<code>", () => {
    const artifacts = dddArtifactsDir()
    mkdirSync(join(artifacts, "shard-inputs", "PKG", "PROC"), { recursive: true })
    writeFileSync(join(artifacts, "shard-inputs", "PKG", "PROC", "source.sql"),
      "IF x IS NULL THEN RAISE_APPLICATION_ERROR(-20001, '参数为空'); END IF;\n")
    const cases = enumerateTestCases(artifacts, "PKG", "PROC")!
    expect(cases.length).toBeGreaterThan(0)
    const neg = cases.find(c => c.type === "negative")!
    expect(neg).toBeTruthy()
    expect(neg.expectKind).toBe("throws-TranFailException:-20001")
    expect(neg.expectKind).not.toContain("BusinessException")
  })
})
