/**
 * architecture-model.test.ts — 架构模型解析/默认/辅助单测
 *
 * 覆盖：
 *   - DEFAULT_ARCHITECTURE_MODEL 等于当前 4 文件硬编码行为（回归基线）
 *   - parseArchitectureModel：4 文件实例解析 / DDD 实例解析 / 字段缺失回退 / 空正文返回 null
 *   - 表格空单元格 → undefined；implRole 标记
 *   - findImplRole：implRole 标记优先 → suffix 含 Impl 启发 → 首角色兜底
 *   - loadArchitectureModel：读 JSON / 缺失回退 / 不完整回退
 */

import { describe, it, expect } from "vitest"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  DEFAULT_ARCHITECTURE_MODEL,
  parseArchitectureModel,
  findImplRole,
  loadArchitectureModel,
  formatArchitectureModel,
  resolveModelPath,
} from "@workflow/architecture-model"

const FOUR_FILE_BODY = `
### layout
flat-no-root

### packageBase
<!-- 无根包留空 -->

### 角色
| role | suffix | package | dir | testDir | testSuffix | xmlDir | implRole |
|---|---|---|---|---|---|---|---|
| service | Service | service | src/main/java/service | | | | |
| service-impl | ServiceImpl | service.impl | src/main/java/service/impl | src/test/java/service/impl | ServiceImplTest | | true |
| mapper | Mapper | mapper | src/main/java/mapper | | | src/main/resources/mapper | |

### 包级产物
| artifact | suffix | dir |
|---|---|---|
| constant | Constant | src/main/java/constant |
| stateDto | StateDTO | src/main/java/dto |

### 实体
- 后缀: DO
- 目录: src/main/java/entity
- 包: entity
- 注解: @Data, @TableName("{table}")
- imports: lombok.Data, com.baomidou.mybatisplus.annotation.TableName

### 异常
- 基类: BusinessException
- 包: exception
- 子类: DataNotFoundException, ValidationException

### 跨包调用
- FQN 模式: service.{className}Service

### 覆盖率排除
config/, entity/, exception/, util/, constant/, dto/

### 主类扫描包
config, service, service.impl, mapper, constant, dto, entity, exception, util
`

const DDD_BODY = `
### layout
rooted-module

### packageBase
{packageBase}

### 角色
| role | suffix | package | dir | testDir | testSuffix | implRole |
|---|---|---|---|---|---|---|
| access | AccessIntf | {packageBase}.{module}.access | src/main/java/{packageBaseDir}/{module}/access | | | |
| processor | Processor | {packageBase}.{module}.processor | src/main/java/{packageBaseDir}/{module}/processor | src/test/java/{packageBaseDir}/{module}/processor | ProcessorTest | true |
| aggregate | Aggregate | {packageBase}.{module}.domain.aggregate | src/main/java/{packageBaseDir}/{module}/domain/aggregate | | | |

### 包级产物
| artifact | suffix | dir |
|---|---|---|
| constant | Constant | src/main/java/{packageBaseDir}/{module}/common/utils |
| stateDto | StateDTO | src/main/java/{packageBaseDir}/{module}/common/utils |

### 实体
- 后缀: Bean
- 目录: src/main/java/{packageBaseDir}/beans
- 包: {packageBase}.beans
- 注解: @Component
- imports: org.springframework.stereotype.Component

### 异常
- 基类: TranFailException
- 包: {packageBase}.common.infrastructure
- 子类: TranFailException

### 跨包调用
- FQN 模式: {packageBase}.{module}.access.{className}AccessIntf

### 覆盖率排除
common/infrastructure/, beans/, mapper/

### 主类扫描包
{packageBase}
`

describe("DEFAULT_ARCHITECTURE_MODEL（4 文件回归基线）", () => {
  it("layout 无根包、含 service/service-impl/mapper 三角色", () => {
    expect(DEFAULT_ARCHITECTURE_MODEL.layout).toBe("flat-no-root")
    expect(DEFAULT_ARCHITECTURE_MODEL.packageBase).toBeUndefined()
    expect(DEFAULT_ARCHITECTURE_MODEL.roles.map(r => r.role)).toEqual(["service", "service-impl", "mapper"])
  })
  it("service-impl 为实现层且带 testDir/testSuffix", () => {
    const impl = DEFAULT_ARCHITECTURE_MODEL.roles.find(r => r.role === "service-impl")!
    expect(impl.implRole).toBe(true)
    expect(impl.testDir).toBe("src/test/java/service/impl")
    expect(impl.testSuffix).toBe("ServiceImplTest")
  })
  it("实体 DO + @Data + @TableName + mybatis-plus imports", () => {
    expect(DEFAULT_ARCHITECTURE_MODEL.entity.suffix).toBe("DO")
    expect(DEFAULT_ARCHITECTURE_MODEL.entity.annotations).toContain("@Data")
    expect(DEFAULT_ARCHITECTURE_MODEL.entity.annotations).toContain("@TableName(\"{table}\")")
    expect(DEFAULT_ARCHITECTURE_MODEL.entity.imports).toContain("lombok.Data")
  })
  it("异常基类 BusinessException、跨包 FQN service.{className}Service", () => {
    expect(DEFAULT_ARCHITECTURE_MODEL.exception.baseClass).toBe("BusinessException")
    expect(DEFAULT_ARCHITECTURE_MODEL.crossPackageCall.fqnPattern).toBe("service.{className}Service")
  })
})

