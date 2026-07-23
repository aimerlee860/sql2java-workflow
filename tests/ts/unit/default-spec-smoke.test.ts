/**
 * default-spec-smoke.test.ts — 默认 spec 小包引擎层端到端 smoke
 *
 * 合成一个最小包（inventory + table + scaffold.json + impl + source.sql），**不写
 * architecture-model.json**（即走 DEFAULT_ARCHITECTURE_MODEL = 4 文件分层），跑 4 个
 * 确定性 builder 全链路，断言产出与改架构模型前的 4 文件行为完全一致（回归 smoke）。
 *
 * 覆盖：generateDoAndH2Schema（entity/XxxDO + @Data/@TableName）+ buildTestScaffold
 * （service/impl/XxxServiceImplTest + @InjectMocks）+ enumerateTestCases（throws-BusinessException）
 * + buildCoreSegmentBlock（读 service/impl/XxxServiceImpl.java 定位目标段）。
 */

import { describe, it, expect } from "vitest"
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { generateDoAndH2Schema } from "@workflow/do-schema-builder"
import { enumerateTestCases } from "@workflow/test-case-enumerator"
import { buildTestScaffold } from "@workflow/test-scaffold-builder"
import { buildCoreSegmentBlock } from "@plugins/workflow-engine"

function setup(): { artifacts: string; projectRoot: string } {
  const artifacts = mkdtempSync(join(tmpdir(), "smoke-"))
  const projectRoot = mkdtempSync(join(tmpdir(), "proj-"))
  // inventory + table
  writeFileSync(join(artifacts, "inventory.json"), JSON.stringify({
    tableNames: ["T_ORDER"], sequences: [], views: [],
  }))
  mkdirSync(join(artifacts, "tables"), { recursive: true })
  writeFileSync(join(artifacts, "tables", "T_ORDER.json"), JSON.stringify({
    name: "T_ORDER",
    columns: [
      { name: "ID", plsqlType: "NUMBER(18)", nullable: false },
      { name: "AMT", plsqlType: "NUMBER(18,2)" },
      { name: "NAME", plsqlType: "VARCHAR2(40)" },
    ],
    primaryKey: ["ID"],
  }))
  // scaffold procClassNames
  writeFileSync(join(artifacts, "scaffold.json"), JSON.stringify({
    generated: {
      procClassNames: [
        { plsqlSchema: "SCH", plsqlPackage: "PKG", refName: "r_create_order", className: "CreateOrder" },
      ],
    },
  }))
  // source.sql（含 RAISE_APPLICATION_ERROR）
  mkdirSync(join(artifacts, "shard-inputs", "PKG", "r_create_order"), { recursive: true })
  writeFileSync(join(artifacts, "shard-inputs", "PKG", "r_create_order", "source.sql"),
    "IF p_id IS NULL THEN RAISE_APPLICATION_ERROR(-20001, 'id 为空'); END IF;\n")
  // 实现类（含 final 字段 + 段 TODO 标记）
  mkdirSync(join(projectRoot, "src/main/java/service/impl"), { recursive: true })
  writeFileSync(join(projectRoot, "src/main/java/service/impl/CreateOrderServiceImpl.java"),
    `package service.impl;
import mapper.OrderMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
@Slf4j
@RequiredArgsConstructor
public class CreateOrderServiceImpl {
    private final OrderMapper orderMapper;
    public String execute() {
        // TODO:[seg-1] lines 1-10 桩
        ;
        return null;
    }
}
`)
  // 段清单 sidecar
  mkdirSync(join(artifacts, "translations", "PKG"), { recursive: true })
  writeFileSync(join(artifacts, "translations", "PKG", "r_create_order.segments.json"), JSON.stringify({
    segments: [{ segId: "seg-1", plsqlLineRange: [1, 10], summary: "桩", status: "pending" }],
  }))
  return { artifacts, projectRoot }
}

describe("默认 spec 小包 smoke（DEFAULT 架构模型 = 4 文件分层）", () => {
  const { artifacts, projectRoot } = setup()

  it("generateDoAndH2Schema: entity/OrderDO + @Data/@TableName + package entity", () => {
    const manifest = generateDoAndH2Schema(artifacts, projectRoot)
    expect(manifest.entities[0].file).toBe("src/main/java/entity/OrderDO.java")
    const java = readFileSync(join(projectRoot, "src/main/java/entity/OrderDO.java"), "utf-8")
    expect(java).toContain("package entity;")
    expect(java).toContain("@Data")
    expect(java).toContain("@TableName(\"T_ORDER\")")
    expect(java).toContain("public class OrderDO {")
    expect(java).toContain("private Long id;")
    expect(java).toContain("private BigDecimal amt;")
    expect(existsSync(join(projectRoot, "src/test/resources/schema-h2.sql"))).toBe(true)
  })

  it("buildTestScaffold: service/impl/CreateOrderServiceImplTest + @InjectMocks CreateOrderServiceImpl", () => {
    const rel = buildTestScaffold(projectRoot, artifacts, "PKG", "r_create_order")!
    expect(rel).toBe("src/test/java/service/impl/CreateOrderServiceImplTest.java")
    const test = readFileSync(join(projectRoot, rel), "utf-8")
    expect(test).toContain("package service.impl;")
    expect(test).toContain("class CreateOrderServiceImplTest {")
    expect(test).toContain("@InjectMocks private CreateOrderServiceImpl service;")
    expect(test).toContain("@Mock private OrderMapper orderMapper;")
    expect(test).toContain("import service.impl.CreateOrderServiceImpl;")
    expect(test).toContain("// @TEST_METHODS_HERE")
  })

  it("enumerateTestCases: RAISE_APPLICATION_ERROR → throws-BusinessException", () => {
    const cases = enumerateTestCases(artifacts, "PKG", "r_create_order")!
    const neg = cases.find(c => c.type === "negative")!
    expect(neg).toBeTruthy()
    expect(neg.expectKind).toBe("throws-BusinessException:-20001")
  })

  it("buildCoreSegmentBlock: 读 service/impl/CreateOrderServiceImpl.java 定位 seg-1 目标段", () => {
    const block = buildCoreSegmentBlock(artifacts, projectRoot, "PKG", "r_create_order")
    expect(block).toContain("本派发目标段")
    expect(block).toContain("seg-1")
  })
})
