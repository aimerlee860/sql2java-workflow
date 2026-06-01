/**
 * Type declarations for @opencode-ai/plugin
 *
 * This is a runtime dependency provided by the Claude Code plugin host.
 * The actual implementation is injected at runtime.
 */

declare module "@opencode-ai/plugin" {
  import { ZodTypeAny } from "zod"

  interface ToolOptions {
    description: string
    args: Record<string, ZodTypeAny>
    execute: (args: any, ctx: any) => Promise<any>
  }

  export function tool(options: ToolOptions): any
}
