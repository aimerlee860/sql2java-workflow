/**
 * architecture-model — 架构模型（架构决策唯一事实源）
 *
 * 默认「4 文件分层 / 无根包」与 DDD 等自定义架构只是 ArchitectureModel 的不同实例。
 * spec 主规约 `@include ./arch-model.md` 内联 `## 架构模型` 段后，引擎解析成此对象，
 * 供确定性 builder（do-schema/test-scaffold/verify/test-case-enumerator/review-focus/
 * buildCoreSegmentBlock）消费，取代散落各处的硬编码路径/后缀/注解/异常类。
 *
 * 设计见方案 C（[[cozy-meandering-elephant]] plan）：spec 驱动、缺失回退默认、不阻断 run。
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { getLogger } from "./workflow-logger"

// ── 类型 ─────────────────────────────────────────────────────────────────────

/** per-proc 角色规格：每个过程按角色生成一类，落对应顶层包 */
export interface RoleSpec {
  role: string                 // 角色键，如 service / service-impl / mapper / processor
  suffix: string               // 类名后缀，如 Service / ServiceImpl / Mapper
  package: string              // Java package（无根包下=顶层包段，如 service.impl）
  dir: string                  // 源文件目录（相对 projectRoot），如 src/main/java/service/impl
  testDir?: string             // 测试文件目录，如 src/test/java/service/impl
  testSuffix?: string          // 测试类后缀，如 ServiceImplTest
  xmlDir?: string              // Mapper XML 目录，如 src/main/resources/mapper
  implRole?: boolean           // 标记为实现层角色（test-scaffold / buildCoreSegmentBlock 目标）
}

export interface PackageArtifactSpec {
  suffix: string               // 类名后缀，如 Constant / StateDTO
  dir: string                  // 目录，如 src/main/java/constant
}

export interface EntitySpec {
  suffix: string               // 实体后缀，如 DO / Bean
  dir: string                  // 目录，如 src/main/java/entity
  package: string              // Java package，如 entity
  annotations: string[]        // 类注解，如 ["@Data", "@TableName(\"{table}\")"]；{table} 占位
  imports: string[]            // 注解 import，如 ["lombok.Data", "com.baomidou...TableName"]
}

export interface ExceptionSpec {
  baseClass: string            // 业务异常基类，如 BusinessException / TranFailException
  package: string              // 异常类 package，如 exception
  subclasses: string[]         // 子类，如 [DataNotFoundException, ValidationException]
}

/** 架构模型（解析自 spec `## 架构模型` 段，或代码内置默认） */
export interface ArchitectureModel {
  layout: string               // flat-no-root | rooted-module
  packageBase?: string         // 有根包时填，如 com.example.mfgerp；无根包 undefined
  roles: RoleSpec[]
  packageArtifacts: {
    constant: PackageArtifactSpec
    stateDto: PackageArtifactSpec
  }
  entity: EntitySpec
  exception: ExceptionSpec
  crossPackageCall: { fqnPattern: string }  // 跨包调用 FQN 模板，如 service.{className}Service
  coverageExcludes: string[]   // 覆盖率排除路径子串，如 ["entity/", "exception/"]
  scanBasePackages: string[]   // @SpringBootApplication scanBasePackages 列表
}

// ── 默认模型（= 当前 4 文件分层行为，向后兼容）─────────────────────────────

