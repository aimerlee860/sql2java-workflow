# minimum_feature_design.md 设计审查问题清单

审查时间：2026-06-01
审查范围：minimum_feature_design.md 最终版
审查方法：7 角度（line-by-line / 完整性 / 跨section追踪 / 冗余 / 简化 / 效率 / 高度）
修复时间：2026-06-01
状态：✅ 全部已修复

---

## 🔴 Correctness（正确性问题）

### P1: advance 流程 fix 路由伪代码歧义 — 控制流缺陷风险

**位置**: minimum_feature_design.md:333-362（advance 核心流程伪代码）
**发现角度**: Angle A (line-by-line) + Angle C (cross-section)

advance 伪代码步骤 3（fix 处理）和步骤 4（TransitionRule 匹配）是顺序排列的。但 `transitions` 中没有 `from: "fix"` 的规则。如果步骤 3 没有 early-return，步骤 4 会因找不到 TransitionRule 而抛异常。如果步骤 3 fall-through，步骤 4 会用 fix 的 `result: "passed"` 匹配触发阶段的规则（如 `review → verify`），直接跳过增量重审。

**故障场景**: fix 完成后调用 advance，advanceFromFix 正确创建了 review 的新 entry，但代码继续执行到 resolveNextPhase，用 `from=review, condition=passed` 匹配到 `review → verify`，跳过增量 review 直接进入 verify。

**✅ 修复**：advanceFromFix 改为 early-return，不走后续 TransitionRule 匹配。更新至 D7。

---

### P2: `--phases` 跳过逻辑在 plan 阶段死锁

**位置**: minimum_feature_design.md:1093-1109
**发现角度**: Angle C (cross-section)

`--phases scaffold` 需要跳过 inventory → analyze → plan。但 plan 的 `requiresConfirmation: true` 意味着 advance 进入 plan 时返回 `waitingForConfirmation=true` 并暂停。`--phases` 没有自动确认机制，工作流卡死在 plan。

**故障场景**: 用户执行 `/sql2java --phases scaffold /path`，引擎连续 advance 跳过 inventory 和 analyze，到 plan 时暂停。没有自动 confirm，也没有提示用户手动 confirm（因为 `--phases` 语义是"直接执行指定阶段"），工作流永远停在 paused 状态。

**✅ 修复**：`--phases` 连续 advance 遇到 `requiresConfirmation` 阶段自动调用 confirm()。更新至 D4。

---

### P3: SCC 组的"合成名"与 per-package 体系不一致

**位置**: minimum_feature_design.md:123, 569, 863-870
**发现角度**: Angle A (line-by-line) + Angle C (cross-section)

设计决策和 agent 说明中写"合成名如 `pkgA+pkgB`"，但 `AnalysisSchema.translationOrder` 是 `z.array(z.array(z.string()))` — 嵌套数组而非合成字符串。inventory、plan.packageMappings、translations/ 目录结构都基于**单个包名**。没有机制将合成名映射回独立包。

**故障场景**: order_proc 和 order_util 形成 SCC 循环。translationOrder 中出现 `["order_proc", "order_util"]` 或 `"order_proc+order_util"`。plan 的 packageMappings 分别映射 `oraclePackage: "order_proc"` 和 `oraclePackage: "order_util"`。translator 创建 `translations/order_proc+order_util/translation.json`，reviewer 按 `analysis.packages` 查找 `"order_proc+order_util"` 找不到。fix 的 `fixedPackages: ["order_proc+order_util"]` 无法映射到 Java 文件路径。

**✅ 修复**：去掉合成名，SCC 组只在 translationOrder 中体现为同层数组，所有其他地方保持独立包名。新增 D10。

---

### P4: verify 触发的 fix 缺少结构化修复目标

**位置**: minimum_feature_design.md:770-778, 165-169
**发现角度**: Angle C (cross-section)

fix agent 描述说"根据 review/verify 的 mustFix 列表修复"。review.json 有 `mustFix` 数组，但 verify.json 只有 `mybatisValidation` 和 `todoRemainingCount`，没有 `mustFix`。verify 触发 fix 时，agent 的上游 artifact 中没有结构化的"要修什么"列表，只有 `verify-summary.json.compilation.errors` 中的文件/行号/消息。

**故障场景**: verify 阶段 `mvn compile` 失败，报 3 个编译错误。引擎路由到 fix。fix agent 读取 verify-summary.json 获得 `compilation.errors`，但没有 per-package 的 verify.json 告诉它每个包具体有什么问题。agent 必须从编译错误推断修复范围，而编译错误可能跨多个包且行号可能因为之前的编辑而偏移。

**✅ 修复**：verify.json 补上 `mustFix` 字段，verify agent 负责将编译错误归因到 per-package mustFix。

---

## 🟡 Completeness（完整性问题）

### P5: translate 阶段没有 `condition: "failed"` 转换

**位置**: minimum_feature_design.md:469-483
**发现角度**: Angle A (line-by-line)

translate 只有 `{ from: "translate", condition: "always", to: "review" }`。如果 translate agent 调用 `advance(runId, { result: "failed" })`，`resolveNextPhase` 找不到匹配规则会抛异常。虽然设计依赖 retry（maxRetries=3），但 retry 耗尽后走 abort 路径，而非优雅降级。

**故障场景**: translate 阶段一个 PL/SQL 包结构极度异常，agent 3 次 retry 都无法产出有效 translation.json，调用 advance(result: "failed") 引发引擎异常。虽然 retry 耗尽会 abort，但 advance(result: "failed") 路径本身是未定义的。

**✅ 修复**：`condition: "always"` 阶段 advance 忽略 result，失败走 retry/abort。更新至 D1。

---

### P6: validateCrossSchema() 从未被调用

