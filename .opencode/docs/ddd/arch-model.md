## 架构模型

> DDD 领域驱动分层架构模型。本段是架构决策唯一事实源，被 `@include` 内联进 DDD 主规约后
> 对所有写 Java 的 agent 可见，同时由引擎解析成 `ArchitectureModel` 供确定性 builder 消费。
> `###` 子节标题为固定契约，正文用表格 + `- key: value` 列表。

### layout
rooted-module

### packageBase
com.example.mfgerp

### 角色
| role | suffix | package | dir | testDir | testSuffix | xmlDir | implRole |
|---|---|---|---|---|---|---|---|
| access | AccessIntf | com.example.mfgerp.{module}.access | src/main/java/com/example/mfgerp/{module}/access | | | | |
| access-impl | AccessImpl | com.example.mfgerp.{module}.access.impl | src/main/java/com/example/mfgerp/{module}/access/impl | src/test/java/com/example/mfgerp/{module}/access/impl | AccessImplTest | | |
| processor | Processor | com.example.mfgerp.{module}.processor | src/main/java/com/example/mfgerp/{module}/processor | src/test/java/com/example/mfgerp/{module}/processor | ProcessorTest | | true |
| aggregate | Aggregate | com.example.mfgerp.{module}.domain.aggregate | src/main/java/com/example/mfgerp/{module}/domain/aggregate | | | | |
| builder | Builder | com.example.mfgerp.{module}.domain.builder | src/main/java/com/example/mfgerp/{module}/domain/builder | | | | |
| validator | Validator | com.example.mfgerp.{module}.domain.validator | src/main/java/com/example/mfgerp/{module}/domain/validator | | | | |
| outservice | OutService | com.example.mfgerp.{module}.common.outservice | src/main/java/com/example/mfgerp/{module}/common/outservice | | | | |
| mapper | Mapper | com.example.mfgerp.mapper | src/main/java/com/example/mfgerp/mapper | | | src/main/resources/mapper | |

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
common/infrastructure/, beans/, mapper/, common/utils/

### 主类扫描包
com.example.mfgerp