export const DEFAULT_ARCHITECTURE_MODEL: ArchitectureModel = {
  layout: "flat-no-root",
  roles: [
    { role: "service", suffix: "Service", package: "service", dir: "src/main/java/service" },
    {
      role: "service-impl", suffix: "ServiceImpl", package: "service.impl",
      dir: "src/main/java/service/impl", testDir: "src/test/java/service/impl",
      testSuffix: "ServiceImplTest", implRole: true,
    },
    { role: "mapper", suffix: "Mapper", package: "mapper", dir: "src/main/java/mapper", xmlDir: "src/main/resources/mapper" },
    // 条件角色：仅 >1 入参/出参时 skeleton 生成 {className}Request/{className}Response（@Data 数据类，无 impl/test）
    { role: "request", suffix: "Request", package: "service.dto.request", dir: "src/main/java/service/dto/request" },
    { role: "response", suffix: "Response", package: "service.dto.response", dir: "src/main/java/service/dto/response" },
  ],
  packageArtifacts: {
    constant: { suffix: "Constant", dir: "src/main/java/constant" },
    stateDto: { suffix: "StateDTO", dir: "src/main/java/dto" },
  },
  entity: {
    suffix: "DO", dir: "src/main/java/entity", package: "entity",
    annotations: ["@Data", "@TableName(\"{table}\")"],
    imports: ["lombok.Data", "com.baomidou.mybatisplus.annotation.TableName"],
  },
  exception: {
    baseClass: "BusinessException", package: "exception",
    subclasses: ["DataNotFoundException", "ValidationException"],
  },
  crossPackageCall: { fqnPattern: "service.{className}Service" },
  coverageExcludes: ["config/", "entity/", "exception/", "util/", "constant/", "dto/", "service/dto/"],
  scanBasePackages: ["config", "service", "service.impl", "mapper", "constant", "dto", "entity", "exception", "util"],
}

// ── 解析器 ───────────────────────────────────────────────────────────────────

/** 剥 HTML 注释与首尾空白；空串视为无值 */
function stripComment(s: string): string {
  return s.replace(/<!--.*?-->/g, "").trim()
}

/** 按 `### 子节` 切分章节正文，返回 Map<子节标题, 正文> */
function splitSubSections(body: string): Map<string, string> {
  const out = new Map<string, string>()
  const lines = body.split("\n")
  let cur = ""
  let buf: string[] = []
  const flush = () => { if (cur) out.set(cur, buf.join("\n").trim()); buf = [] }
  for (const line of lines) {
    const m = /^###\s+(.+?)\s*$/.exec(line)
    if (m) { flush(); cur = m[1].trim() } else { buf.push(line) }
  }
  flush()
  return out
}

/** 解析 markdown 表格：返回 { columns: string[], rows: string[][] }（空单元格=""） */
function parseTable(text: string): { columns: string[]; rows: string[][] } | null {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.startsWith("|"))
  if (lines.length < 2) return null
  const splitRow = (l: string) => l.replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim())
  const columns = splitRow(lines[0])
  // 第二行是分隔符 |---|---|，跳过
  const rows: string[][] = []
  for (let i = 2; i < lines.length; i++) {
    if (!lines[i]) continue
    rows.push(splitRow(lines[i]))
  }
  return { columns, rows }
}

/** 解析 `- key: value` 列表（key 可含中文/空格，如「FQN 模式」）；返回 Map */
function parseKvList(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const raw of text.split("\n")) {
    const m = /^\s*[-*]\s*(.+?)\s*[:：]\s*(.*)$/.exec(raw)
    if (m) out.set(m[1].trim(), m[2].trim())
  }
  return out
}

/** 逗号拆分 + trim + 去空 */
function splitCsv(s: string): string[] {
  return s.split(/[，,]/).map(x => x.trim()).filter(Boolean)
}

/** 收集章节正文里的所有逗号列表值（支持单行多值或多行） */
function collectCsv(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split("\n")) {
    const s = stripComment(raw)
    if (!s || s.startsWith("-")) continue
    out.push(...splitCsv(s))
  }
  return out
}

