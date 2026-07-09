# Release Note — v0.4.0

> 发布日期：2026-07-09

sql2java-workflow 是基于 AI Agent 的 Oracle PL/SQL → Spring Boot + MyBatis 端到端转译系统。v0.4.0 在 v0.3.0 基础上，围绕 inventory 静态分析的并行化与健壮性、scanner 包分桶正确性、translator 接入层与流程编排收敛等方向迭代，主要发布特性如下。

---

## ✨ 发布特性

1. **inventory worker 池并行化 + lazy BFS 断传递**：plsql-file-scanner 拆为叶子模块，按包分区交由 bun Worker 池并行 parse；惰性 BFS 引入「const-leaf 包作叶子不传递」断传递策略，上千包收敛为数十，全量与 lazy 双路径并行，串行 fallback 保底，合成 80k 行资源实测 1.76x。

2. **inventory 内存化交接**：移除 `inventory-index.json` 落盘，scan → generateInventory 改经内存 cache 直接交接，避免 LLM 读到全量包源码路径；`buildInventoryFromIndex` 改收内存 index；顺带修复 scan action `mainEntry` latent bug（原读 ctx 顶层恒 undefined → 生产 lazy 从未触发，改读 `ctx.params.mainEntry`）。

3. **scanner 包分桶正确性修复**：`extractPackageNames` 容忍 `EDITIONABLE` literal 与行注释，修复 `bodyLocation=null`；修复引号标识符 `"SCHEMA"."PKG"` 被 regex 截断致 spec/body 分桶错配；`stripSqlPlusCommands` 改为 antlr4 优先，修复 PACKAGE_BODY body 丢失。

4. **scanner 路径与字段收敛**：路径统一改存绝对路径，修正字段名误导与两级目录不一致，修复切片 `sourcePath` bug。

5. **worker 池健壮性**：antlr4ts 硬崩做崩溃隔离，单文件 worker 崩溃不再拖垮整轮 inventory；崩溃 warning 带文件名定位崩点；补全 inventory 扫描 warn/error 日志，可追查 AST 失败 / 降级 / 漏子程序。

6. **translator 接入层与编排收敛**：接入层 `AccessIntf` 改为 Map 入参 / Map 返回；Processor 流程编排薄化——主过程多子流程按原序拆分编排，贴近源码语义。

7. **workflow 回环与日志**：fix 回环上限放宽 5 → 10 轮；`_events.log` 移入 `logs/` 目录。

8. **测试资源对齐实际项目形态**：MFG_ERP 旧资源「声明带 schema / 调用裸名」不一致为错误用例，统一改为「声明带 schema + 调用全名」一致形态，删除冗余 `/` SQL*Plus 执行符；全量 734 测试绿。

---

## 📦 核心文件

- `.opencode/` — workflow 引擎、plsql-ast 生成代码、plsql-file-scanner / worker 池、agent / command / docs 配置
- `AGENTS.md` — Agent 交互规约
- `README.md` — 架构概览、命令用法、设计决策表
- `db.properties.example` — PostgreSQL / GaussDB 数据库配置样例
- `RELEASE_NOTE_0.4.0.md` — 本发布说明
