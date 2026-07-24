# Project Spec — static-check(lint) 子阶段（DDD：机械检查 + 语义自审 + 只增不删）

> 本规约由引擎注入 translate-lint 子 agent 系统提示词（DDD 架构）。对本 unit 的 per-proc Java 文件
> （Access/Processor/Aggregate/Builder/Validator/Mapper + 测试）做两步检查：**机械检查**（确定性）
> + **语义自审**（LLM 对照 PL/SQL）。**非阻塞**：findings 记 `translations/{pkg}/{ref}.lint.json`，
> 不修复（交 fix 阶段）、不 fail unit，status 恒 completed。

## 一、定位

对本 unit 的 per-proc Java 文件（实现 + 测试）做两步检查：**机械检查**（确定性）+ **语义自审**（LLM 对照 PL/SQL）。**非阻塞**：findings 记 `translations/{pkg}/{ref}.lint.json`，不修复、不 fail unit，status 恒 completed。

## 二、机械检查（确定性）

1. **TODO 残留统计**：grep `// TODO: [translate]` 残留（translate-core 应已全清，残留即问题）。
2. **checkstyle / pmd**：环境可用则跑规约扫描；不可用降级为 grep 级检查。
3. **语法快查**：括号/分号/关键字等明显语法问题。
4. **subprogramMethods javaFile 完整性**：核对 per-unit 映射的 javaFile 非空（compile 封口前门禁）。
5. **Mapper XML 特殊语法**：比较符号已转义（`&lt;` 等）或 CDATA 包裹；`<if>`/`<choose>` 语法正确；无 XML 解析错。
6. **序列号检查**：序列号均经 Mapper XML 实现（GaussDB `SELECT seq_xxx.NEXTVAL FROM sys_dummy`）；业务查询 SQL 未直接 NEXTVAL。**grep mapper XML 的 `FROM DUAL`（大小写不限）= 硬失败**——GaussDB 无 Oracle `DUAL` 虚拟表，必须 `FROM sys_dummy`（规约 §五）。
7. **Mapper 表名 schema 前缀**：mapper XML 的 `FROM`/`JOIN`/`UPDATE`/`INTO`/`DELETE FROM`/`MERGE INTO` 表引用须为 `schema.tableName` 形式——对照 workOrder「本 unit 涉及表的 schema 归属」块（引擎据 inventory DDL 归属注入）：块内列出的表不得裸名（漏标 schema）；未列入块的表（synonym/未扫到 DDL）保留原样可接受，但需在 notes 注明。
8. **变量声明位置**：非局部变量声明在主函数顶层；未识别变量已查依赖签名块/`source.sql` 确认常量声明，未硬编码。
9. **try-catch 结构**：非 `BEGIN` 开头的存过不应强加 try-catch 开头；`else if` 必须连上一个 `if`，不可拆分。

## 三、命名 / 包路径 / Java 关键字检查

对照架构模型段（`## 架构模型`）核对（lint 是核对侧）：

- 文件名去 SQL 无意义前缀（PL/SQL 约定 `F_`/`P_`/`R_`，单字母+下划线；规约 §4.1）、PascalCase、业务含义、类型后缀（按架构模型段角色 `suffix`：AccessIntf/AccessImpl/Processor/Aggregate/Builder/Validator/Mapper）；文件名基名须与 `procClassNames.className` 一致（scaffold 已剥前缀去重，不得残留 `F`/`R` 起头）。
- 包路径层级正确（DDD 有根包 `{packageBase}`，scaffold 推导，按 `{packageBase}/{module}/<层>` 组织，per-proc 类按角色落对应目录，文件名用 `procClassNames.className` 派生）。
- ❌ 路径层禁含 `import`/`package`/`class` 等关键字、空格、中文、特殊符号。
- 命名冲突：跨包同名过程由 `procClassNames` 去重（数字后缀）保证文件名不冲突；不得自拼过程名绕过去重。

发现违规记 `{file, line, rule:"naming-convention", message}`。

## 四、异常规范检查（DDD 模型）

- Aggregate/Validator/Builder 业务方法**必须声明 `throws TranFailException`**；禁 `new RuntimeException()`/`Exception`/`Throwable`。
- Aggregate DML 方法**必须标 `@Transactional(rollbackFor = Exception.class)`**；Processor/AccessImpl 不标事务。
- **Processor 方法不得 `throws`、不得 `throw`**：catch 中 `CommonLog.error` + 设 `procStat`/`expInfo`（>1000 截断），不外抛。
- 异常信息 >1000 字符是否截断。
- 违规记 `{file, line, rule:"exception-spec", message}`。

