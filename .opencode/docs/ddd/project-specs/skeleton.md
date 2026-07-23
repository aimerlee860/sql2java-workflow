# Project Spec — skeleton 子阶段（DDD：文件创建 + 骨架桩 + FSD 设计稿）

> 本规约由引擎注入 translate-skeleton 子 agent 系统提示词（DDD 架构）。skeleton 为本 unit 创建
> DDD 分层 per-proc Java 文件（Access/AccessImpl/Processor/Aggregate/Builder/Validator/Mapper）
> + 方法签名桩 + `// TODO: [translate]` 占位 + **FSD 设计稿** `fsd/{pkg}/{ref}.md`。

## 一、核心目标

为本分片单个过程函数（unit）创建**未实现的 per-proc Java 文件**（一过程一组 DDD 分层类）+ 方法签名桩
+ `// TODO: [translate]` 占位。桩必须可被 javac parse 通过。**不翻译方法体**（translate-core 的事）。
**并产 FSD 设计稿** `fsd/{pkg}/{ref}.md`——前置设计，约束下游 translate-core/test-gen，供人工事前审核。

## 二、只增不删不覆盖（硬不变量）

1. **创建前必须检查文件是否存在**：用 `read` 工具检查目标路径是否已有文件。
2. **已存在文件只能追加，严禁覆盖/删除/修改原有内容**——旧程序可能被其他逻辑依赖，覆盖会导致运行失败。
3. per-proc 架构下各 unit 独占文件、互不共享，通常直接 `write` 新文件；但仍须先确认路径无同名文件。
4. 禁止用 `write` 覆盖已存在文件——已存在文件用 `edit` 增量追加。

## 三、命名规范

1. **去除 SQL 前缀**：禁止保留 `f_`/`r_`/`sp_` 等 SQL 函数/存储过程前缀。
2. **PascalCase** 大驼峰命名，文件名清晰表达业务功能。
3. **类型后缀**：按架构模型段各角色 `suffix` 派生（DDD：AccessIntf/AccessImpl/Processor/Aggregate/Builder/Validator/Mapper；实体后缀 `Bean`）。
4. **类名派生**：`{className}{RoleSuffix}`（`className` 查 `scaffold.json.generated.procClassNames`；`RoleSuffix` 取架构模型段对应角色 `suffix`）。**禁止自行编造类名**——角色集查 `packageMappings` 的 `components[]`。
5. **命名冲突检查**：跨包同名过程由 `procClassNames.className` 去重保证文件名不冲突，**必须用 `className` 派生文件名**；文件名/路径层不得用 Java 关键字。

## 四、包路径规范

按架构模型段（`## 架构模型`）的角色→目录映射落位（DDD 有根包 `com.example.mfgerp`，按 `{packageBase}/{module}/<层>` 组织）：

- 文件位置 = `{projectRoot}/{角色 dir}/{className}{RoleSuffix}.java`（`dir` 取架构模型段对应角色，含 `{module}` 占位 = **`plsqlPackage` 小写**，与引擎 resolveModelPath 一致派生）。
- Mapper XML：`{projectRoot}/{mapper 角色 xmlDir}/{className}Mapper.xml`（namespace = `{mapper 角色 package}.{className}Mapper`）。
- ❌ 路径层禁含 `import`/`package`/`class` 关键字、空格、中文、特殊符号。

## 五、实体类（Bean）

- scaffold 阶段已生成全局实体类（后缀 `Bean`，`@Component`，无 Lombok），skeleton **只读引用**，不重建、不修改、不覆盖。
- 实体字段必须与 inventory/schema 定义一致，**禁止编造字段**；发现不一致标 `// TODO: [translate]` 交下游。
- 单表查询复用 scaffold 全局 Bean；联表/计算字段 Bean（自定义）由 translate-core 设计，skeleton 不提前建。

## 六、方法签名桩

- 入参/出参类型从 SQL 切片（`shard-inputs/{pkg}/{ref}/source.sql`）+ 依赖签名块推导；不确定的参数类型标 `// TODO: [translate]`。
- Mapper 接口方法签名对应本过程将用到的 SQL 语句（SQL 体由 translate-core 填）。
- 桩体：`return null;` / `return 0;` / `return false;` 等默认值 + `// TODO: [translate]`，保证可编译。
- **AccessIntf 接口**：方法签名统一 `Map<String,Object> xxx(Map<String,Object> inputMap)`，返回 `Map<String,Object>`（含 `oiFlag`/`osMsg` + 业务结果键），禁止 `void`、禁止 Bean 暴露到接入层。

### 6.1 超长过程段切分（>500 行）

过程体行数 > 500 时，skeleton 在此**预切多段**，core 分次填段：

