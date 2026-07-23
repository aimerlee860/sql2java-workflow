## 架构模型

> DDD 领域驱动分层架构模型实例（对应 `~/Downloads/java-code-spec.md` 规约）。
> 用法：用户主 spec 用 `@include ./arch-model-ddd.md` 内联本段，引擎即按 DDD 产出
> （Aggregate/Processor/Access、XxxBean、TranFailException、有根包 com.example.mfgerp）。
> 与 4 文件实例（arch-model.md）同形异值，证明 `--spec` 可切换架构模型。

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
| builder | Builder | com.example.mfgerp.{module}.domain.builder | src/main/java/com/example/mfgerp/{module}/domain/builder | | | |
| validator | Validator | com.example.mfgerp.{module}.domain.validator | src/main/java/com/example/mfgerp/{module}/domain/validator | | | |

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
common/infrastructure/, beans/, mapper/

### 主类扫描包
com.example.mfgerp
