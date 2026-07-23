/**
 * test-case-enumerator — test-gen 确定性前置工具（零 LLM）
 *
 * test-gen sub-stage 派发前由 engine inline 调用（仿 generateDoAndH2Schema 先例）。读本 unit 的
 * `shard-inputs/{pkg}/{ref}/source.sql`（已是该子程序的预切片），regex 抽 PL/SQL 控制流结构 →
 * 用例清单 testCases[]，写回 per-unit `translations/{pkg}/{ref}.json`。
 *
 * 抽取维度（对应用例 type）：
 *   - RAISE_APPLICATION_ERROR(-20xxx,'msg') → negative（expectKind=throws-BusinessException:<code>）
 *   - FOR / WHILE 循环 → boundary（0 / 1 / 满集）
 *   - IN ... DEFAULT NULL 参数 → boundary（空值）
 *   - IF / ELSIF 分支 → positive（每分支一例）
 *
 * test-gen slave 按清单逐条填 @Test 体，不自行发明用例——把"测什么"移出 LLM 上下文。
 *
 * 上限：超长过程 IF 分支可能上百，单次 test-gen 填不动 → 按优先级 negative > boundary > positive
 * 截断到 MAX_CASES，被丢的 positive 计数 WARN（不静默截断）。实际覆盖率仍交 verify JaCoCo 门禁兜底。
 *
 * 设计见 plan: cuddly-gliding-peach。
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { getLogger } from "./workflow-logger"
import { loadArchitectureModel } from "./architecture-model"

/** 对齐 UnitTranslationSchema.testCases 元素形状 */
export interface TestCase {
  caseId: string
  plsqlLine: number
  type: "positive" | "negative" | "boundary"
  construct: string
  setupHint: string
  expectKind: string
  status: "pending" | "done"
}

/** 单次 test-gen 可承载的用例上限（优先保留 negative/boundary，positive 超出截断）。 */
const MAX_CASES = 50

/** 读 source.sql 全文（不存在返回 null）。 */
function readSourceSql(artifactsDir: string, pkg: string, ref: string): string | null {
  const p = join(artifactsDir, "shard-inputs", pkg, ref, "source.sql")
  if (!existsSync(p)) return null
  try { return readFileSync(p, "utf-8") } catch { return null }
}

/**
 * 剥 PL/SQL 注释（行 -- / 块 /* *\/），用等量空格+换行替换保持 offset 与行号对齐，
 * 避免抽到注释里写的结构。镜像 plsql-file-scanner.extractCallsByRegex 的剥注释逻辑。
 */
function stripComments(code: string): string {
  return code
    .replace(/--[^\n]*/g, s => " ".repeat(s.length))
    .replace(/\/\*[\s\S]*?\*\//g, s => {
      const nl = (s.match(/\n/g) || []).length
      return " ".repeat(s.length - nl) + "\n".repeat(nl)
    })
}

/** 预计算行起始偏移 + offset→1-based 行号（二分），镜像 extractCallsByRegex。 */
function makeLineOf(src: string): (offset: number) => number {
  const lineStarts: number[] = [0]
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1)
  return (offset: number): number => {
    let lo = 0, hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1
      if (lineStarts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
}

/** 折叠空白便于把条件塞进 construct 单行。 */
function compact(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 120)
}

/**
 * 从 source.sql 抽用例清单。返回 null 表示 source.sql 缺失（调用方回退：test-gen 自行发明用例）。
 */
