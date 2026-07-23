/**
 * test-scaffold-parse-deps.test.ts — parseDeps 依赖抽取边界
 *
 * 验证 buildTestScaffold 的依赖字段抽取：
 *   - 构造器 final 字段（4 文件 @RequiredArgsConstructor）收为 @Mock
 *   - @Autowired 字段（DDD 字段注入）收为 @Mock
 *   - 方法内裸 `final Type foo;` 局部变量**不**收（避免 @Mock 注解局部/无效 Java）
 *   - Logger 字段排除
 */

import { describe, it, expect } from "vitest"
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { buildTestScaffold } from "@workflow/test-scaffold-builder"

// 默认 4 文件模型（无 architecture-model.json → DEFAULT）
describe("parseDeps — 依赖抽取边界", () => {
  it("收 final 字段 + @Autowired 字段，排除方法内 final 局部 + Logger", () => {
    const artifacts = mkdtempSync(join(tmpdir(), "pd-"))
    writeFileSync(join(artifacts, "scaffold.json"), JSON.stringify({
      generated: { procClassNames: [{ plsqlSchema: "SCH", plsqlPackage: "PKG", refName: "r_x", className: "X" }] },
    }))
    const projectRoot = mkdtempSync(join(tmpdir(), "proj-"))
    mkdirSync(join(projectRoot, "src/main/java/service/impl"), { recursive: true })
    writeFileSync(join(projectRoot, "src/main/java/service/impl/XServiceImpl.java"),
      `package service.impl;
import mapper.XMapper;
import org.springframework.beans.factory.annotation.Autowired;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
@Slf4j
@RequiredArgsConstructor
public class XServiceImpl {
    private final XMapper xMapper;          // 构造器注入 → 收
    @Autowired private OtherService svc;    // 字段注入 → 收
    public void execute() {
        final String localFlag = "x";        // 方法内 final 局部（有初始化，正则不匹配）
        final Long counter;                  // 方法内裸 final 局部（无初始化）→ 不应收
        counter = 1L;
    }
}
`)
    const rel = buildTestScaffold(projectRoot, artifacts, "PKG", "r_x")!
    const test = readFileSync(join(projectRoot, rel), "utf-8")
    expect(test).toContain("@Mock private XMapper xMapper;")
    // @Autowired 字段被收（import 缺失会进 TODO，但 @Mock 行仍生成）
    expect(test).toMatch(/@Mock private OtherService svc;/)
    // 方法内裸 final 局部 counter 不应被收为 @Mock
    expect(test).not.toContain("@Mock private Long counter;")
    expect(test).not.toContain("localFlag")
  })
})
