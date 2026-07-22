/**
 * OpenCode 插件薄入口。
 *
 * OpenCode legacy 加载器会执行插件模块中的每一个导出函数，因此本文件必须只导出
 * 一个插件工厂。可测试的辅助函数统一保留在 plugin-impl/workflow-engine.ts。
 */
export { WorkflowEnginePlugin } from "../plugin-impl/workflow-engine"
