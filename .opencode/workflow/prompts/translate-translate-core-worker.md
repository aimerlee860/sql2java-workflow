# translate translate-core Worker 任务{{shardLabelSuffix}}

执行 **translate / translate-core** 子阶段：替换 skeleton 留下的 `// TODO:` 桩为真实翻译。**多段切分时每次只填一个 `// TODO:[seg-N]` 段**（引擎注入目标段），保留其它段不动、回写 sidecar status=done。方法论见 agent 指南（translate-core.md）。

⛔ **你只负责产出 artifact，禁止调用 workflow 工具的任何 action**。

## 职责（稳定）

- 读 skeleton 产出的 Java 文件（含 `// TODO:` 桩）+ 本 unit SQL 切片 + 依赖签名块 + **FSD 设计稿 `fsd/{pkg}/{ref}.md`**（路径见「本 unit 文件清单」，skeleton 产）。
- **写 mapper XML 的 SQL 时**：表名按 workOrder「本 unit 涉及表的 schema 归属」块标 `schema.tableName` 前缀（规约 §四规则 2）；块内列出的表不得裸名，未列入的表/synonym 保留原样并在 notes 注明。
- **遵循设计稿第 6 板块「特殊语法转化规约」**（skeleton 前置定的 PL/SQL→Java 映射策略）作填段指引；与五原则冲突以五原则为准，偏差留 summary 记，不回写设计稿。
- **若 workOrder 注入「本派发目标段」**（多段切分）：只替换对应 `// TODO:[seg-N]` 块为真实实现，**保留其它 `// TODO:[seg-*]` 段不动**；填完 read-modify-write sidecar `translations/{pkg}/{ref}.segments.json` 把该 `segId` 的 `status` 设为 `"done"`（勿动其它字段）。只用方法头已声明的过程级局部变量，不得新增过程级变量。
- **若未注入目标段**（≤500 行单段过程，sidecar 缺失/空）：一次性填完文件内所有 `// TODO:` 桩。
- **被填段/单段文件不得残留 `// TODO:`**（lint 子阶段核对残留）；未填段保留其 `// TODO:[seg-*]`。
- 不确定项由 LLM 给出最佳翻译，不留 TODO；不新建文件（skeleton 已建），只 read + edit 替换桩体。

## 输出（稳定）

- Java 文件：edit 替换桩体，写入 `projectRoot` 目录。
- ⛔ **不写 `status/translate.json`**——那是 translator master 的 advance 完成门控文件，仅 master 在 6 sub-stage 全过后写一次；slave 写会 clobber 门控、触发误 advance。你只在最后一段文本回 `TASK_STATUS` 给 master。

## 硬约束（稳定）

- ⛔ 完整任务已在本卡系统提示中。禁止 Read `.workOrder.md` / `dispatch-logs/`。
- ⛔ 只处理本分片 targetUnits，禁止越界。
- ⛔ 源码只读 `shard-inputs/{pkg}/{ref}/source.sql`。
- ⛔ 跨包调用签名查下方「依赖签名」块，禁止 read `translations/`。
- ⛔ **禁止 glob/ls/find/Grep 扫描 `src/`、`translations/`、`generated/` 目录**（数百文件平铺，一扫即爆上下文）；只 read/edit 下方「本 unit 文件清单」列出的绝对路径。

## Runtime Context + 本 unit 数据

{{scopeBanner}}

- runId: `{{runId}}`
- phase: translate / sub-stage: translate-core
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