export function enumerateTestCases(artifactsDir: string, pkg: string, ref: string): TestCase[] | null {
  const log = getLogger()
  const raw = readSourceSql(artifactsDir, pkg, ref)
  if (raw === null) {
    log?.warn(`test-case-enumerator: source.sql 缺失 ${pkg}/${ref}，跳过用例枚举（回退 LLM 自发明）`)
    return null
  }
  const src = stripComments(raw)
  const lineOf = makeLineOf(src)
  // 异常基类名由架构模型驱动（默认 BusinessException，DDD 则 TranFailException）
  const exceptionClass = loadArchitectureModel(artifactsDir).exception.baseClass

  const negatives: TestCase[] = []
  const boundaries: TestCase[] = []
  const positives: TestCase[] = []

  let m: RegExpExecArray | null

  // 1) RAISE_APPLICATION_ERROR(-20xxx,'msg') → negative
  const raiseRe = /\braise_application_error\s*\(\s*(-?\d+)\s*,\s*'([^']*)'/gi
  while ((m = raiseRe.exec(src)) !== null) {
    const code = m[1]
    const msg = compact(m[2])
    negatives.push({
      caseId: "", // 统一在末尾编号
      plsqlLine: lineOf(m.index),
      type: "negative",
      construct: `RAISE_APPLICATION_ERROR(${code}): ${msg}`,
      setupHint: `mock mapper 使校验失败、触达该 RAISE（错误码 ${code}）`,
      expectKind: `throws-${exceptionClass}:${code}`,
      status: "pending",
    })
  }

  // 2) FOR / WHILE 循环 → boundary（0/1/满）
  const loopRe = /\b(for|while)\b/gi
  const seenLoopLine = new Set<number>()
  while ((m = loopRe.exec(src)) !== null) {
    const line = lineOf(m.index)
    if (seenLoopLine.has(line)) continue  // 同行多个关键字只取一例
    seenLoopLine.add(line)
    boundaries.push({
      caseId: "",
      plsqlLine: line,
      type: "boundary",
      construct: `${m[1].toUpperCase()} 循环: 边界(空集/单条/满集)`,
      setupHint: `mock mapper 返回 空集 / 单条 / 满集 三态各一例，覆盖循环 0/1/N 次`,
      expectKind: "return-value",
      status: "pending",
    })
  }

  // 3) IN/OUT ... DEFAULT NULL 参数 → boundary（空值）。要求 in/out 模式关键字 + 类型，避免
  //    把 function/procedure 头等误当参数名（中间通配禁跨括号，类型形如 varchar2(100) 显式消费括号）。
  const defNullRe = /(\b[a-z_]\w*)\s+(?:in\s+(?:out\s+)?|out\s+)[\w.%]+(?:\s*\([^)]*\))?\s+default\s+null\b/gi
  const seenParam = new Set<string>()
  while ((m = defNullRe.exec(src)) !== null) {
    const name = m[1].toUpperCase()
    if (seenParam.has(name)) continue
    seenParam.add(name)
    boundaries.push({
      caseId: "",
      plsqlLine: lineOf(m.index),
      type: "boundary",
      construct: `参数 ${name} DEFAULT NULL: 空值路径`,
      setupHint: `传入 ${name}=null，触发 NVL/默认值分支`,
      expectKind: "return-value",
      status: "pending",
    })
  }

  // 4) IF / ELSIF 分支 → positive（每分支一例）
  const ifRe = /\b(if|elsif)\b\s*(.*?)(?:\bthen\b)/gi
  while ((m = ifRe.exec(src)) !== null) {
    const cond = compact(m[2])
    positives.push({
      caseId: "",
      plsqlLine: lineOf(m.index),
      type: "positive",
      construct: `${m[1].toUpperCase()} 分支: ${cond || "(条件)"}`,
      setupHint: `mock mapper 使条件 [${cond || "该分支"}] 成立，触达该分支`,
      expectKind: "return-value",
      status: "pending",
    })
  }

  // 按优先级合并 + 截断 + 编号
  const merged = [...negatives, ...boundaries, ...positives]
  const dropped = Math.max(0, merged.length - MAX_CASES)
  if (dropped > 0) {
    log?.warn(`test-case-enumerator: ${pkg}/${ref} 用例 ${merged.length} 超 MAX_CASES=${MAX_CASES}，末尾截断 ${dropped} 条 positive（覆盖率交 verify JaCoCo 兜底）`)
  }
  return merged.slice(0, MAX_CASES).map((tc, i) => ({ ...tc, caseId: `case-${i + 1}` }))
}
