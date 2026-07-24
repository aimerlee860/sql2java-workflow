# Project Spec — compile 子阶段（DDD：语法检查 + 代码索引封口）

> 本规约由引擎注入 translate-compile 子 agent 系统提示词（DDD 架构）。用 `javac` 检查本 unit
> Java + 单测语法，有错则 `edit` 修复后重检，**循环直到语法通过**；通过后**封口** per-unit JSON
> （= 代码索引登记）。

## 一、定位

用 `javac` 检查本 unit Java + 单测语法，有错则 `edit` 修复后重检，**循环直到语法通过**；通过后**封口** per-unit JSON（= 代码索引登记）。

## 二、语法检查 + 修复循环

1. `javac` 对本 unit Java 文件（Access/Processor/Aggregate/Builder/Validator/Mapper + 单测）做语法检查。语法错不依赖完整 classpath，本 unit 文件即可判定。
2. **本阶段只保证语法正确性**——类型/符号解析/完整编译由 verify 阶段 `mvn compile` 增强。
3. 有语法错 → `edit` 修复（仅限语法错，**不动翻译逻辑**）→ 重检，循环直到通过。
4. 错误归因：javac 输出只看本 unit 文件路径的语法错。
5. 无 JDK → 降级跳过 javac（记录 `skipReason`），语法正确性由 verify 兜底。

## 三、封口 = 代码索引登记

本 unit 语法通过后，写 per-unit JSON `translations/{pkg}/{ref}.json`：

- `status: "completed"`
- **`subprogramMethods`**：本 unit 所有子程序 → Java 类/方法/文件映射，**javaFile 必须填全**（lint 子阶段已核对）。这就是项目的**代码索引**——等价于"子程序→Java 类/方法"的映射登记。

### 索引字段要求

| 字段 | 内容 | 示例（DDD） |
|---|---|---|
| 子程序 refName | inventory 算好的 refName（重载带 `__序号`） | `r_fxsp_imp` |
| SQL 完整路径 | `schema.pkg.funcName` 格式 | `gmo.p_gmo_fx_trade_import.r_fxsp_imp` |
| Java 方法 | `className.methodName()` 格式（className 含角色后缀） | `FxspImpProcessor.fxspImp()` |
| Java 文件相对路径 | 从 projectRoot 起的相对路径（按架构模型段入口角色 `dir`） | `src/main/java/{packageBase}/fxsp/processor/FxspImpProcessor.java` |

> 入口角色类全限定名（`javaClass`）按架构模型段 `crossPackageCall.fqnPattern` 派生（DDD = `{packageBase}.{module}.access.{className}AccessIntf`，入口角色 = access）。

- 序号递增、路径可定位到文件、命名可追溯（过程名↔方法名）。
- **维护要求**：完成后立即登记（不延后）、路径准确可定位、翻译逻辑与原始 PL/SQL 定义一致。
- `completedSubprograms`、`files`、`decisions`、`todos` 等按 UnitTranslationSchema 填。

## 四、编译检查清单

- [ ] 本 unit Java + 单测 javac 语法通过（或无 JDK 降级记录 skipReason）
- [ ] 修复仅限语法错，未动翻译逻辑
- [ ] `subprogramMethods` 全部子程序映射填全，javaFile 非空
- [ ] 索引字段完整（refName/SQL 路径/Java 方法/Java 文件路径）
- [ ] `status: "completed"`
- [ ] import 语句正确、依赖已注入

## 五、硬约束

- 只检查/修复本分片 targetUnits 的文件，禁止越界改其他 unit。
- 修复仅限语法错，不动翻译逻辑（逻辑问题交 review/fix）。
- 禁止 read `translations/{pkg}/translation.json`（聚合由 engine 自动 merge，不直接写）。
- 禁止调用 workflow 工具的任何 action。

完成后输出 `WORKER_SUMMARY` + `TASK_STATUS`。
