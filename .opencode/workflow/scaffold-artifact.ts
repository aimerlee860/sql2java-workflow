/** scaffold artifact 的确定性规范化、交叉字段校验与磁盘布局校验。 */

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { readArtifactJson } from "./artifact-json"

/** 纯常量包在 packageMappings 中使用的保留角色。 */
export const CONSTANT_COMPONENT_ROLE = "constant"

export interface ScaffoldNormalizationResult {
  data: any
  changes: string[]
}

function arrayOf(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}

function packageKey(value: unknown): string {
  return String(value ?? "").trim().toUpperCase()
}

/**
 * 规范化 scaffold.json 中可由现有字段确定性推导的内容。
 * 不创建缺失的 packageMapping，避免凭空猜测组件角色。
 */
export function normalizeScaffoldArtifact(
  input: unknown,
  expectedProjectRoot?: string,
  pureConstantPackages: ReadonlySet<string> = new Set(),
): ScaffoldNormalizationResult {
  const data = input && typeof input === "object"
    ? JSON.parse(JSON.stringify(input))
    : input
  const changes: string[] = []
  if (!data || typeof data !== "object") return { data, changes }

  if (expectedProjectRoot && data.projectRoot !== expectedProjectRoot) {
    data.projectRoot = expectedProjectRoot
    changes.push("projectRoot 已改为引擎计算的正式输出目录")
  }

  const mappings = arrayOf(data.packageMappings)
  for (const mapping of mappings) {
    const key = packageKey(mapping?.plsqlPackage)
    if (!pureConstantPackages.has(key)) continue
    if (!Array.isArray(mapping?.components) || mapping.components.length > 0) continue
    mapping.components = [{ role: CONSTANT_COMPONENT_ROLE }]
    changes.push(`${mapping.plsqlPackage} 的空 components 已补为 ${CONSTANT_COMPONENT_ROLE} 角色`)
  }

  return { data, changes }
}

/** 从 inventory 的逐包产物中确定“无过程/函数且至少含一个常量”的纯常量包。 */
export function loadPureConstantPackages(artifactsDir: string): Set<string> {
  const result = new Set<string>()
  const packagesDir = join(artifactsDir, "packages")
  if (!existsSync(packagesDir)) return result
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) continue
    try {
      const pkg = readArtifactJson<any>(join(packagesDir, entry.name)).data
      const hasSubprograms = arrayOf(pkg?.procedures).length > 0 || arrayOf(pkg?.functions).length > 0
      if (!hasSubprograms && arrayOf(pkg?.constants).length > 0) {
        const key = packageKey(pkg?.packageName ?? entry.name.replace(/\.json$/i, ""))
        if (key) result.add(key)
      }
    } catch {
      // inventory 阶段已有独立校验；单个坏文件不应导致 scaffold 规范化误判。
    }
  }
  return result
}

/** ScaffoldSchema 无法表达的跨字段约束。 */
export function validateScaffoldRelations(scaffold: any): string[] {
  const errors: string[] = []
  const mappings = arrayOf(scaffold?.packageMappings)
  const seen = new Set<string>()
  const mapped = new Set<string>()

  for (const mapping of mappings) {
    const key = packageKey(mapping?.plsqlPackage)
    if (!key) continue
    if (seen.has(key)) errors.push(`packageMappings 存在重复 plsqlPackage: ${mapping.plsqlPackage}`)
    seen.add(key)
    mapped.add(key)
  }

  for (const field of ["constants", "stateDtos"] as const) {
    for (const entry of arrayOf(scaffold?.generated?.[field])) {
      const key = packageKey(entry?.plsqlPackage)
      if (key && !mapped.has(key)) {
        errors.push(`${field} 中的 ${entry.plsqlPackage} 没有对应 packageMapping`)
      }
    }
  }

  return errors
}