/** 从 `### 角色` 表解析 roles[] */
function parseRoles(text: string): RoleSpec[] {
  const tbl = parseTable(text)
  if (!tbl) return []
  const idx = (name: string) => tbl.columns.findIndex(c => c.toLowerCase() === name)
  const ci = {
    role: idx("role"), suffix: idx("suffix"), pkg: idx("package"), dir: idx("dir"),
    testDir: idx("testdir"), testSuffix: idx("testsuffix"), xmlDir: idx("xmldir"), impl: idx("implrole"),
  }
  const roles: RoleSpec[] = []
  for (const r of tbl.rows) {
    const at = (i: number) => i >= 0 ? (r[i] ?? "").trim() : ""
    const role = at(ci.role)
    if (!role) continue
    const truthy = (v: string) => ["true", "yes", "1", "✓", "y"].includes(v.toLowerCase())
    const spec: RoleSpec = {
      role, suffix: at(ci.suffix), package: at(ci.pkg), dir: at(ci.dir),
    }
    if (at(ci.testDir)) spec.testDir = at(ci.testDir)
    if (at(ci.testSuffix)) spec.testSuffix = at(ci.testSuffix)
    if (at(ci.xmlDir)) spec.xmlDir = at(ci.xmlDir)
    if (ci.impl >= 0 && truthy(at(ci.impl))) spec.implRole = true
    roles.push(spec)
  }
  return roles
}

/** 从 `### 包级产物` 表解析 packageArtifacts */
function parsePackageArtifacts(text: string): ArchitectureModel["packageArtifacts"] {
  const tbl = parseTable(text)
  const fallback = DEFAULT_ARCHITECTURE_MODEL.packageArtifacts
  if (!tbl) return fallback
  const ci = {
    artifact: tbl.columns.findIndex(c => c.toLowerCase() === "artifact"),
    suffix: tbl.columns.findIndex(c => c.toLowerCase() === "suffix"),
    dir: tbl.columns.findIndex(c => c.toLowerCase() === "dir"),
  }
  const get = (name: string) => {
    const row = tbl.rows.find(r => (r[ci.artifact] ?? "").trim().toLowerCase() === name)
    if (!row) return fallback[name === "constant" ? "constant" : "stateDto"]
    const at = (i: number) => i >= 0 ? (row[i] ?? "").trim() : ""
    return { suffix: at(ci.suffix) || fallback[name === "constant" ? "constant" : "stateDto"].suffix, dir: at(ci.dir) || fallback[name === "constant" ? "constant" : "stateDto"].dir }
  }
  return { constant: get("constant"), stateDto: get("statedto") }
}

/**
 * 解析 `## 架构模型` 章节正文为 ArchitectureModel。任一关键段缺失回退默认对应字段；
 * 整体不可解析（无 ### 子节）返回 null（调用方回退 DEFAULT_ARCHITECTURE_MODEL）。
 */
export function parseArchitectureModel(body: string): ArchitectureModel | null {
  const subs = splitSubSections(body)
  if (subs.size === 0) return null
  const D = DEFAULT_ARCHITECTURE_MODEL
  const val = (name: string) => {
    const t = subs.get(name)
    if (!t) return undefined
    const s = stripComment(t.split("\n").find(l => stripComment(l)) ?? "")
    return s || undefined
  }

  // 角色表是核心契约：段缺失或解析为空 → 返回 null，调用方整体回退默认模型
  const roleText = subs.get("角色")
  if (!roleText) return null
  const roles = parseRoles(roleText)
  if (roles.length === 0) return null

  const pkgArt = subs.has("包级产物") ? parsePackageArtifacts(subs.get("包级产物")!) : D.packageArtifacts

  const entityKv = parseKvList(subs.get("实体") ?? "")
  const entity: EntitySpec = {
    suffix: entityKv.get("后缀") || D.entity.suffix,
    dir: entityKv.get("目录") || D.entity.dir,
    package: entityKv.get("包") || D.entity.package,
    annotations: entityKv.has("注解") ? splitCsv(entityKv.get("注解")!) : D.entity.annotations,
    imports: entityKv.has("imports") ? splitCsv(entityKv.get("imports")!) : D.entity.imports,
  }

  const exKv = parseKvList(subs.get("异常") ?? "")
  const exception: ExceptionSpec = {
    baseClass: exKv.get("基类") || D.exception.baseClass,
    package: exKv.get("包") || D.exception.package,
    subclasses: exKv.has("子类") ? splitCsv(exKv.get("子类")!) : D.exception.subclasses,
  }

  const crossKv = parseKvList(subs.get("跨包调用") ?? "")
  const crossPackageCall = {
    fqnPattern: crossKv.get("FQN 模式") || crossKv.get("FQN模式") || D.crossPackageCall.fqnPattern,
  }

  const layout = val("layout") || D.layout
  const packageBaseRaw = val("packageBase")
  const packageBase = packageBaseRaw && packageBaseRaw.toLowerCase() !== "null" ? packageBaseRaw : undefined

  return {
    layout,
    packageBase,
    roles,
    packageArtifacts: pkgArt,
    entity,
    exception,
    crossPackageCall,
    coverageExcludes: subs.has("覆盖率排除") ? collectCsv(subs.get("覆盖率排除")!) : D.coverageExcludes,
    scanBasePackages: subs.has("主类扫描包") ? collectCsv(subs.get("主类扫描包")!) : D.scanBasePackages,
  }
}