**位置**: minimum_feature_design.md:827-848
**发现角度**: Angle A (line-by-line) + Angle B (completeness)

`validateCrossSchema()` 函数定义完整（校验 inventory ↔ analysis ↔ plan 包名一致性），但在 advance 流程、hook 注册表、生命周期时序中都没有调用点。验证方式中提到要测它，但没说何时触发。

**故障场景**: analysis 阶段因解析错误丢弃了 pkg_c，plan 只映射了 pkg_a 和 pkg_b，translate 只翻译 2 个包。validateCrossSchema 从未被调用，警告从未产生，用户得到"完成"但少了 1/3 的代码。

**✅ 修复**：analyze/plan 完成后调用 validateCrossSchema()，失败记 warning 不阻塞。新增 D9。

---

### P7: FixArtifact.mustFixResolved 是死数据

**位置**: minimum_feature_design.md:818-822
**发现角度**: Angle C (cross-section)

`FixArtifactSchema` 定义了 `mustFixResolved: string[]`，但 advanceFromFix 只消费 `fixedPackages`。review agent 不接收 `mustFixResolved`，引擎也不传递它。这个字段存在但从未被使用。

**故障场景**: fix 修了 5 个 mustFix 中的 3 个，报告 `mustFixResolved: ["issue-1", "issue-3", "issue-5"]`。增量 review 时 review agent 不知道哪些 issue 被声称已解决，只能全量重查。如果 issue-2 和 issue-4 仍在，review 再次 failed，开始新一轮 fix，但 `mustFixResolved` 信息已丢失。

**✅ 修复**：删掉 `mustFixResolved`，fix 契约为"修全部 mustFix，修不完走 retry/failed"。更新至 D3。

---

### P8: review/verify 的 passed/failed 聚合规则未指定

**位置**: minimum_feature_design.md:63-64, 228-231, 306-313
**发现角度**: Angle A (line-by-line)

review 和 verify 产出 per-package 结果，但 advance 接受单个 `result`。D1 说"LLM 显式传入"，但没有指定聚合规则（如"任一包 failed 则 result=failed"）。LLM 可能传 `result: "passed"` 而 `allPassed: false`，引擎无感知。

**故障场景**: 10 个包审查，8 个 passed，2 个有 mustFix。LLM 传 `result: "passed"`（可能因为"大部分通过了"）。引擎匹配 `review → verify`，跳过 fix 阶段。verify 阶段 `mvn compile` 因 2 个包的代码有问题而失败，浪费一轮 verify。

**✅ 修复**：引擎校验 result 与 summary allPassed 一致性，passed 且 allPassed=false 则拒绝 advance。新增 D8。

---

## 🟠 Design（设计层面）

### P9: agent .md 全量注入 + LLM 自过滤 — 不可靠的 phase 分发

**位置**: minimum_feature_design.md:106, 1006-1029
**发现角度**: Angle F (altitude)

system prompt 包含完整 agent .md（所有 phase 分节），LLM 需根据 `currentPhase` 自行选择执行对应 section。当文件较长（100+ 行 × 2 个 phase），LLM 可能执行错误 section 的指令。

**故障场景**: sql-analyst.md 包含 inventory 和 analyze 两个 phase。analyze 阶段时 LLM 看到 inventory 的指令包含"扫描目录"，可能先重复扫描再执行分析，浪费 token 且可能覆盖已有的 inventory.json。plugin 完全可以在注入时只 slice 对应的 `## Phase:` section。

**影响**: 不崩溃但浪费 token，可能导致阶段间数据冲突。

**✅ 修复**：plugin 构建时只 slice 当前 phase section，不注入其他 phase 分节。新增 D11。

---

### P10: fixTracking 与 phaseHistory 冗余 — 双源状态漂移风险

**位置**: minimum_feature_design.md:276-279, 367-374
**发现角度**: Angle D (redundancy) + Angle F (altitude)

`fixTracking.globalCount` 和 `byPhase` 可从 `phaseHistory` 实时计算（过滤 `phase === "fix"` 的 entries 计数），但被持久化为独立字段。两份数据必须手动同步，增加了崩溃/恢复时的不一致风险。

**故障场景**: advance 过程中 phaseHistory 已追加 fix entry，但 fixTracking +1 尚未执行时进程崩溃。恢复后 phaseHistory 有 2 个 fix entries，但 fixTracking.globalCount=1。引擎判定 `globalCount + 1 = 2 <= 3`，允许第 3 次 fix，实际应该是第 4 次（已超限）。

**影响**: fix 循环上限可能失效，多执行一轮 fix。

**✅ 修复**：删掉 fixTracking 独立字段，从 phaseHistory 实时计算 fix 次数。更新至 D2。

---

## 附：审查中未升级为 finding 但值得关注的观察

| 观察 | 说明 |
|------|------|
| run.json + _events.log 双重持久化 | 两者记录同一组状态变迁，events.log 可从 phaseHistory 事后重建 |
| verify-summary.json 的 completedWithIssues 与 WorkflowRun.status 重叠 | artifact 不应承载引擎状态语义 |
| artifact-schemas.ts / type-mappings.ts 的文件拆分可能过早 | MVP 三个文件间隐式耦合，可合并 |
| review.json 的两个 refine 实际检查同一条件 | 复制粘贴，应只保留一个 |
| incrementalContext 可由 agent 自行检查磁盘获得 | 三层传递（FixArtifact → entry → Runtime Context）可简化 |
| DONE_SENTINEL 魔术字符串 | `"__done__"` 可与真实 phase 名冲突，建议用 null 或联合类型 |
| isFixPhase boolean 标志 | 引擎多处 `if (isFixPhase)` 特殊处理，可抽象为通用 loopback 机制 |
