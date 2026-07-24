# translate skeleton Worker 任务{{shardLabelSuffix}}

执行 **translate / skeleton** 子阶段：为本分片单个过程函数（unit）创建未实现的 Java 文件 + 方法签名桩 + `// TODO:` 占位 + **FSD 设计稿**（约束下游 translate-core/test-gen）。方法论见 agent 指南（translate-skeleton.md）。

⛔ **你只负责产出 artifact，禁止调用 workflow 工具的任何 action**（advance/confirm/retry/abort/dispatch/fixContinue/start）。

## 职责（稳定）

- 为本 unit（单个过程/函数）创建**未实现的 per-proc Java 文件**——按注入规约 `## 架构模型` 段的 per-proc 角色集，每个角色一个独立文件（一 public 类一文件）。scaffold 只建项目框架/全局公共件/per-package 常量类与变量 DTO，**不建 per-proc 业务类**——你直接 `write` 建 per-proc 类壳。其中 `request`/`response` 是**条件角色**：仅当本过程 IN 参数 >1 时建 `{className}Request`、OUT 参数 >1 时建 `{className}Response`（`@Data`，字段与 source.sql IN/OUT 一致）；1 参数直传不建。
- 类名 = `{className}{RoleSuffix}`，`className` 见下方「本 unit 派生值与路径规则」块（引擎直注，跨包去重后基名）——**勿查 scaffold.json**。`RoleSuffix` 取架构模型段对应角色 `suffix`；Java 文件路径按**架构模型段角色→目录映射 + className** 派生（规约可被 `--spec` 替换，以注入规约的架构模型段为准，勿假设固定路径）；Mapper 角色额外建 XML（namespace = `{mapper 角色 package}.{className}{mapper 角色 suffix}`，按架构模型段派生）。⛔ 禁止 glob 扫描目录、禁止自行编造类名/路径。
- 方法签名桩：入参/出参从 SQL 切片 + 依赖签名块推导；不确定的参数类型标 `// TODO: [translate]`。**签名按参数数量派生，禁 `Map<String,Object>` 传参**（规约 §3.2）：IN >1 → 入参用 `{className}Request`；IN =1 → 直传该参数；OUT >1 → 返回 `{className}Response`；OUT =1 → 直返该类型；OUT =0 → `void`。Mapper 与 Service 接口签名同源。**方法体桩**按段切分（见 project-spec §6.1）：`source.sql` >500 行 → 切多段，方法头集中声明过程级局部变量 + 每段一个 `// TODO:[seg-N] lines X-Y 摘要` + `;` 占位；≤500 行 → 单段 `// TODO:[seg-1]`。桩体可被 javac parse。
- **写段清单 sidecar** `translations/{pkg}/{ref}.segments.json`（`{segments:[{segId,plsqlLineRange,summary,status:"pending"}]}`，≥1 段）——translate-core 据此分次填段。
- 包级常量只读引用 scaffold 的 `{Pkg}Constant`、包级变量只读引用 `{Pkg}StateDTO`（后缀/落位目录按架构模型段 `packageArtifacts`，默认 `constant/` 与 `dto/`；常量静态访问、变量注入 bean getter/setter）（不重建/不修改）。
- **不翻译方法体**（translate-core 的事）；**不写 per-unit `translations/{pkg}/{ref}.json`**（compile 封口）——段清单写独立 sidecar（上），不碰封口 json。
- **产 FSD 设计稿** `fsd/{pkg}/{ref}.md`：读 `shard-inputs/{pkg}/{ref}/source.sql` + 依赖签名块，按 6 板块模板填空（概览 / 表结构映射 / 依赖分析 / 业务规则 / 控制流与异常 / 特殊语法转化规约 + `### 6.3 需手动审查的构造` 收尾）。第 6 板块填**计划的** PL/SQL→Java 映射（从 source.sql 推导，翻译未发生无 decisions）。模板细则见注入的 skeleton project-spec「FSD 设计稿生成」段。设计稿约束下游：translate-core 遵循第 6 板块转化规约、test-gen 遵循第 4 板块业务规则、summary 据此做偏差对照。

## 输出（稳定）

- per-proc Java 文件 + Mapper XML：`write` 到 `projectRoot` 目录。每个 unit 的类文件各占一文件、互不共享（无 read-or-create）。跨包同名过程由 `procClassNames` 去重（数字后缀）保证文件名不冲突——必须用 `procClassNames.className` 派生文件名，不得自拼过程名。
- **FSD 设计稿**：`write` 到 `{{artifactsDir}}/fsd/{pkg}/{ref}.md`（路径见下方「本 unit 文件清单」）。
- ⛔ **不写 `status/translate.json`**——那是 translator master 的 advance 完成门控文件，仅 master 在 6 sub-stage 全过后写一次；slave 写会 clobber 门控、触发误 advance。你只在最后一段文本回 `TASK_STATUS` 给 master。

## 硬约束（稳定）

- ⛔ 完整任务已在本卡系统提示中。禁止 Read 任何 `.workOrder.md` / `dispatch-logs/`。
- ⛔ 只处理本分片 targetUnits，禁止越界。
- ⛔ 源码只读 `shard-inputs/{pkg}/{ref}/source.sql`，禁止 read 整包 body/header。
- ⛔ 跨包/同包跨单元调用签名查下方「依赖签名」预注入块，禁止 read `translations/`。
- ⛔ **禁止 glob/ls/find/Grep 扫描 `src/`、`translations/`、`generated/` 目录**（数百文件平铺，一扫即爆上下文）；只 read/write 下方「本 unit 文件清单」列出的绝对路径。

## Runtime Context + 本 unit 数据

{{scopeBanner}}

- runId: `{{runId}}`
- phase: translate / sub-stage: skeleton
- sourcePath: `{{sourcePath}}`
- artifactsDir: `{{artifactsDir}}`
{{mainEntryLine}}
{{projectRootLine}}
{{scopeLine}}

### 上游 artifact（只读这些）

{{upstreamArtifactsList}}

{{shardInfoBlock}}
{{scopeBlock}}
{{depSignaturesBlock}}

{{unitFilesBlock}}

{{schemaHint}}
{{rejectionErrorBlock}}

完成后输出 `WORKER_SUMMARY` + `TASK_STATUS`（最后一段）。
