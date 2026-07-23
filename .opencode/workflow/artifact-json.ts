/**
 * Artifact JSON 的统一安全读写入口。
 *
 * Windows PowerShell 5 的 `Set-Content -Encoding UTF8` 会写入 UTF-8 BOM。
 * 原生 `JSON.parse` 不接受开头的 U+FEFF，因此所有工作流 artifact 都必须经此模块解析。
 */

import { readFileSync } from "node:fs"

export interface ParsedArtifactJson<T = unknown> {
  data: T
  hadBom: boolean
}

/** 仅移除文件开头的 UTF-8 BOM，不改动正文中的 U+FEFF。 */
export function stripUtf8Bom(content: string): { content: string; hadBom: boolean } {
  if (content.charCodeAt(0) === 0xFEFF) {
    return { content: content.slice(1), hadBom: true }
  }
  return { content, hadBom: false }
}

/** 解析 artifact JSON，并兼容 PowerShell 产生的 UTF-8 BOM。 */
export function parseArtifactJson<T = unknown>(content: string): ParsedArtifactJson<T> {
  const stripped = stripUtf8Bom(content)
  return {
    data: JSON.parse(stripped.content) as T,
    hadBom: stripped.hadBom,
  }
}

/** 从磁盘读取并解析 artifact JSON。 */
export function readArtifactJson<T = unknown>(filePath: string): ParsedArtifactJson<T> {
  return parseArtifactJson<T>(readFileSync(filePath, "utf-8"))
}

/** 统一使用两空格缩进和结尾换行，Node 写入时不会产生 BOM。 */
export function serializeArtifactJson(data: unknown): string {
  return JSON.stringify(data, null, 2) + "\n"
}
