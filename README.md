# SQL2Java Workflow

基于 AI Agent 的 Oracle PL/SQL → Spring Boot + MyBatis 自动化翻译系统。采用确定性状态机驱动的多阶段工作流，以严格 1:1 忠实转换为原则，将 PL/SQL 代码翻译为 Java 应用。

## 架构概览

```
┌─────────────────────────────────────────────────────────┐
│  /translate command                                      │
│  参数解析 → 路由分发 → 工作流引擎驱动                       │
└──────────────┬──────────────────────────────────────────┘
               │
       ┌───────┴───────┐
       ▼               ▼
  Level 1: 项目级    Level 2: 包级翻译
  ────────────────  ──────────────────
  inventory         parse
  analyze           translate
  plan              review
  scaffold          verify + fix loop
```

系统采用**两级工作流架构**：

- **Level 1（项目级）**：扫描 PL/SQL 源码，分析依赖关系，规划 Java 架构，生成项目骨架
- **Level 2（包级翻译）**：对每个 PL/SQL 包执行解析 → 翻译 → 审查 → 验证的循环

## 项目结构

```
sql2java-workflow/
├── agent/                          # 7 个专用 Agent 定义
│   ├── sql-analyst.md              #   PL/SQL 分析专家 — 编目、依赖图、复杂度评估
│   ├── sql-parser.md               #   PL/SQL 静态解析器 — 生成结构化中间表示 (IR)
│   ├── java-architect.md           #   Java 架构师 — 规划项目结构、生成骨架代码
│   ├── translator.md               #   翻译引擎 — IR → Java/MyBatis 代码翻译
│   ├── java-reviewer.md            #   翻译审查 — 逻辑等价性、SQL 完整性检查
│   ├── test-generator.md           #   测试生成 — 编译验证、MyBatis XML 校验、测试骨架
│   └── debugger.md                 #   故障诊断 — 分析工作流失败原因
├── command/
│   └── translate.md                # /translate 命令 — 工作流入口与调度逻辑
├── plugin/
│   └── workflow-engine.ts          # 工作流引擎插件 — 确定性状态机、Artifact 管理
├── workflow/
│   ├── engine-core.ts              #   状态机核心 — 阶段定义、状态流转、重试机制
│   ├── workflow-definitions.ts     #   工作流定义 — 阶段配置、Artifact Schema、类型映射
│   └── batch-orchestrator.ts       #   批量编排器 — 拓扑排序、断点续译、进度持久化
└── README.md
```

## 核心设计

### 五条翻译原则

| 原则 | 说明 |
|------|------|
| **不重构** | 保持原有逻辑结构，不做任何重构 |
| **不优化** | 直接映射（如 cursor loop → for-each），不做性能优化 |
| **不合并** | 分立的 SELECT 保持独立，不合并查询 |
| **不遗漏** | 每条 PL/SQL 语句都必须有对应的 Java 翻译 |
| **不猜测** | 不确定的翻译用 `TODO` 注释标记，不臆测 |

### Oracle → Java 映射支持

| Oracle PL/SQL | Spring Boot + MyBatis |
|---------------|----------------------|
| `SELECT INTO` | Mapper 方法 + 异常处理 |
| `BULK COLLECT` | `List<T>` 返回 + 批处理 |
| `FORALL` | MyBatis `<foreach>` 批量操作 |
| `CURSOR LOOP` | for-each 遍历 Mapper 结果 |
| `PRAGMA AUTONOMOUS_TRANSACTION` | `@Transactional(propagation = REQUIRES_NEW)` |
| `EXECUTE IMMEDIATE` | 动态 SQL（注解或 XML） |
| `EXCEPTION` 块 | Spring `DataAccessException` 层次 |

### 类型映射

内置 Oracle 数据类型到 Java/JDBC 的完整映射（`ORACLE_TO_JAVA`、`ORACLE_TO_JDBC`），涵盖 `VARCHAR2`、`NUMBER`、`DATE`、`CLOB`、`XMLTYPE` 等常用类型。

## 工作流引擎

### 状态机核心 (`engine-core.ts`)

```typescript
class WorkflowEngine {
  start(definitionId: string, input: Record<string, unknown>): WorkflowRun
  advance(runId: string, output: unknown): PhaseResult
  retry(runId: string, input?: unknown): PhaseResult
  abort(runId: string): void
  status(runId: string): WorkflowStatus
}
```

- **确定性流转**：基于预定义的阶段配置执行状态转移
- **条件路由**：根据 Artifact 验证结果动态选择下一阶段
- **重试机制**：可配置最大重试次数，支持指定输入重新执行
- **人工审批门**：关键阶段（如 `plan`）需人工确认后继续

### Artifact 管理 (`workflow-engine.ts`)

每个阶段产出 Artifact，供下游阶段消费：

```
.workflow-artifacts/
├── {runId}/inventory.json
├── {runId}/analysis.json
├── {runId}/plan.json
├── {runId}/scaffold.json
├── {runId}/{package}/parsed.json
├── {runId}/{package}/translation.json
├── {runId}/{package}/review.json
└── {runId}/{package}/verify.json
```

- 使用 **Zod Schema** 严格校验每个 Artifact 的结构
- 支持 **Schema 收敛**（Convergence）：过大的输出自动摘要压缩
- **上下文隔离**：每个 Agent 以特定温度（0.0–0.2）在隔离环境中运行

### 批量编排 (`batch-orchestrator.ts`)

- **拓扑排序**：按包间依赖关系确定翻译顺序
- **断点续译**：进度持久化，支持从中断处恢复
- **并行执行**：无依赖关系的包可并行翻译

## 执行模式

通过 `/translate` 命令驱动，支持以下执行模式：

| 模式 | 说明 |
|------|------|
| **完整流程** | 从 inventory 到 verify 的端到端翻译 |
| **指定阶段** | 仅执行特定阶段（如只做 `analyze`） |
| **状态查询** | 查看当前工作流运行状态和进度 |
| **断点续译** | 从上次中断的阶段继续执行 |

## Agent 说明

| Agent | 职责 | 温度 |
|-------|------|------|
| `sql-analyst` | 扫描 PL/SQL 源码，构建依赖图，评估复杂度 (1–10) | 0.0 |
| `sql-parser` | 将 PL/SQL 解析为结构化 IR（语句、变量、例程） | 0.0 |
| `java-architect` | 规划 Java 架构，生成 Spring Boot 项目骨架 | 0.2 |
| `translator` | 执行 IR → Java/MyBatis 的忠实翻译 | 0.0 |
| `java-reviewer` | 9 类审查清单，检查翻译等价性和正确性 | 0.0 |
| `test-generator` | 编译验证、MyBatis XML 校验、测试骨架生成 | 0.0 |
| `debugger` | 诊断工具调用失败、Schema 错误、逻辑问题 | 0.2 |

## 技术栈

- **TypeScript** — 工作流引擎与插件实现
- **Zod** — Artifact Schema 校验
- **@opencode-ai/plugin** — 插件架构
- **Claude AI** — Agent 驱动的代码分析与翻译

## 许可证

私有项目