describe("parseArchitectureModel — 4 文件实例", () => {
  it("解析后与 DEFAULT 等价", () => {
    const m = parseArchitectureModel(FOUR_FILE_BODY)!
    expect(m).not.toBeNull()
    expect(m.layout).toBe("flat-no-root")
    expect(m.packageBase).toBeUndefined()
    expect(m.roles.map(r => r.role)).toEqual(["service", "service-impl", "mapper"])
    const impl = m.roles.find(r => r.role === "service-impl")!
    expect(impl.implRole).toBe(true)
    expect(impl.testDir).toBe("src/test/java/service/impl")
    // 空单元格 → undefined
    const svc = m.roles.find(r => r.role === "service")!
    expect(svc.testDir).toBeUndefined()
    expect(svc.xmlDir).toBeUndefined()
    expect(svc.implRole).toBeUndefined()
    expect(m.entity.suffix).toBe("DO")
    expect(m.entity.annotations).toEqual(["@Data", "@TableName(\"{table}\")"])
    expect(m.exception.baseClass).toBe("BusinessException")
    expect(m.crossPackageCall.fqnPattern).toBe("service.{className}Service")
    expect(m.coverageExcludes).toEqual(["config/", "entity/", "exception/", "util/", "constant/", "dto/"])
    expect(m.scanBasePackages).toContain("service.impl")
  })
})

describe("parseArchitectureModel — DDD 实例", () => {
  it("有根包、processor 为实现层、实体 Bean 无 Lombok、TranFailException", () => {
    const m = parseArchitectureModel(DDD_BODY)!
    expect(m.layout).toBe("rooted-module")
    expect(m.packageBase).toBe("{packageBase}")
    expect(m.roles.map(r => r.role)).toEqual(["access", "processor", "aggregate"])
    const proc = m.roles.find(r => r.role === "processor")!
    expect(proc.implRole).toBe(true)
    expect(proc.testSuffix).toBe("ProcessorTest")
    expect(m.entity.suffix).toBe("Bean")
    expect(m.entity.annotations).toEqual(["@Component"])
    expect(m.entity.imports).toEqual(["org.springframework.stereotype.Component"])
    expect(m.exception.baseClass).toBe("TranFailException")
    expect(m.crossPackageCall.fqnPattern).toBe("{packageBase}.{module}.access.{className}AccessIntf")
    expect(m.coverageExcludes).toContain("common/infrastructure/")
  })
})

describe("parseArchitectureModel — 容错", () => {
  it("空正文 → null", () => {
    expect(parseArchitectureModel("")).toBeNull()
    expect(parseArchitectureModel("   \n  ")).toBeNull()
  })
  it("无 ### 子节 → null", () => {
    expect(parseArchitectureModel("只有一段文字没有子节")).toBeNull()
  })
  it("角色表缺失 → null（核心段不可缺）", () => {
    const body = `### layout\nflat-no-root\n`
    expect(parseArchitectureModel(body)).toBeNull()
  })
  it("部分字段缺失 → 回退默认对应值", () => {
    const body = `### 角色\n| role | suffix | package | dir |\n|---|---|---|---|\n| service | Service | service | src/main/java/service |\n`
    const m = parseArchitectureModel(body)!
    expect(m.entity.suffix).toBe("DO")          // 回退默认
    expect(m.exception.baseClass).toBe("BusinessException")
    expect(m.crossPackageCall.fqnPattern).toBe("service.{className}Service")
  })
})

describe("findImplRole", () => {
  it("implRole 标记优先", () => {
    const m = parseArchitectureModel(FOUR_FILE_BODY)!
    expect(findImplRole(m)!.role).toBe("service-impl")
  })
  it("DDD processor 标记优先", () => {
    const m = parseArchitectureModel(DDD_BODY)!
    expect(findImplRole(m)!.role).toBe("processor")
  })
  it("无标记时 suffix 含 Impl 启发", () => {
    const m = parseArchitectureModel(
      `### 角色\n| role | suffix | package | dir |\n|---|---|---|---|\n| svc | Service | service | x |\n| impl | ServiceImpl | service.impl | y |\n`
    )!
    expect(findImplRole(m)!.role).toBe("impl")
  })
  it("全无标记退回首角色", () => {
    const m = parseArchitectureModel(
      `### 角色\n| role | suffix | package | dir |\n|---|---|---|---|\n| svc | Service | service | x |\n`
    )!
    expect(findImplRole(m)!.role).toBe("svc")
  })
})

