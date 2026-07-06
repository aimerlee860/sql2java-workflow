# Release Note — v0.3.0

> 发布日期：2026-07-06

sql2java-workflow 是基于 AI Agent 的 Oracle PL/SQL → Spring Boot + MyBatis 端到端转译系统。v0.3.0 在 v0.2.0 基础上，围绕 inventory 确定性静态分析重设计、scaffold 产物目录稳定化、verify 覆盖率门禁等方向迭代，主要发布特性如下。

---

## ✨ 发布特性

1. **inventory 静态分析重设计**：引入 antlr4ts + 官方 PL/SQL grammar，listener AST scanner 取代旧 regex / ts-plsql-parser；新形状 `packages/{pkg}.json` + `subprograms/*.json`，依赖图改由引擎按需推导不再落盘；下游 agent / workflow 全链路迁移到新形状。

2. **入口闭包惰性解析**：inventory 第 0 步改为惰性 BFS，仅按 callGraph + packageDependency 闭包 scope 按需解析相关包，大项目避免全量 antlr parse。

3. **scaffold projectRoot 稳定化**：`projectRoot` 持久化到 `metadata.generatedRoot`，全部站点统一读取消除 flip-flop；去掉 fallback 设计，跨 run 撞同一 `generated/<artifactId>/` 时自动换目录防旧产物堆积。

4. **verify 覆盖率门禁**：pom.xml 强制配置 JaCoCo，verify 阶段读 `jacoco.xml` 做覆盖率门控并回流 fix；门控排除 beans / Application 等非业务类。

5. **三路径源码模式**：scanner 支持 `sourcePath` + `headerPath` + `bodyPath` 三路径同时生效。

6. **依赖与工程化瘦身**：清理废弃依赖 oracledb / ts-plsql-parser，`regen.sh` → `regen.mjs`（纯 node 跨平台），新增 FMBM 规约测试用例，全量 713 测试绿。

---

## 📦 核心文件

- `.opencode/` — workflow 引擎、plsql-ast 生成代码、agent / command / docs 配置
- `AGENTS.md` — Agent 交互规约
- `README.md` — 架构概览、命令用法、设计决策表
- `db.properties.example` — PostgreSQL / GaussDB 数据库配置样例
- `RELEASE_NOTE_0.3.0.md` — 本发布说明
