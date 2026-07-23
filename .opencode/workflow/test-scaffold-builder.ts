/**
 * test-scaffold-builder — test-gen 确定性前置工具（零 LLM）
 *
 * test-gen sub-stage 派发前由 engine inline 调用（仿 generateDoAndH2Schema 先例）。读已落盘的
 * `{ClassName}ServiceImpl.java`（core 阶段已完成），解析其 Lombok @RequiredArgsConstructor 的 final
 * 字段（= 构造器注入依赖：own Mapper + 跨包 Service），确定性生成 Mockito 测试壳：
 *   - @ExtendWith(MockitoExtension.class) + @MockitoSettings(LENIENT)
 *   - 每个 final 字段一个 @Mock + @InjectMocks service
 *   - `// @TEST_METHODS_HERE` 标记位（test-gen slave 只替换此标记为 @Test 方法体，不重写整文件）
 *
 * 把测试样板移出 LLM 上下文——slave 单次调用只产 @Test 方法体。设计见 plan: cuddly-gliding-peach。
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { getLogger } from "./workflow-logger"
import { safeWriteFile } from "./cross-platform"

/** 读 JSON 文件（不存在/解析失败返回 null）。镜像 workflow-engine.readJsonOrNull，保持自包含。 */
function readJsonOrNull(path: string): any {
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, "utf-8")) } catch { return null }
}

/** 过程名 → PascalCase（下划线分段首字母大写）。镜像 workflow-engine.procNameToPascal fallback。 */
function procNameToPascal(name: string): string {
  return name.toLowerCase().split(/[_\s]+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("")
}

/** 从 scaffold.json.generated.procClassNames 查 className（跨包去重后基名）。镜像 resolveUnitClassName。 */
function resolveUnitClassName(artifactsDir: string, pkg: string, ref: string): string {
  const scaffold = readJsonOrNull(join(artifactsDir, "scaffold.json"))
  const arr = scaffold?.generated?.procClassNames
  if (Array.isArray(arr)) {
    const pkgU = pkg.toUpperCase()
    const refU = ref.toUpperCase()
    for (const pc of arr) {
      if (String(pc?.plsqlPackage ?? "").toUpperCase() === pkgU && String(pc?.refName ?? "").toUpperCase() === refU) {
        return String(pc.className ?? procNameToPascal(ref))
      }
    }
  }
  return procNameToPascal(ref)
}

interface DepField { typeSimple: string; name: string; importLine: string | null }

/** 解析 ServiceImpl 的 final 字段（构造器注入依赖）+ 对应 import。 */
function parseDeps(implSrc: string): DepField[] {
  // import 映射：simpleName → 完整 import 语句（含 static）
  const importMap = new Map<string, string>()
  const importRe = /^import\s+(static\s+)?([\w.]+);/gm
  let im: RegExpExecArray | null
  while ((im = importRe.exec(implSrc)) !== null) {
    const full = im[2]
    const simple = full.split(".").pop()!
    if (!importMap.has(simple)) importMap.set(simple, `import ${im[1] ? "static " : ""}${full};`)
  }
  // final 字段（@RequiredArgsConstructor 注入点）：[private] final Type name;
  const deps: DepField[] = []
  const fieldRe = /(?:private\s+|protected\s+|public\s+)?final\s+([\w.]+)\s+(\w+)\s*;/g
  let fm: RegExpExecArray | null
  while ((fm = fieldRe.exec(implSrc)) !== null) {
    const typeFull = fm[1]
    const typeSimple = typeFull.split(".").pop()!
    // 排除常见非依赖 final（如 Logger slf4j）——这些不需要 @Mock
    if (/logger/i.test(typeSimple)) continue
    deps.push({ typeSimple, name: fm[2], importLine: importMap.get(typeSimple) ?? null })
  }
  return deps
}

/**
 * 生成并落盘 {ClassName}ServiceImplTest.java 壳。返回写入的 projectRoot 相对路径；
 * ServiceImpl 未落盘返回 null（调用方回退：test-gen 自行创建测试文件）。
 */
export function buildTestScaffold(projectRoot: string, artifactsDir: string, pkg: string, ref: string): string | null {
  const log = getLogger()
  const className = resolveUnitClassName(artifactsDir, pkg, ref)
  const implRel = `src/main/java/service/impl/${className}ServiceImpl.java`
  const implPath = join(projectRoot, implRel)
  if (!existsSync(implPath)) {
    log?.warn(`test-scaffold-builder: ServiceImpl 未落盘 ${implRel}，跳过壳生成（test-gen 自行创建）`)
    return null
  }
  const implSrc = readFileSync(implPath, "utf-8")
  const deps = parseDeps(implSrc)

  // 幂等守卫：测试文件已存在且 @TEST_METHODS_HERE 标记已消失 = slave 已填充，不得覆盖。
  // 仅当文件不存在或仍含标记（未填充）时才（重新）生成壳。避免 resume/重渲 clobber 已填测试。
  const testAbs = join(projectRoot, `src/test/java/service/impl/${className}ServiceImplTest.java`)
  if (existsSync(testAbs)) {
    const existing = readFileSync(testAbs, "utf-8")
    if (!existing.includes("// @TEST_METHODS_HERE")) {
      return `src/test/java/service/impl/${className}ServiceImplTest.java`
    }
  }

  // 收集需要的 import（依赖类型 + ServiceImpl 自身）
  const imports = new Set<string>([
    "import org.junit.jupiter.api.Test;",
    "import org.junit.jupiter.api.extension.ExtendWith;",
    "import org.mockito.InjectMocks;",
    "import org.mockito.Mock;",
    "import org.mockito.junit.jupiter.MockitoExtension;",
    "import org.mockito.junit.jupiter.MockitoSettings;",
    "import org.mockito.quality.Strictness;",
    "import static org.mockito.Mockito.*;",
    "import static org.junit.jupiter.api.Assertions.*;",
    `import service.impl.${className}ServiceImpl;`,
  ])
  const missingTypes: string[] = []
  for (const d of deps) {
    if (d.importLine) imports.add(d.importLine)
    else missingTypes.push(d.typeSimple)
  }

  const lines: string[] = []
  lines.push("package service.impl;")
  lines.push("")
  for (const i of imports) lines.push(i)
  if (missingTypes.length) {
    lines.push(`// TODO: 补 import（ServiceImpl 未显式 import 的依赖类型）: ${missingTypes.join(", ")}`)
  }
  lines.push("")
  lines.push("@ExtendWith(MockitoExtension.class)")
  lines.push("@MockitoSettings(strictness = Strictness.LENIENT)")
  lines.push(`class ${className}ServiceImplTest {`)
  for (const d of deps) {
    lines.push(`    @Mock private ${d.typeSimple} ${d.name};`)
  }
  lines.push("")
  lines.push(`    @InjectMocks private ${className}ServiceImpl service;`)
  lines.push("")
  lines.push("    // @TEST_METHODS_HERE  ← test-gen slave 把本标记替换为 @Test 方法体，勿重写整文件")
  lines.push("}")
  lines.push("")

  const testRel = `src/test/java/service/impl/${className}ServiceImplTest.java`
  safeWriteFile(join(projectRoot, testRel), lines.join("\n"))
  return testRel
}
