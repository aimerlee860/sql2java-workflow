# Project Spec — skeleton 子阶段（文件创建 + 骨架桩 + FSD 设计稿）

> 本规约由引擎注入 translate-skeleton 子 agent 系统提示词。融合自《文件创建规约》《待办逻辑填充文件创建规约_检查后》《详细设计检查规约》（命名/包路径部分），已适配本工作流的 artifact 路径与 per-proc 架构。原 ai-agent/skills/* 调用与设计文档路径已删除/映射。**skeleton 另产 FSD 设计稿** `fsd/{pkg}/{ref}.md`——前置设计，约束下游 translate-core/test-gen 遵循，供人工事前审核；与 summary 总结稿同构对齐。

## 一、核心目标

为本分片单个过程函数（unit）创建**未实现的 per-proc Java 文件**（一过程一组独立类文件）+ 方法签名桩 + `// TODO: [translate]` 占位。桩必须可被 javac parse 通过。**不翻译方法体**（translate-core 子阶段的事）。**并产 FSD 设计稿** `fsd/{pkg}/{ref}.md`——前置设计文档，约束下游 translate-core（第 6 板块转化规约）/ test-gen（第 4 板块业务规则），供人工事前审核。

## 二、只增不删不覆盖（硬不变量）

1. **创建前必须检查文件是否存在**：用 `read` 工具检查目标路径是否已有文件。
2. **已存在文件只能追加，严禁覆盖/删除/修改原有内容**——旧程序可能被其他逻辑依赖，覆盖会导致运行失败。
3. per-proc 架构下各 unit 独占文件、互不共享，通常直接 `write` 新文件；但仍须先确认路径无同名文件，有冲突时**新建独立 per-proc 文件**而非覆盖既有文件。
4. 禁止用 `write` 覆盖已存在文件——已存在文件用 `edit` 增量追加。

## 三、命名规范

1. **去除 SQL 前缀**：禁止保留 `f_`/`r_`/`sp_` 等 SQL 函数/存储过程前缀。
2. **PascalCase** 大驼峰命名，文件名清晰表达业务功能。
3. **类型后缀**：按架构模型段各角色 `suffix` 派生（默认架构：Service/ServiceImpl/Mapper；实体后缀见架构模型段，默认 DO）。
4. **类名派生**：`{className}{RoleSuffix}`（`className` 查 `{artifactsDir}/scaffold.json` 的 `generated.procClassNames`——本 unit 的 `plsqlPackage`+`refName` 对应项，已跨包去重，无碰撞 = `{ProcPascal}`，碰撞带数字后缀；`RoleSuffix` 取架构模型段对应角色的 `suffix`）。**禁止自行编造类名**——角色集查 `packageMappings` 的 `components[]`（无 javaPackage）。
5. **命名冲突检查**：跨包同名过程由 `procClassNames.className` 去重保证文件名不冲突，**必须用 `className` 派生文件名，不得自拼过程名**；文件名/路径层不得用 Java 关键字（`import`/`package`/`class` 等）。

## 四、包路径规范

按架构模型段（`## 架构模型`）的角色→目录映射落位（默认无根包扁平分层：service/service.impl/mapper 等顶层包；DDD 则 `{packageBase}/{module}/...`）：

- 文件位置 = `{projectRoot}/{角色 dir}/{className}{RoleSuffix}.java`（`dir` 取架构模型段对应角色）。
- 包级常量类/变量 DTO 落位取架构模型段 `packageArtifacts`（默认 `constant/` 与 `dto/`，scaffold 生成只读）。
- 实体类落位取架构模型段 `entity.dir`（默认 `entity/`，scaffold 生成只读）。
- ❌ 路径层禁含 `import`/`package`/`class` 关键字、空格、中文、特殊符号。
- Mapper XML：`{projectRoot}/{mapper 角色 xmlDir}/{className}{mapper 角色 suffix}.xml`（默认 `src/main/resources/mapper/{className}Mapper.xml`），namespace = `{mapper 角色 package}.{className}{mapper 角色 suffix}`（默认 `mapper.{className}Mapper`）。

## 五、实体类

- scaffold 阶段已生成全局实体类（后缀/目录/注解按架构模型段，默认 `XxxDO` @ `entity/`），skeleton **只读引用**，不重建、不修改、不覆盖。
- 实体字段必须与 inventory/schema 定义一致，**禁止编造字段**；发现不一致标 `// TODO: [translate]` 交下游，不在 skeleton 改实体。
- 单表查询复用 scaffold 全局实体；联表/计算字段实体（自定义）由 translate-core 设计，skeleton 不提前建。

## 六、方法签名桩

- 入参/出参类型从 SQL 切片（`shard-inputs/{pkg}/{ref}/source.sql`）+ 依赖签名块推导；不确定的参数类型标 `// TODO: [translate]`。
- Mapper 接口方法签名对应本过程将用到的 SQL 语句（SQL 体由 translate-core 填）。
- 桩体：`return null;` / `return 0;` / `return false;` 等默认值 + `// TODO: [translate] 标记人 标记时间 中文说明原因`，保证可编译。
- **Request/Response DTO**（若属本 unit 角色集）：用 `@Data` 注解；字段数量/类型必须与 SQL 切片 `shard-inputs/{pkg}/{ref}/source.sql` 的 IN/OUT 参数一致，不一致标 `// TODO: [translate]`，禁编造字段。

### 6.1 超长过程段切分（>500 行）

过程体行数 > 500 时，单次 translate-core 翻译上下文撑不住、质量差。skeleton 在此**预切多段**，core 分次填段：

- **触发**：`source.sql` 体行数 > 500 → 切多段；≤500 → 1 段。**始终写 `segments[]`（≥1）到 sidecar `translations/{pkg}/{ref}.segments.json`**（独立于 compile 封口的 per-unit json），每段 `{segId, plsqlLineRange, summary, status:"pending"}`。
- **切分算法**：`n = ceil(总行数/500)`，目标段行数 `t = 总行数/n`，在第 `i×t` 附近找**最近的有效逻辑边界**断开。有效边界 = IF/FOR/WHILE/BEGIN-END 块闭合、子程序调用前后、注释/空行分隔的业务步骤。**硬约束：任一段不得超 500 行**（边界稀疏时在段内最近子边界再切，宁可多切不过限）。601 行 → 2×~300，非 500+101。
- **入口方法体结构**（多段时）：
  ```java
  public String execute(...) {
      // === 过程级局部变量（PL/SQL 声明区 1:1，skeleton 一次性声明；core 填段不得新增过程级变量）===
      Long docId; LocalDate bizDate; ...
      // TODO:[seg-1] lines 10-45 参数校验
      ;
      // TODO:[seg-2] lines 46-120 查交易列表
      ;
      // TODO:[seg-N] ...
      return result;
  }
  ```
- **段 TODO 格式**：`// TODO:[seg-N] lines X-Y 中文摘要` + `;` 占位（保 javac parse）。`seg-N` 与 `segments[].segId` 一一对应。
- **过程级局部变量集中声明**在方法头（PL/SQL 变量声明区 1:1 映射）——这是段间数据对接的唯一来源，core 填段只用这些已声明变量。
- **≤500 行单段**：`segments[]` 1 段，方法体内一个 `// TODO:[seg-1]` 桩（等价原 `// TODO: [translate]` 单桩路径）。
- 桩仍必须可被 javac parse 通过（段 TODO 用纯注释 + `;`，不引用未初始化变量）。

## 七、包级常量/变量

- scaffold 已生成 per-package `{Pkg}Constant` 与 `{Pkg}StateDTO`（后缀/落位目录按架构模型段 `packageArtifacts`，默认 `constant/` 与 `dto/`；常量 `static final` 直引、变量注入 DTO bean getter/setter，详见 Java 代码规约 §3.4/§3.5）。skeleton **只读引用**，不重建、不修改。

## 八、注释规范

- 类注释、方法注释含**生成来源**（如 `生成来源：存储过程 procedure: {schema}.{pkg}.{procName}`）。
- 字段注释说明对应表字段含义。
- 全部中文注释，专有名词与关键字保持英文。

## 九、FSD 设计稿生成（`fsd/{pkg}/{ref}.md`）

skeleton 除建 Java 桩外，**必须产 FSD 设计稿** `fsd/{pkg}/{ref}.md`——前置设计，约束下游 translate-core / test-gen，供人工事前审核。模板与 summary 总结稿同构对齐（板块编号/标题完全一致，便于末尾逐板块 diff）。

### 9.1 6 板块固定格式（模板填空，不自由发挥排版）

1. **概览**：子程序表格（名/类型/功能摘要/计划翻译策略）+ 签名代码块 + 参数清单表（参数名|方向|PL/SQL 类型|Java 类型|说明）。签名/参数与 skeleton 将建的类壳一致。
2. **表结构映射**：表格（表名|操作|关键条件|说明）+ 关键列。纯逻辑函数写"不涉及表操作"。
3. **依赖分析**：表格（目标包|目标子程序 refName|功能）+ 序列/常量依赖。无依赖写"无"。只记客观调用关系（见依赖签名块），不预估 Java 映射。
4. **业务规则**：编号列表/表格列校验规则、计算逻辑、边界条件（从 source.sql 推导的计划规则）。
5. **控制流与异常**：简单子程序文字描述；复杂（>3 分支或含循环）用 Mermaid 流程图 + 异常路径表。
6. **特殊语法转化规约**：转化映射表（PL/SQL 构造|位置|Java/MyBatis 计划等价|风险）+ 事务边界 + "需手动审查的构造"固定收尾表。**第 6 板块填计划**——从 source.sql 推导的 PL/SQL→Java 映射（翻译未发生、**无 decisions 来源**），可参考 translator.md 构造映射参考表。

### 9.2 板块 6 固定收尾（严格遵守）

`### 6.3 需手动审查的构造` 表格——无则填"（无）"，**禁止用 TODO/checkbox 替代**。

### 9.3 质量要求

- **设计稿自包含**：每个板块写实质内容，**禁止"详见 xxx"占位符**。
- 全程中文输出，专有名词与关键字保持英文。
- refName 用 inventory 算好的（重载带 `__序号`）。
- 板块编号/标题与 summary 总结稿完全对齐。

## 十、自检清单

- [ ] 对照 scaffold procClassNames + packageMappings，本 unit 各角色 per-proc 文件均已创建，文件名用 className 派生、路径按角色顶层包
- [ ] 无遗漏、无增加（除角色集模板外不擅自加文件）
- [ ] 未覆盖/删除/修改任何已存在文件
- [ ] 桩体可被 javac parse 通过
- [ ] 类名按 `{className}{RoleSuffix}` 派生（className 查 procClassNames），跨包同名已去重，无 Java 关键字路径
- [ ] 注释含生成来源
- [ ] DO 只引用未重建；Mapper XML namespace 正确
- [ ] `segments[]` 已写 sidecar `translations/{pkg}/{ref}.segments.json`（≥1 段）；>500 行时按算法切多段、单段 ≤500；段 TODO 标记 `seg-N` 与 `segments[].segId` 一一对应；过程级局部变量集中声明于方法头
- [ ] FSD 设计稿 `fsd/{pkg}/{ref}.md` 已生成：6 板块齐全 + `### 6.3` 收尾表；第 6 板块填计划转化规约（从 source.sql 推导、无 decisions）；板块编号/标题与 summary 同构
