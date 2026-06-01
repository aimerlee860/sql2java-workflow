---
description: Oracle PL/SQL → Spring Boot + MyBatis 端到端转译命令。支持全流程、断点续传、指定阶段执行和状态查看。
---

# /sql2java 命令

Oracle PL/SQL → Spring Boot + MyBatis 端到端转译工作流入口。

## 用法

```
/sql2java <path>                        # 端到端全流程
/sql2java --status                      # 查看工作流状态
/sql2java --resume                      # 断点续传
/sql2java --phases plan,scaffold <path> # 指定阶段执行
```

## 路由逻辑

请根据用户参数选择对应分支执行：

---

### 分支 1：--status

1. 调用 `workflow({ action: "list" })` 获取所有运行记录
2. 展示最近一次 run 的状态：
   - runId、status、currentPhase
   - phaseHistory 摘要（每个阶段的 status、retryCount）
3. 结束

---

### 分支 2：--resume（断点续传）

1. 调用 `workflow({ action: "list" })` 找到最近的 run
2. 如果没有 run，提示用户先用 `/sql2java <path>` 启动
3. 调用 `workflow({ action: "status", runId })` 获取完整状态
4. 根据 `run.status` 决定行为：

| 状态 | 行为 |
|------|------|
| `completed` | 输出 "Already completed"，结束 |
| `completed_with_issues` | 输出未解决问题，结束 |
| `paused`（plan 等待确认） | 提示用户调用 `workflow({ action: "confirm", runId })`，结束 |
| `running` + 最后 entry 是 `in_progress` | 中断恢复：利用已有 per-package artifact 跳过 |
| `aborted` | 确认后恢复，同上 |

5. 中断恢复策略：
   - **translate**：检查 `${artifactsDir}/translations/*/translation.json`，跳过 `status: "completed"` 的包
   - **review / verify**：检查已有的 per-package artifact，跳过已完成包
   - **其他阶段**：直接重新执行

---

### 分支 3：--phases

1. 解析阶段名列表（如 `plan,scaffold`），校验：
   - 阶段名合法（在 sql2java 工作流定义中存在）
   - 按工作流顺序排列
2. 校验前置依赖 artifact 存在：

| 目标阶段 | 必须存在的 artifact |
|---------|-------------------|
| analyze | inventory.json |
| plan | inventory.json + analysis.json |
| scaffold | plan.json + inventory.json |
| translate | inventory.json + analysis.json + plan.json + scaffold.json |
| review | plan.json + scaffold.json + analysis.json |
| verify | plan.json + scaffold.json |
| fix | analysis.json + plan.json + scaffold.json |

3. 缺少前置 → 报错退出，提示先运行前面的阶段
4. 启动工作流：
   ```
   workflow({ action: "start", runId: "run-{YYYYMMDD-HHmmss}", metadata: { sourcePath: "<path>" } })
   ```
5. 连续 advance 跳过前面的阶段（不需要 artifact，引擎直接推进）
6. 遇到 `requiresConfirmation: true` 的阶段自动调用 `confirm()`（`--phases` 语义等价于用户隐式确认）
7. 激活第一个指定阶段

---

### 分支 4：默认全流程

1. 校验 `<path>` 存在且包含 `.sql` / `.pks` / `.pkb` 文件
2. 生成 runId：`run-{YYYYMMDD-HHmmss}`（如 `run-20260601-143025`）
3. 创建 artifacts 目录：`.workflow-artifacts/{runId}/`
4. 启动工作流：
   ```
   workflow({
     action: "start",
     runId: "run-{YYYYMMDD-HHmmss}",
     metadata: { sourcePath: "<path>" }
   })
   ```
5. 输出启动信息（runId、初始阶段、agent）
6. 后续由 agent + workflow 工具自动推进

---

## 输出格式

### 启动成功

```
✓ Workflow started
  Run ID: run-20260601-143025
  Phase: inventory
  Agent: sql-analyst.md
  Artifacts: .workflow-artifacts/run-20260601-143025/
```

### 状态查询

```
Run: run-20260601-143025
Status: running
Current Phase: translate
Progress:
  ✓ inventory (completed)
  ✓ analyze (completed)
  ✓ plan (confirmed → completed)
  ✓ scaffold (completed)
  → translate (in_progress, retry: 0)
    - completed: PKG_UTILS, PKG_DICT
    - remaining: PKG_ORDER, PKG_INVENTORY
```

### 完成状态

```
Run: run-20260601-143025
Status: completed
Total phases: 7
Duration: 12m 34s
```
