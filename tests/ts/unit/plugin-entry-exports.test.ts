/**
 * OpenCode legacy 插件加载器会把插件模块中的每个导出函数都当作插件工厂执行。
 * 入口文件必须保持单一导出；测试辅助函数应放在 plugin-impl 中。
 */
import { describe, expect, it } from "vitest"
import * as pluginEntry from "@plugins/workflow-engine"

describe("OpenCode 插件入口导出约束", () => {
  it("只导出唯一的 WorkflowEnginePlugin 工厂", () => {
    expect(Object.keys(pluginEntry)).toEqual(["WorkflowEnginePlugin"])
    expect(typeof pluginEntry.WorkflowEnginePlugin).toBe("function")
  })
})
