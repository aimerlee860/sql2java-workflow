# Release Note — v0.2.0

> 发布日期：2026-06-30

sql2java-workflow 是基于 AI Agent 的 Oracle PL/SQL → Spring Boot + MyBatis 端到端转译系统。v0.2.0 在 v0.1.0 基础上，围绕过程级翻译、确定性静态分析、per-unit 硬隔离、DDD 规约、源端兼容性等方向迭代，主要发布特性如下。

---

## ✨ 发布特性

1. **过程级入口闭包翻译**：`mainEntry` 升级为过程级形态（`subdir/PKG.refName`），指定入口时仅翻译入口及其调用闭包；通过 callGraph + 包依赖 BFS 计算闭包 scope，未指定入口则全量翻译；同包 bare-name 调用自动补边，坏入口硬失败。

2. **translate / analyze 下沉到 PROCEDURE 级**：翻译与分析单元从「目录→包」细化为「目录→包→PROCEDURE」三层，PROCEDURE 为独立单元、FUNCTION 跟随属主；per-unit 产物 + engine merge 聚合，上下文更聚焦、单次生成质量更高。

3. **per-unit 硬隔离 + 分片 dispatch**：以「切片预生成 + 写入边界校验 + 依赖预注入」三道硬隔离替换软约束提示，根治分片模式下 worker 跨包写、源码路径泄漏、resume 越界整包等问题；引擎按拓扑层切分包，每分片独立 Worker session。

4. **dedup 静态分析重构**：去重阶段拆为 PMD CPD 确定性扫描（零 LLM）+ LLM 按组抽取两步；锁定 JDK 8 + Maven 3.5 工具链基线并做版本校验，mvn 不可用时优雅跳过并通过 dispatch 即时告警；`dedup-rules.json` 支持 exclude/force/forceExtract 闭环。

5. **review 静态重构 + previousFindings 回环**：review 拆为 Step A 工具扫描（零 LLM）+ Step B LLM 语义聚焦，静态 finding 走独立通道进 fix；增量回环注入 previousFindings 机制化核对旧问题，避免重复报告；分片 translations glob 收窄到本分片包。

6. **DDD 规约全链路替换**：用正式 DDD 规约替换通用 java-code-spec，覆盖规约 / schema / 4 个 agent / 测试全链路；包根项目特定路径不写死 `com.icbc.fmhm`，规约异常条款去重。

7. **standalone 虚拟包接入流水线**：standalone 存储过程自动注入 `__STANDALONE_*__` 虚拟包接进翻译流水线；scanner 修复 inventory 拆解存储过程的 4 类代码遗漏，并支持 spec+body 合并包文件（body 先 regex+偏移、spec 后 AST 切分）。

8. **源端兼容 PostgreSQL / GaussDB**：schema-fetcher 由 Oracle 路径切换为 PostgreSQL/GaussDB；完成 GaussDB（Oracle 兼容）源端 vs plsql-scanner 兼容性评估，scanner AST 不可用时降级 regex 兜底。

9. **权威进度查询与防 confabulate**：新增 progress action（工具方案），编排者按需查询权威进度；dispatch/advance 输出注入进度摘要，防止编排者凭空捏造进度。

10. **自然语言参数解析与运行上下文**：`/sql2java` 支持自然语言参数解析，核心参数落 `run-context.json`；runId 加项目 basename 区分多次运行；`analysis.json` 全链路改名为 `dependency-graph.json`。

11. **plan 精简与 scope 越界校验**：精简 plan 上游、清理死字段，新增 scope 越界校验；`--phases` 前置校验改调 prerequisites action，并禁止主 agent 执行文件列举类命令。

12. **测试与工程化**：新增 `test` / `test:watch` script 统一用 bun 驱动 vitest；vitest 升级 ^3.2.0 → ^3.2.6；同步 standalone 虚拟包与 review 分片收窄的单测期望。

---