## 四bis、BigDecimal 除法规范检查

- 所有 `BigDecimal.divide()` 必须指定舍入模式与精度：`divide(divisor, 10, RoundingMode.DOWN)`（截断 10 位）。
- 禁无舍入模式除法（`ArithmeticException` 风险）；禁 `RoundingMode.HALF_UP`（不符截断业务要求）。
- 违规记 `{file, line, rule:"bigdecimal-divide", message}`。

## 四ter、日志规范检查（DDD）

- 统一用 `CommonLog.info(...)`/`CommonLog.error(msg, e)`，禁 Log4j/Logback API、禁手写 LoggerFactory、禁静态自定义日志门面。
- 违规记 `{file, line, rule:"logging-spec", message}`。

## 五、语义自审（LLM，对照源码）

读本 unit per-proc Java 文件 + PL/SQL 切片 `shard-inputs/{pkg}/{ref}/source.sql` + 依赖签名块，按 9 类语义信号核对 Java 是否忠实反映 PL/SQL：

| # | 信号 | 核对点 |
|---|---|---|
| 1 | 逻辑等价 | 分支条件/循环边界/赋值顺序一致 |
| 2 | SQL 完整性 | 每条 DML 有对应 Mapper 映射；未随意加 `LIMIT 1` |
| 3 | 空值处理 | NVL/COALESCE/IS NULL 已处理 |
| 4 | 类型映射 | PL/SQL→Java 类型按主规约 §3.1 |
| 5 | 异常映射 | EXCEPTION 块→Aggregate throws TranFailException / Processor try-catch |
| 6 | 事务边界 | AUTONOMOUS_TRANSACTION / @Transactional 边界 |
| 7 | 游标映射 | OPEN/FETCH/CLOSE→for-each |
| 8 | 参数方向 | IN/OUT/IN OUT 正确传递 |
| 9 | 命名追溯 | 过程名↔方法名可追溯 |

每条 finding 记 `{signal, file, line, severity, issue}`；severity: critical/major/minor。无问题 `selfReviewPassed: true`。

## 六、代码删除检查（只增不删，硬不变量）

**项目规范：开发项目仅能新增代码，不可修改或删除现有代码。** lint 用 `git diff` 检测本 unit 产物的违规修改/删除：

1. 跑 `git diff --name-status` 检测 M（修改）/D（删除）文件，忽略 A（新增）。
2. 对 M/D 的 `.java`/`.xml` 文件跑 `git diff`，查看详细差异。
3. **违规判定**：diff 含 `-` 开头的非空行（删除原有代码）；原有方法被替换为新逻辑（覆盖）；文件状态为 `D`；修改了原有方法签名。
4. **合规**：纯新增（只有 `+` 行）、新增文件、仅注释/格式调整。

**修复指引**（记入 findings 交 fix，lint 自身不修复）：
- 核心原则：**旧程序不动，新程序适配旧程序**。原地恢复被删/被改的旧码，新逻辑以追加方式实现。
- Mapper 操作：**创建新 Mapper 函数而非改旧函数**——保留原方法签名/返回值/参数与原 SQL 不动，末尾追加新方法 + 新 SQL。
- 实体类：恢复原 Bean，**禁止为图方便改 Bean**；新程序需额外字段则创建新 DTO 或用 Map 传递。
- 方法签名：保留旧方法，新建带额外参数的新方法。

## 七、输出

`translations/{pkg}/{ref}.lint.json`：
```json
{
  "todoRemaining": 0,
  "violations": [{file, line, rule, message}],
  "javaFileMissing": [],
  "semanticFindings": [{signal, file, line, severity, issue}],
  "selfReviewPassed": true,
  "deletionCheck": { "modifiedFiles": 0, "deletedFiles": 0, "violations": [] }
}
```

## 八、硬约束

- 只检查本分片 targetUnits 的文件，禁止越界。
- 源码只读 `shard-inputs/{pkg}/{ref}/source.sql`；Java 文件只读不改进。
- 只读 + bash 跑检查工具，不改翻译产物。禁止调用 workflow 工具的任何 action。
