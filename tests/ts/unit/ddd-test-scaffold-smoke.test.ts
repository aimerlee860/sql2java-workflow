/**
 * ddd-test-scaffold-smoke.test.ts — DDD 模型下 buildTestScaffold 生成 Processor 测试壳
 *
 * 验证：DDD 用 @Autowired 字段注入（非 final 构造器注入），parseDeps 增强后能抽出 Processor 的
 * @Autowired 依赖生成 @Mock；测试类落 processor 测试目录、类名 {className}ProcessorTest、
 * @InjectMocks 类型 {className}Processor。
 */

import { describe, it, expect } from "vitest"
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { buildTestScaffold } from "@workflow/test-scaffold-builder"
import { parseArchitectureModel } from "@workflow/architecture-model"

const DDD_BODY = `
### layout
rooted-module

### packageBase
com.example.mfgerp

### 角色
| role | suffix | package | dir | testDir | testSuffix | implRole |
|---|---|---|---|---|---|---|
| processor | Processor | com.example.mfgerp.{module}.processor | src/main/java/com/example/mfgerp/{module}/processor | src/test/java/com/example/mfgerp/{module}/processor | ProcessorTest | true |
| aggregate | Aggregate | com.example.mfgerp.{module}.domain.aggregate | src/main/java/com/example/mfgerp/{module}/domain/aggregate | | | |
| mapper | Mapper | com.example.mfgerp.mapper | src/main/java/com/example/mfgerp/mapper | | | |

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

describe("DDD buildTestScaffold — Processor 测试壳 + @Autowired 依赖", () => {
  it("生成 ProcessorTest，@Mock 抽出 @Autowired 依赖，落 processor 测试目录", () => {
    const artifacts = mkdtempSync(join(tmpdir(), "ddd-ts-"))
    writeFileSync(join(artifacts, "architecture-model.json"), JSON.stringify(parseArchitectureModel(DDD_BODY)!))
    writeFileSync(join(artifacts, "scaffold.json"), JSON.stringify({
      generated: { procClassNames: [{ plsqlSchema: "SCH", plsqlPackage: "FXSP", refName: "r_fxsp_imp", className: "FxspImp" }] },
    }))
    const projectRoot = mkdtempSync(join(tmpdir(), "proj-"))
    // Processor 用 @Autowired 字段注入（DDD 风格，非 final）；模块名 = pkg.toLowerCase() = fxsp
    mkdirSync(join(projectRoot, "src/main/java/com/example/mfgerp/fxsp/processor"), { recursive: true })
    writeFileSync(join(projectRoot, "src/main/java/com/example/mfgerp/fxsp/processor/FxspImpProcessor.java"),
      `package com.example.mfgerp.fxsp.processor;
import com.example.mfgerp.fxsp.domain.aggregate.FxspImpAggregate;
import com.example.mfgerp.mapper.FxspImpMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
@Component
public class FxspImpProcessor {
    @Autowired private FxspImpAggregate fxspImpAggregate;
    @Autowired private FxspImpMapper fxspImpMapper;
    public Map<String,Object> fxspImp(Object req) {
        return null;
    }
}
`)
    const rel = buildTestScaffold(projectRoot, artifacts, "FXSP", "r_fxsp_imp")!
    expect(rel).toBe("src/test/java/com/example/mfgerp/fxsp/processor/FxspImpProcessorTest.java")
    const test = readFileSync(join(projectRoot, rel), "utf-8")
    expect(test).toContain("package com.example.mfgerp.fxsp.processor;")
    expect(test).toContain("class FxspImpProcessorTest {")
    expect(test).toContain("@InjectMocks private FxspImpProcessor service;")
    // @Autowired 依赖被抽出为 @Mock（parseDeps 增强生效）
    expect(test).toContain("@Mock private FxspImpAggregate fxspImpAggregate;")
    expect(test).toContain("@Mock private FxspImpMapper fxspImpMapper;")
    expect(test).toContain("import com.example.mfgerp.fxsp.processor.FxspImpProcessor;")
    expect(test).toContain("// @TEST_METHODS_HERE")
  })
})
