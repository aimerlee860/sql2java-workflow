# Java 代码规约（DDD 示例主 spec）

> 本文件是 `--spec` 切换架构模型的示例：`@include ./arch-model-ddd.md` 内联 DDD 架构模型段，
> 引擎即按 DDD（Aggregate/Processor/Access、XxxBean、TranFailException、有根包 com.example.mfgerp）产出。
> 用法：`/sql2java --spec .opencode/docs/examples/java-code-spec-ddd.md ...`
>
> 注：下方 7 条路由仍指向默认 4 文件 project-specs 子规约——它们含 4 文件措辞，与 DDD 模型段冲突时
> **以 `## 架构模型` 段为准**（引擎确定性逻辑只读模型段）。完整 DDD 转译建议另写 DDD 版子规约替换路由目标。

@include ./arch-model-ddd.md
@include ./project-specs/skeleton.md -> translate-skeleton
@include ./project-specs/translate-core.md -> translate-core
@include ./project-specs/test-gen.md -> translate-test
@include ./project-specs/static-check.md -> translate-lint
@include ./project-specs/compile.md -> translate-compile
@include ./project-specs/summary.md -> translate-summary
@include ./project-specs/translator.md -> translator

## 适用范围

适用于 PL/SQL 存储过程 → 基于 **DDD 领域驱动分层**（Access/Processor/Aggregate/Builder/Validator）的 Spring Boot + MyBatis 工程翻译场景。规约主体为分层架构与存储过程→Java 组件映射规约；版本与框架配置见末尾【强制】段落。

> **架构决策以 `## 架构模型` 段为唯一事实源**（由 `@include ./arch-model-ddd.md` 内联）。

## 【强制】Java 版本与框架配置（唯一事实来源）

- **Java 版本**: 1.8（JDK 8）
- **Spring Boot 版本**: 2.7.x
- 依赖命名空间: `javax.*`（禁止 `jakarta.*`）
- 其余版本/禁止 API 规则同默认规约，不在此重复。
