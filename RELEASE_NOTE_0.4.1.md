# Release Note — v0.4.1

> 发布日期：2026-07-16

sql2java-workflow 是基于 AI Agent 的 Oracle PL/SQL → Spring Boot + MyBatis 端到端转译系统。v0.4.1 在 v0.4.0 基础上，围绕 GaussDB 方言语法兼容、scanner 调用图准确性、watchdog 容错监控、分片策略与流程协议收敛等方向迭代，主要发布特性如下。

---

## ✨ 发布特性

1. **GaussDB 方言语法增强**：Oracle grammar 不支持 GaussDB A 兼容模式常见方言，AST 解析报错且错误恢复级联吞掉后续过程声明/调用，致 directCalls 漏抽、闭包不扩展。补三类方言构造：
   - `::` 类型转换（lexer 加 `DOUBLE_COLON`，`atom` 加后缀 cast `atom '::' type_spec`）——结构性致命，错误恢复失控级联吞后续过程声明，regex 兜底救不回（无 body 范围），必须 grammar 治本；
   - `LIMIT` / `LIMIT OFFSET` 分页（`query_block` 加 `limit_clause`，Oracle 用 `FETCH FIRST`）；
   - `GET DIAGNOSTICS var = ROW_COUNT`（`statement` 加 `get_diagnostics_statement`，置 `call_statement` 之前防 `GET` 被当 routine_name 误抽假调用；`DIAGNOSTICS`/`ROW_COUNT` 用 `id_expression` 匹配避免污染关键字表）。
   配套：`parseFileAst` 去掉前 5 条截断、全量打印语法错误 + 末尾汇总总数；parse 前归一化全角语法符号（修复全角引号致 AST 解析失败）；新增 `F_DIALECT` 方言回归基线 + `dialect-syntax` 9 断言门禁；regen 工具 `npx` → `bunx`（环境无 npm/npx）。

2. **scanner 调用图准确性**：caller-schema 锚定解析限定调用——2 段 `pkg.proc` 补 caller schema → `schema.pkg`，修跨包 indirect 边丢失（真实项目「声明带 schema + 调用省 schema」不一致致旧版 directCalls 全空、闭包不扩展）；落盘前 regex 补齐 AST 漏抽的子程序 `bodyLocation`；`stripSqlPlusCommands` 剥离 GRANT 权限语句；`primaryBase` 回落优先 bodyPath 而非 headerPath。

3. **watchdog 容错监控**：worker busy 超时杀 + 重派、编排者 idle 卡死唤醒、session crash 提示手动 resume；ESC 人工终止识别（`session.interrupt` 标记后不干预，信号改用 `session.error(MessageAbortedError)`）；正常完成 worker 不再误 abort（新 worker 登记时清理同 run 旧 idle entry）；worker idle 恢复重置 timer + nudgeCount 按 phase 推进重置；日志改 per-run `logs/watchdog.log`，全局仅兜底；worker subagent 配 `maxSteps` 上限 + `doom_loop: deny` 防 ask 静默挂起。

4. **分片与编排**：subprogram 独立成 unit + 按层 antichain 批量分片（删 `cargo`/`functionOwnership`，修真实项目 ownership 制造合成环致同分片膨胀）；纯常量包跳过 DDD 行为层壳，只出常量持有类。

5. **workflow 协议收敛**：`TASK_STATUS` 协议去 `files` 改 `phase + status`。

6. **docs/resources 对齐**：README 三路径示例入口改用 `ADJUST_STOCK`（有出边根过程，闭包多分片）；MFG_ERP 包补 `GRANT EXECUTE` + `F_INVENTORY` 实现注释移至开头。

---

## 📦 核心文件

- `.opencode/` — workflow 引擎、plsql-ast 生成代码、plsql-file-scanner / worker 池 / watchdog、agent / command / docs 配置
- `AGENTS.md` — Agent 交互规约
- `README.md` — 架构概览、命令用法、设计决策表
- `db.properties.example` — PostgreSQL / GaussDB 数据库配置样例
- `RELEASE_NOTE_0.4.1.md` — 本发布说明
