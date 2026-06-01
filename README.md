# sql2java-workflow

基于 AI Agent 的 Oracle PL/SQL → Spring Boot + MyBatis 端到端转译系统。采用确定性状态机驱动的单流水线工作流，以严格 1:1 忠实转换为原则，将 PL/SQL 代码翻译为可编译的 Java 应用。

## 架构概览

```
/sql2java <path>
  │
  ▼
┌──────────────────────────────────────────────────┐
│  command/sql2java.md                              │
│  参数解析 → 路由分发 → workflow 工具调用            │
└──────────────────┬───────────────────────────────┘
                   │
                   ▼
  inventory → analyze → plan（人工确认）→ scaffold → translate → review → verify → 完成
                                                               │            │
                                                               ↓ (failed)   ↓ (failed)
                                                               fix ←────────┘
                                                               │
                                                               └→ 增量回到触发阶段（review 或 verify）
```

**单流水线**：7 个阶段 + 1 个条件分支阶段（fix），一个 runId，无条件前进 + review/verify 失败时进入 fix 循环（增量重做）。

## 项目结构

```
sql2java-workflow/
├── command/
│   └── sql2java.md                 # /sql2java 命令入口
├── agent/
│   ├── sql-analyst.md              # inventory + analyze 阶段
│   ├── java-architect.md           # plan + scaffold 阶段
│   ├── translator.md               # translate + fix 阶段
│   └── reviewer.md                 # review + verify 阶段
├── workflow/
│   ├── engine-core.ts              # 状态机核心
│   ├── workflow-definitions.ts     # 工作流定义 + TransitionRule
│   ├── artifact-schemas.ts         # Artifact Zod Schemas
│   └── type-mappings.ts            # Oracle → Java 类型映射表
├── plugin/
│   └── workflow-engine.ts          # 插件入口（workflow 工具 + hooks）
└── README.md
```

## Agent 定义

| Agent | Phase | 温度 | 核心职责 |
|-------|-------|------|---------|
| sql-analyst | inventory | 0.1 | 扫描编目（Package、Table、Trigger、View、Sequence） |
| sql-analyst | analyze | 0.1 | 依赖图 + 拓扑排序 + 子程序结构解析 + FSD 生成 |
| java-architect | plan | 0.2 | 架构规划（需人工确认） |
| java-architect | scaffold | 0.2 | 项目骨架 + Entity + Mapper/Service 壳 |
| translator | translate | 0.1 | 按拓扑序逐包翻译，逐包持久化 |
| translator | fix | 0.1 | 修复 mustFix 项，产出 FixArtifact |
| reviewer | review | 0.1 | 10 类审查清单，逐包持久化 |
| reviewer | verify | 0.1 | mvn compile + MyBatis 校验 + 测试骨架生成 |

## 工作流定义

### 阶段配置

| 阶段 | Agent | 最大重试 | 说明 |
|------|-------|---------|------|
| inventory | sql-analyst | 2 | 扫描编目 |
| analyze | sql-analyst | 2 | 依赖分析 + 拓扑排序 + 子程序结构 + FSD |
| plan | java-architect | 1 | 架构规划（需人工确认） |
| scaffold | java-architect | 1 | 项目骨架生成 |
| translate | translator | 3 | 按拓扑序逐包翻译 |
| review | reviewer | 1 | 按包独立审查 |
| verify | reviewer | 2 | 全局编译 + 按包校验 |
| fix | translator | 3 | 修复 mustFix 项 |

### 条件分支

- **无条件前进**：inventory → analyze → plan → scaffold → translate → review → verify → 完成
- **fix 循环**：review/verify failed → fix → 增量回到触发阶段
- **exhausted 策略**：globalMax=3, phaseMax=2, 任一达限 → `completed_with_issues`

## 设计决策

| ID | 决策 | 说明 |
|----|------|------|
| D1 | advance condition | LLM 传入 result，引擎匹配 TransitionRule |
| D2 | fix exhausted | 双层策略：globalMax=3（宽松），phaseMax=2（严格） |
| D3 | fix 增量重做 | fix 后只重审修改过的包 |
| D4 | confirm 时序 | waitingForConfirmation=true 时不激活 agent |
| D5 | artifact 写入 | agent 自己写 artifact，advance 时从磁盘做 Zod 校验 |
| D6 | 持久化 | run.json 全量单文件存储 |
| D7 | fix 动态路由 | 从 branchedFrom 动态取目标阶段 |
| D8 | result 自动推导 | review/verify 阶段引擎从 allPassed 自动推导 result |
| D9 | 跨 Schema 校验 | analyze/plan 完成后校验包名/映射一致性 |
| D10 | SCC 处理 | 循环依赖组归为同层数组，各包保持独立 |
| D11 | prompt 注入 | 只注入当前 Phase section + 通用规则 |
| D12 | FixArtifact 校验 | 包名必须在 inventory 中存在，且覆盖所有失败包 |
| D13 | FSD 生成 | analyze 阶段副产物，逐子程序 Markdown 文档 |

## 命令用法

```
/sql2java <path>                        # 端到端全流程
/sql2java --status                      # 查看工作流状态
/sql2java --resume                      # 断点续传
/sql2java --phases plan,scaffold <path> # 指定阶段执行
```

## Artifact 存储

```
.workflow-artifacts/{runId}/
├── run.json                # WorkflowRun 持久化
├── inventory.json
├── analysis.json
├── plan.json
├── scaffold.json
├── fix.json
├── fsd/{package}/{subprogram}.md
├── translations/{package}/
│   ├── translation.json
│   ├── review.json
│   └── verify.json
├── review-summary.json
├── verify-summary.json
└── _events.log
```

## 技术栈

- **Workflow Engine**：TypeScript 确定性状态机
- **Schema 校验**：Zod
- **Agent 定义**：Markdown（按 `## Phase: xxx` 分节）
- **LLM**：Claude API
- **目标框架**：Spring Boot + MyBatis + Lombok + Maven

## 输入输出

- **输入**：一组 PL/SQL 文件（.sql / .pks / .pkb）
- **输出**：可编译的 Java 项目（Spring Boot + MyBatis + Lombok）+ 转译过程记录（artifacts）