// ── 辅助 ─────────────────────────────────────────────────────────────────────

/** 找实现层角色：优先 implRole 标记，其次 suffix 含 Impl / role 含 impl，再退而求其次首个角色 */
export function findImplRole(model: ArchitectureModel): RoleSpec | undefined {
  return model.roles.find(r => r.implRole)
    ?? model.roles.find(r => /impl/i.test(r.role) || /impl/i.test(r.suffix))
    ?? model.roles[0]
}

/** 解析架构模型路径里的占位符：`{module}` → PL/SQL 包名（去 schema 前缀）小写。
 *  rooted-module 布局每包一模块。pkg 可能是 schema-qualified（如 `MFG_ERP.F_ORDER`，pkgOf 后带点），
 *  取末段（`F_ORDER`）小写得 module —— 与 scaffold/skeleton 用 `plsqlPackage`（不含 schema）小写一致，
 *  避免把 schema 的 `.` 带进路径/包名（路径里 `.` 非法、与 LLM 建的目录不一致）。
 *  flat-no-root 路径无 `{module}` 占位，原样返回。
 *  `{packageBase}` 为项目级运行时占位，由 loadArchitectureModel 读 scaffold.json 后展开成具体值，
 *  到 resolveModelPath 消费时已落定，此处不再处理。 */
export function resolveModelPath(p: string, pkg: string): string {
  const moduleSeg = pkg.slice(pkg.lastIndexOf(".") + 1).toLowerCase()
  return p.replace(/\{module\}/g, moduleSeg)
}

/** 把模型里所有 `{packageBase}` / `{packageBaseDir}` 占位替换成具体根包（项目级，scaffold 决策）。
 *  `{packageBase}` → 点式（com.example.mfgerp），用于 package/FQN/扫描包等 Java 包名字段；
 *  `{packageBaseDir}` → 斜杠式（com/example/mfgerp），用于 dir/testDir 等文件系统路径字段。
 *  packageBase 缺失（无根包模型 / scaffold.json 尚未生成）时原样返回占位版。
 *  用 JSON 序列化整体替换，一次性覆盖所有字符串字段，避免逐字段枚举漏改。
 *  先替换 `{packageBaseDir}`（更长 token），再替换 `{packageBase}`。 */
function resolvePackageBasePlaceholders(model: ArchitectureModel, packageBase: string | undefined): ArchitectureModel {
  const serialized = JSON.stringify(model)
  if (!packageBase || !serialized.includes("{packageBase")) return model
  const pbDir = packageBase.replace(/\./g, "/")
  const replaced = serialized
    .replaceAll("{packageBaseDir}", pbDir)
    .replaceAll("{packageBase}", packageBase)
  const next = JSON.parse(replaced) as ArchitectureModel
  next.packageBase = packageBase
  return next
}