- **触发**：`source.sql` 体行数 > 500 → 切多段；≤500 → 1 段。**始终写 `segments[]`（≥1）到 sidecar `translations/{pkg}/{ref}.segments.json`**，每段 `{segId, plsqlLineRange, summary, status:"pending"}`。
- **切分算法**：`n = ceil(总行数/500)`，目标段行数 `t = 总行数/n`，在第 `i×t` 附近找**最近的有效逻辑边界**断开。有效边界 = IF/FOR/WHILE/BEGIN-END 块闭合、子程序调用前后、注释/空行分隔的业务步骤。**硬约束：任一段不得超 500 行**。
- **入口方法体结构**（多段时，Processor 的编排方法内）：
  ```java
  public Map<String,Object> execute(...) {
      // === 过程级局部变量（PL/SQL 声明区 1:1，skeleton 一次性声明；core 填段不得新增过程级变量）===
      Long docId; LocalDate bizDate; ...
      // TODO:[seg-1] lines 10-45 参数校验
      ;
      // TODO:[seg-2] lines 46-120 查交易列表
      ;
      return result;
  }
  ```
- **段 TODO 格式**：`// TODO:[seg-N] lines X-Y 中文摘要` + `;` 占位。`seg-N` 与 `segments[].segId` 一一对应。
- **过程级局部变量集中声明**在方法头——段间数据对接唯一来源。
- **≤500 行单段**：`segments[]` 1 段，一个 `// TODO:[seg-1]` 桩。

## 七、包级常量/变量

- scaffold 已生成 per-package `{Pkg}Constant` 与 `{Pkg}StateDTO`（后缀/落位目录按架构模型段 `packageArtifacts`，DDD 落 `{module}/common/utils`）。skeleton **只读引用**，不重建、不修改。

## 八、注释规范

- 类注释、方法注释含**生成来源**（如 `生成来源：存储过程 procedure: {schema}.{pkg}.{procName}`）。
- 字段注释说明对应表字段含义。全部中文注释，专有名词与关键字保持英文。

## 九、FSD 设计稿生成（`fsd/{pkg}/{ref}.md`）

skeleton 除建 Java 桩外，**必须产 FSD 设计稿** `fsd/{pkg}/{ref}.md`——前置设计，约束下游 translate-core / test-gen，供人工事前审核。模板与 summary 总结稿同构对齐（板块编号/标题完全一致）。

### 9.1 6 板块固定格式（模板填空，不自由发挥排版）

1. **概览**：子程序表格（名/类型/功能摘要/计划翻译策略）+ 签名代码块 + 参数清单表（参数名|方向|PL/SQL 类型|Java 类型|说明）。
2. **表结构映射**：表格（表名|操作|关键条件|说明）+ 关键列。纯逻辑函数写"不涉及表操作"。
3. **依赖分析**：表格（目标包|目标子程序 refName|功能）+ 序列/常量依赖。无依赖写"无"。
4. **业务规则**：编号列表/表格列校验规则、计算逻辑、边界条件（从 source.sql 推导的计划规则）。
5. **控制流与异常**：简单子程序文字描述；复杂（>3 分支或含循环）用 Mermaid 流程图 + 异常路径表。
6. **特殊语法转化规约**：转化映射表（PL/SQL 构造|位置|Java/MyBatis 计划等价|风险）+ 事务边界 + "需手动审查的构造"固定收尾表。**第 6 板块填计划**——从 source.sql 推导的 PL/SQL→Java 映射（翻译未发生、**无 decisions 来源**）。

### 9.2 板块 6 固定收尾（严格遵守）

`### 6.3 需手动审查的构造` 表格——无则填"（无）"，**禁止用 TODO/checkbox 替代**。

### 9.3 质量要求

- **设计稿自包含**：每个板块写实质内容，**禁止"详见 xxx"占位符**。全程中文输出，专有名词与关键字保持英文。
- refName 用 inventory 算好的（重载带 `__序号`）。板块编号/标题与 summary 总结稿完全对齐。

## 十、自检清单

- [ ] 对照 scaffold procClassNames + packageMappings，本 unit 各 DDD 角色 per-proc 文件均已创建，文件名用 className 派生、路径按架构模型段角色 dir
- [ ] 无遗漏、无增加（除角色集模板外不擅自加文件）
- [ ] 未覆盖/删除/修改任何已存在文件
- [ ] 桩体可被 javac parse 通过
- [ ] AccessIntf 方法签名统一 `Map<String,Object> xxx(Map<String,Object>)`
- [ ] `segments[]` 已写 sidecar；>500 行时按算法切多段、单段 ≤500；段 TODO 标记与 `segments[].segId` 一一对应
- [ ] FSD 设计稿 `fsd/{pkg}/{ref}.md` 已生成：6 板块齐全 + `### 6.3` 收尾表；板块编号/标题与 summary 同构