function normalizeRelativePath(value: unknown): string {
  return String(value ?? "").replace(/\\/g, "/").replace(/^\.\//, "")
}

function isSafeRelativePath(value: string): boolean {
  if (!value || isAbsolute(value) || /^[A-Za-z]:/.test(value)) return false
  const parts = value.split("/")
  return !parts.includes("..") && !parts.includes("")
}

function collectDeclaredFiles(scaffold: any): Set<string> {
  const files = new Set<string>()
  const add = (value: unknown) => {
    const file = normalizeRelativePath(value)
    if (file) files.add(file)
  }

  add(scaffold?.structure?.pomXml)
  for (const entity of arrayOf(scaffold?.generated?.entities)) add(entity?.file)
  for (const constant of arrayOf(scaffold?.generated?.constants)) add(constant?.file)
  for (const stateDto of arrayOf(scaffold?.generated?.stateDtos)) add(stateDto?.file)
  for (const common of arrayOf(scaffold?.generated?.commonClasses)) add(common?.file)
  for (const common of arrayOf(scaffold?.generated?.commonModules?.classes)) add(common?.file)
  for (const extra of arrayOf(scaffold?.generated?.extraFiles)) add(extra?.file)
  add(scaffold?.generated?.h2SchemaFile)
  add(scaffold?.generated?.testApplicationConfig)
  return files
}

function walkFiles(root: string, current: string = root): string[] {
  if (!existsSync(current)) return []
  const files: string[] = []
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const full = join(current, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(root, full))
    else if (entry.isFile()) files.push(relative(root, full).split(sep).join("/"))
  }
  return files
}

function packageFromJavaPath(file: string): string | null {
  const normalized = normalizeRelativePath(file)
  const prefixes = ["src/main/java/", "src/test/java/"]
  const prefix = prefixes.find(p => normalized.startsWith(p))
  if (!prefix || !normalized.endsWith(".java")) return null
  const relativeJava = normalized.slice(prefix.length)
  const slash = relativeJava.lastIndexOf("/")
  return slash < 0 ? "" : relativeJava.slice(0, slash).replace(/\//g, ".")
}

/**
 * 校验 scaffold 声明与临时项目目录的一致性。
 * 此函数只读磁盘，不执行清理或修复。
 */
export function validateScaffoldProjectLayout(scaffold: any, workspaceRoot: string): string[] {
  const errors: string[] = []
  const root = resolve(workspaceRoot)
  const groupId = String(scaffold?.targetProject?.groupId ?? "").trim()
  const declaredFiles = collectDeclaredFiles(scaffold)

  const placeholderNamespace = /^(?:com|org)\.example(?:\.|$)/i
  if (placeholderNamespace.test(groupId)) {
    errors.push(`targetProject.groupId 仍是示例占位命名空间: ${groupId}`)
  }

  for (const dirValue of arrayOf(scaffold?.structure?.directories)) {
    const dir = normalizeRelativePath(dirValue)
    if (!isSafeRelativePath(dir)) {
      errors.push(`structure.directories 包含不安全路径: ${dirValue}`)
      continue
    }
    if (!existsSync(join(root, ...dir.split("/")))) errors.push(`声明目录不存在: ${dir}`)
  }

  for (const file of declaredFiles) {
    if (!isSafeRelativePath(file)) {
      errors.push(`generated/structure 包含不安全文件路径: ${file}`)
      continue
    }
    const full = resolve(root, ...file.split("/"))
    if (full !== root && !full.startsWith(root + sep)) {
      errors.push(`文件路径逃逸 scaffold 工作区: ${file}`)
      continue
    }
    if (!existsSync(full)) {
      errors.push(`scaffold 声明文件不存在: ${file}`)
      continue
    }

    const expectedPackage = packageFromJavaPath(file)
    if (expectedPackage == null) continue
    const source = readFileSync(full, "utf-8")
    const match = source.match(/^\s*package\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;/m)
    if (!match) errors.push(`Java 文件缺少 package 声明: ${file}`)
    else if (match[1] !== expectedPackage) {
      errors.push(`Java package 声明与路径不一致: ${file}，声明=${match[1]}，期望=${expectedPackage}`)
    }
  }

  const relevant = /(?:\.java|\.xml|\.ya?ml|\.properties|\.sql|pom\.xml)$/i
  for (const file of walkFiles(root)) {
    const isSourceFile = file.startsWith("src/main/") || file.startsWith("src/test/")
    if ((file !== "pom.xml" && !isSourceFile) || !relevant.test(file)) continue
    if (!declaredFiles.has(file)) errors.push(`scaffold 工作区存在未登记文件: ${file}`)
  }

  return errors
}

export function scaffoldDeclaredFiles(scaffold: any): string[] {
  return [...collectDeclaredFiles(scaffold)].sort()
}
