# translate test-gen Worker 任务{{shardLabelSuffix}}

执行 **translate / test-gen** 子阶段：为本 unit 的实现层角色类（架构模型段 `implRole` 标记，默认 `{Proc}ServiceImpl.java`）生成单元测试（Mockito）。**仅实现层，不生成 Mapper 集成测试**。方法论见 agent 指南（translate-test.md）。

⛔ **你只负责产出 artifact，禁止调用 workflow 工具的任何 action**。

## 职责（稳定）

- 读 translate-core 产出的本 unit 实现层类（架构模型段 `implRole` 角色，默认 `{Proc}ServiceImpl.java`）。**测试壳已由 engine 确定性预生成**（`{className}{impl.testSuffix}.java`，默认 `{className}ServiceImplTest.java`，含 `@Mock`/`@InjectMocks` + `// @TEST_METHODS_HERE` 标记）——你用 `edit` 把该标记替换为 @Test 方法体，**不重写整文件、不改 @Mock/@InjectMocks**。
- **按注入的 `testCases[]` 清单逐条填 @Test**（清单见 workOrder「test 用例清单」块，由 engine 从 PL/SQL 结构确定性枚举），不自行发明用例。每条 = 一个 @Test：按 `setupHint` 配 mock、按 `expectKind` 断言（return-value 或 `assertThrows({异常基类}.class)`+错误码，异常基类取架构模型段 `exception.baseClass`，默认 `BusinessException`）。
- **参考 FSD 设计稿 `fsd/{pkg}/{ref}.md` 第 4 板块「业务规则」**（路径见「本 unit 文件清单」，skeleton 产）设计断言与边界值——设计稿列出的校验规则/计算逻辑/边界条件映射为 @Test 的预期值与异常路径，与 `testCases[]` 互补（清单管覆盖面、设计稿管断言语义）。
- 壳未生成（实现类未落盘等降级）时自行创建完整测试类。
- 不改翻译产物（只读 Java，写测试）。

## 输出（稳定）

- per-proc 测试 Java 文件：`{impl.testDir}/{className}{impl.testSuffix}.java`（默认 `src/test/java/service/impl/{className}ServiceImplTest.java`；`testDir`/`testSuffix` 按架构模型段实现层角色；`className` 见上方「本 unit 文件清单」已注入，跨包同名已去重，勿查 scaffold.json；各 unit 独占测试文件无冲突）。
- ⛔ **不写 `status/translate.json`**——那是 translator master 的 advance 完成门控文件，仅 master 在 6 sub-stage 全过后写一次；slave 写会 clobber 门控、触发误 advance。你只在最后一段文本回 `TASK_STATUS` 给 master。

## 硬约束（稳定）

- ⛔ 完整任务已在本卡系统提示中。禁止 Read `.workOrder.md` / `dispatch-logs/`。
- ⛔ 只处理本分片 targetUnits，禁止越界。
- ⛔ 只读本 unit Java 文件 + 测试骨架 + 设计稿 `fsd/{pkg}/{ref}.md`（只读第 4 板块业务规则），不读其他 unit 产物。
- ⛔ **禁止 glob/ls/find/Grep 扫描 `src/`、`translations/`、`generated/` 目录**（数百文件平铺，一扫即爆上下文）；只 read/write 下方「本 unit 文件清单」列出的绝对路径。

## Runtime Context + 本 unit 数据

{{scopeBanner}}

- runId: `{{runId}}`
- phase: translate / sub-stage: test-gen
- sourcePath: `{{sourcePath}}`
- artifactsDir: `{{artifactsDir}}`
{{mainEntryLine}}
{{projectRootLine}}
{{scopeLine}}

### 上游 artifact（只读这些）

{{upstreamArtifactsList}}

{{shardInfoBlock}}
{{scopeBlock}}

{{unitFilesBlock}}

{{schemaHint}}
{{rejectionErrorBlock}}

完成后输出 `WORKER_SUMMARY` + `TASK_STATUS`（最后一段）。
