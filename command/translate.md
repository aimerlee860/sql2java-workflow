---
description: "Oracle PL/SQL → Spring Boot + MyBatis 翻译工作流。支持端到端全流程、指定阶段执行、状态查询和断点续传。"
permission:
  tool: allow
  bash: allow
---

# /translate — SQL 翻译工作流

你是 Oracle PL/SQL → Spring Boot + MyBatis 翻译工作流的执行引擎。
使用 `workflow` 工具驱动多阶段状态机，按阶段调用不同 Agent。

## 参数解析

解析 `$ARGUMENTS`，按以下规则路由：

### 语法

```
/translate <phases> <path-or-package>
```

- `<phases>`: 可选。逗号分隔的阶段名，或模式关键字
- `<path-or-package>`: 源码目录路径 或 Oracle Package 名

### 已知阶段名

Level 1（项目级）: `inventory`, `analyze`, `plan`, `scaffold`
Level 2（翻译级）: `parse`, `translate`, `review`, `verify`, `fix`

### 模式关键字

- `status` — 查询工作流状态
- `resume` — 断点续传

### 路由规则（按顺序匹配）

1. **`status`** → 显示所有运行状态
   ```
   /translate status
   ```

2. **`resume`** → 读取进度文件，继续未完成的翻译
   ```
   /translate resume
   ```

3. **指定阶段 + 路径** → 只执行指定阶段（跳过其他阶段）
   ```
   /translate scaffold /path/to/sql
   /translate scaffold,parse /path/to/sql
   /translate parse,translate,review PKG_ORDER
   ```

4. **纯路径或 Package 名** → 端到端全流程
   ```
   /translate /path/to/sql          # 完整 Level 1 + Level 2
   /translate PKG_ORDER             # 完整 Level 2（需 Level 1 已完成）
   ```

### 判断路径 vs Package 名

- 包含 `/` 或 `.` 且指向存在的目录 → 源码路径 → 启动 Level 1
- 否则 → Package 名 → 启动 Level 2

## 可用 Agent

| Agent | 阶段 | 职责 |
|-------|------|------|
| sql-analyst | inventory, analyze | 扫描源码、编目、依赖分析 |
| sql-parser | parse | PL/SQL → 结构化 IR |
| java-architect | plan, scaffold | 架构规划、骨架生成 |
| translator | translate, fix | IR → Java/MyBatis 代码 |
| java-reviewer | review | 翻译质量审查 |
| test-generator | verify | 编译检查、测试生成 |

## 执行模式

### 端到端全流程（无阶段指定 + 路径）

1. 启动 Level 1: `workflow start (definition=projectWorkflow)`
2. 依次执行 inventory → analyze → plan → scaffold
3. plan 阶段完成后暂停等待人工确认
4. Level 1 完成后，读取 translation-plan.json
5. 按拓扑序逐个 Package 启动 Level 2: `workflow start (definition=translationWorkflow)`
6. 每个 Package: parse → translate → review → verify（失败则 fix 循环）

### 端到端全流程（无阶段指定 + Package 名）

1. 读取 translation-plan.json 获取该 Package 的映射信息
2. 启动 Level 2: `workflow start (definition=translationWorkflow)`
3. parse → translate → review → verify

### 指定阶段执行

只执行指定的阶段，跳过其他阶段。

**单阶段执行**（如 `/translate scaffold /path/to/sql`）：
1. 检查上游产物是否存在（如 scaffold 需要 plan 产物）
2. 如果上游产物缺失，提示用户先执行上游阶段，然后停止
3. 如果上游产物存在，只执行当前阶段
4. 完成后 `workflow advance` 并结束，不执行后续阶段

**多阶段执行**（如 `/translate scaffold,parse PKG_ORDER`）：
1. 按顺序检查每个阶段的依赖
2. 如果跨 Level（如 scaffold 是 Level 1, parse 是 Level 2），先完成 Level 1 阶段再进入 Level 2
3. 只执行指定的阶段，跳过中间阶段时读取已有产物

**阶段依赖关系**：
```
Level 1: inventory → analyze → plan → scaffold
Level 2: parse → translate → review → verify
                                ↑  fix  ←┘
```

执行指定阶段时，需要的前置产物：
| 阶段 | 需要的前置产物 |
|------|--------------|
| inventory | 无（需要源码路径） |
| analyze | inventory.json |
| plan | inventory.json + analysis.json |
| scaffold | translation-plan.json |
| parse | PL/SQL 源文件 |
| translate | parsed.json (IR) + translation-plan.json |
| review | 翻译产物（Mapper/Service 文件） |
| verify | review-report.json + 翻译产物 |
| fix | review-report.json 或 verify-report.json + 翻译产物 |

### status 模式

调用 `workflow list` 和 `workflow-metrics` 显示所有运行状态和翻译进度。

### resume 模式

读取 `.workflow-artifacts/_progress.json`，找到未完成的 Package，继续执行。

## 每个阶段的执行规范

1. **阶段开始前**：读取上游产物，注入为上下文
2. **阶段执行中**：调用对应 Agent 完成任务
3. **阶段完成后**：必须 `workflow advance(artifact=<本阶段产物>)`，产物写入 `.workflow-artifacts/`
4. **文件写入**：所有生成的 Java 文件必须用 write 工具写入磁盘，不能只输出在回复中
