## 架构模型

> DDD 领域驱动分层架构模型。本段是架构决策唯一事实源，被 `@include` 内联进 DDD 主规约后
> 对所有写 Java 的 agent 可见，同时由引擎解析成 `ArchitectureModel` 供确定性 builder 消费。
> `###` 子节标题为固定契约，正文用表格 + `- key: value` 列表。
>
> **`{packageBase}` / `{packageBaseDir}` 占位契约**：项目 Java 根包（如 `com.example.mfgerp`），
> **项目特定、运行时注入**——scaffold 阶段从 `targetProject.packageBase`（默认取 groupId）决策，
> `loadArchitectureModel` 读取时把模型里的占位替换成具体值：
> - `{packageBase}` → 点式根包（`com.example.mfgerp`），用于 `package`/FQN/扫描包等 Java 包名字段；
> - `{packageBaseDir}` → 斜杠式（`com/example/mfgerp`），用于 `dir`/`testDir` 等文件系统路径字段。
>
> 本段只定义架构形状，不写死具体根包，故 DDD 规约可复用到任意工程。
>
> **`{module}` 占位契约**：路径/包里的 `{module}` = **`plsqlPackage` 小写**（去 schema 前缀的包名末段小写）。
> 引擎 resolveModelPath 与 scaffold/skeleton 一致用此派生，每包一模块。如 schema-qualified 包
> `MFG_ERP.F_ORDER` → module `f_order` → 路径 `src/main/java/{packageBaseDir}/f_order/processor/`、
> 包 `{packageBase}.f_order.processor`。不得用其它模块名或保留 schema 前缀，否则引擎确定性
> builder（test-scaffold/buildCoreSegmentBlock 按此派生查实现类）找不到文件。

### layout
rooted-module

### packageBase
{packageBase}

### 角色
| role | suffix | package | dir | testDir | testSuffix | xmlDir | implRole |
|---|---|---|---|---|---|---|---|
| access | AccessIntf | {packageBase}.{module}.access | src/main/java/{packageBaseDir}/{module}/access | | | | |
| access-impl | AccessImpl | {packageBase}.{module}.access.impl | src/main/java/{packageBaseDir}/{module}/access/impl | src/test/java/{packageBaseDir}/{module}/access/impl | AccessImplTest | | |
| processor | Processor | {packageBase}.{module}.processor | src/main/java/{packageBaseDir}/{module}/processor | src/test/java/{packageBaseDir}/{module}/processor | ProcessorTest | | true |
| aggregate | Aggregate | {packageBase}.{module}.domain.aggregate | src/main/java/{packageBaseDir}/{module}/domain/aggregate | | | | |
| builder | Builder | {packageBase}.{module}.domain.builder | src/main/java/{packageBaseDir}/{module}/domain/builder | | | | |
| validator | Validator | {packageBase}.{module}.domain.validator | src/main/java/{packageBaseDir}/{module}/domain/validator | | | | |
| outservice | OutService | {packageBase}.{module}.common.outservice | src/main/java/{packageBaseDir}/{module}/common/outservice | | | | |
| mapper | Mapper | {packageBase}.mapper | src/main/java/{packageBaseDir}/mapper | | | src/main/resources/mapper | |

### 包级产物
| artifact | suffix | dir |
|---|---|---|
| constant | Constant | src/main/java/{packageBaseDir}/{module}/common/utils |
| stateDto | StateDTO | src/main/java/{packageBaseDir}/{module}/common/utils |

### 实体
> 实体为项目级全局共享（不随模块变化），dir/package **不得含 `{module}` 占位**（do-schema-builder 全局生成，无 pkg 上下文）。
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
common/infrastructure/, beans/, mapper/, common/utils/

### 主类扫描包
{packageBase}