describe("loadArchitectureModel", () => {
  it("缺失文件 → 默认模型", () => {
    const dir = mkdtempSync(join(tmpdir(), "am-"))
    const m = loadArchitectureModel(dir)
    expect(m.layout).toBe("flat-no-root")
  })
  it("读 JSON 完整 → 返回该模型", () => {
    const dir = mkdtempSync(join(tmpdir(), "am-"))
    const ddd = parseArchitectureModel(DDD_BODY)!
    writeFileSync(join(dir, "architecture-model.json"), JSON.stringify(ddd))
    const m = loadArchitectureModel(dir)
    expect(m.layout).toBe("rooted-module")
    expect(m.exception.baseClass).toBe("TranFailException")
  })
  it("JSON 不完整（无 roles）→ 回退默认", () => {
    const dir = mkdtempSync(join(tmpdir(), "am-"))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "architecture-model.json"), JSON.stringify({ layout: "rooted-module" }))
    const m = loadArchitectureModel(dir)
    expect(m.layout).toBe("flat-no-root")  // 回退默认整体
  })
  it("JSON 损坏 → 回退默认", () => {
    const dir = mkdtempSync(join(tmpdir(), "am-"))
    writeFileSync(join(dir, "architecture-model.json"), "{not json")
    const m = loadArchitectureModel(dir)
    expect(m.layout).toBe("flat-no-root")
  })
  it("scaffold.json targetProject.packageBase → {packageBase} 占位全替换", () => {
    const dir = mkdtempSync(join(tmpdir(), "am-"))
    const ddd = parseArchitectureModel(DDD_BODY)!
    writeFileSync(join(dir, "architecture-model.json"), JSON.stringify(ddd))
    writeFileSync(join(dir, "scaffold.json"), JSON.stringify({
      targetProject: { groupId: "com.other", packageBase: "com.example.mfgerp", javaVersion: "1.8", springBootVersion: "2.7.x" },
    }))
    const m = loadArchitectureModel(dir)
    expect(m.packageBase).toBe("com.example.mfgerp")
    const proc = m.roles.find(r => r.role === "processor")!
    expect(proc.package).toBe("com.example.mfgerp.{module}.processor")
    expect(proc.dir).toBe("src/main/java/com/example/mfgerp/{module}/processor")
    expect(m.entity.dir).toBe("src/main/java/com/example/mfgerp/beans")
    expect(m.crossPackageCall.fqnPattern).toBe("com.example.mfgerp.{module}.access.{className}AccessIntf")
    expect(m.scanBasePackages).toEqual(["com.example.mfgerp"])
  })
  it("scaffold.json 无 packageBase → 兜底用 groupId", () => {
    const dir = mkdtempSync(join(tmpdir(), "am-"))
    const ddd = parseArchitectureModel(DDD_BODY)!
    writeFileSync(join(dir, "architecture-model.json"), JSON.stringify(ddd))
    writeFileSync(join(dir, "scaffold.json"), JSON.stringify({
      targetProject: { groupId: "com.icbc.fmhm", javaVersion: "1.8", springBootVersion: "2.7.x" },
    }))
    const m = loadArchitectureModel(dir)
    expect(m.packageBase).toBe("com.icbc.fmhm")
    expect(m.roles.find(r => r.role === "access")!.package).toBe("com.icbc.fmhm.{module}.access")
  })
  it("scaffold.json 缺失（pre-scaffold）→ {packageBase} 占位保留", () => {
    const dir = mkdtempSync(join(tmpdir(), "am-"))
    const ddd = parseArchitectureModel(DDD_BODY)!
    writeFileSync(join(dir, "architecture-model.json"), JSON.stringify(ddd))
    const m = loadArchitectureModel(dir)
    expect(m.packageBase).toBe("{packageBase}")
    expect(m.roles.find(r => r.role === "processor")!.package).toBe("{packageBase}.{module}.processor")
  })
})

describe("resolveModelPath — {module} 占位", () => {
  it("schema-qualified pkg 取末段小写（去 schema 前缀，不带点）", () => {
    // pkg = pkgOf("MFG_ERP.F_ORDER.r_xxx") = "MFG_ERP.F_ORDER"（带 schema 点）
    expect(resolveModelPath("src/main/java/com/example/mfgerp/{module}/processor", "MFG_ERP.F_ORDER"))
      .toBe("src/main/java/com/example/mfgerp/f_order/processor")
    expect(resolveModelPath("com.example.mfgerp.{module}.processor", "MFG_ERP.F_ORDER"))
      .toBe("com.example.mfgerp.f_order.processor")
  })
  it("无 schema 的 pkg 原样小写", () => {
    expect(resolveModelPath("src/main/java/com/example/mfgerp/{module}/processor", "FX_SP"))
      .toBe("src/main/java/com/example/mfgerp/fx_sp/processor")
  })
  it("无 {module} 占位的路径原样返回（flat-no-root）", () => {
    expect(resolveModelPath("src/main/java/service/impl", "ANY")).toBe("src/main/java/service/impl")
  })
})

describe("formatArchitectureModel", () => {
  it("输出含 layout/角色/实体/异常/FQN 关键行", () => {
    const s = formatArchitectureModel(DEFAULT_ARCHITECTURE_MODEL)
    expect(s).toContain("layout: flat-no-root")
    expect(s).toContain("实体: DO")
    expect(s).toContain("BusinessException")
    expect(s).toContain("service.{className}Service")
  })
})