/** 校验 architecture-model.json 形状完整（各子对象/必填字段非空），残缺返回 false */
function isValidModel(raw: any): boolean {
  if (!raw || typeof raw !== "object") return false
  if (!Array.isArray(raw.roles) || raw.roles.length === 0) return false
  for (const r of raw.roles) {
    if (!r || typeof r.role !== "string" || typeof r.suffix !== "string" ||
        typeof r.package !== "string" || typeof r.dir !== "string") return false
  }
  const e = raw.entity, x = raw.exception, c = raw.crossPackageCall
  if (!e || typeof e.suffix !== "string" || typeof e.dir !== "string" || typeof e.package !== "string" ||
      !Array.isArray(e.annotations) || !Array.isArray(e.imports)) return false
  if (!x || typeof x.baseClass !== "string" || typeof x.package !== "string" || !Array.isArray(x.subclasses)) return false
  if (!c || typeof c.fqnPattern !== "string") return false
  if (!Array.isArray(raw.coverageExcludes) || !Array.isArray(raw.scanBasePackages)) return false
  return true
}

/** 读 <artifactsDir>/architecture-model.json；缺失/解析失败/形状残缺回退默认并 warn。
 *  读后从同目录 scaffold.json 取 targetProject.packageBase（兜底 groupId），把模型里所有
 *  `{packageBase}` 占位替换成具体值——arch-model.json 在 start 落盘时 packageBase 尚未决策
 *  （scaffold 阶段才定），故在此懒注入。scaffold.json 缺失（pre-scaffold，仅 scaffold agent 自身）
 *  时占位保留。 */
export function loadArchitectureModel(artifactsDir: string): ArchitectureModel {
  const p = join(artifactsDir, "architecture-model.json")
  if (!existsSync(p)) return DEFAULT_ARCHITECTURE_MODEL
  let model: ArchitectureModel
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8"))
    if (!isValidModel(raw)) {
      getLogger().warn("[architecture-model]", `architecture-model.json 形状不完整，回退默认模型: ${p}`)
      return DEFAULT_ARCHITECTURE_MODEL
    }
    model = raw as ArchitectureModel
  } catch {
    getLogger().warn("[architecture-model]", `architecture-model.json 解析失败，回退默认模型: ${p}`)
    return DEFAULT_ARCHITECTURE_MODEL
  }
  // {packageBase} 占位懒注入：读同目录 scaffold.json 的 targetProject.packageBase（兜底 groupId）
  const scaffoldPath = join(artifactsDir, "scaffold.json")
  if (existsSync(scaffoldPath)) {
    try {
      const sc = JSON.parse(readFileSync(scaffoldPath, "utf-8"))
      const tp = sc?.targetProject ?? {}
      const pb = (typeof tp.packageBase === "string" && tp.packageBase) || (typeof tp.groupId === "string" && tp.groupId) || undefined
      model = resolvePackageBasePlaceholders(model, pb)
    } catch {
      // scaffold.json 解析失败不阻断——保留占位版，下游 builder 多在 scaffold 完成后跑届时已可读
    }
  }
  return model
}

/** 格式化成紧凑 markdown 摘要（runtimeContext 注入用） */
export function formatArchitectureModel(model: ArchitectureModel): string {
  const lines: string[] = []
  lines.push(`- layout: ${model.layout}`)
  if (model.packageBase) lines.push(`- packageBase: ${model.packageBase}`)
  lines.push("- 角色: " + model.roles.map(r => `${r.role}(${r.suffix}→${r.package})`).join(", "))
  lines.push(`- 实体: ${model.entity.suffix} @ ${model.entity.dir} [${model.entity.annotations.join(", ")}]`)
  lines.push(`- 异常基类: ${model.exception.baseClass} @ ${model.exception.package}`)
  lines.push(`- 跨包调用 FQN: ${model.crossPackageCall.fqnPattern}`)
  lines.push(`- 覆盖率排除: ${model.coverageExcludes.join(", ")}`)
  return lines.join("\n")
}
