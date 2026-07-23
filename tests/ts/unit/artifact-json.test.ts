import { describe, expect, it } from "vitest"
import { parseArtifactJson, serializeArtifactJson, stripUtf8Bom } from "@workflow/artifact-json"

describe("artifact JSON 安全读写", () => {
  it("兼容 PowerShell 写入的 UTF-8 BOM", () => {
    const parsed = parseArtifactJson<{ value: number }>("\uFEFF{\"value\":1}")
    expect(parsed).toEqual({ data: { value: 1 }, hadBom: true })
  })

  it("只移除开头 BOM，不改正文中的 U+FEFF", () => {
    const result = stripUtf8Bom("\uFEFFa\uFEFFb")
    expect(result).toEqual({ content: "a\uFEFFb", hadBom: true })
  })

  it("统一序列化为无 BOM、两空格缩进和结尾换行", () => {
    const output = serializeArtifactJson({ value: 1 })
    expect(output.charCodeAt(0)).not.toBe(0xFEFF)
    expect(output).toBe('{\n  "value": 1\n}\n')
  })
})
