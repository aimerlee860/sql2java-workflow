/**
 * 本地时间戳工具 —— 全工作流统一使用本地系统时区的时间字符串。
 *
 * 背景：原先 runId 目录用本地时区（getHours 等），日志/artifact 元数据用
 * new Date().toISOString()（UTC），两套时间在 Windows 上常对不上，排查困难。
 * 现统一为本地时区，并用「本地时间 + 时区偏移」的标准 ISO 格式，既直观对齐
 * 本地时钟，又能被 new Date(str).getTime() 正确反解析（duration 计算依赖此）。
 *
 * 格式示例（东八区）：2026-07-23T14:20:15.123+08:00
 * 若系统时区设为 UTC，偏移即为 +00:00，跟随宿主机设置。
 */

const pad = (n: number, width = 2): string => String(n).padStart(width, "0")

/**
 * 返回当前时刻的本地时区 ISO 字符串（带偏移，可被 new Date() 反解析）。
 */
export function nowLocal(): string {
  return toLocalISO(new Date())
}

/**
 * 将任意 Date 转为本地时区 ISO 字符串（带偏移，可被 new Date() 反解析）。
 */
export function toLocalISO(d: Date): string {
  const tzOffsetMin = -d.getTimezoneOffset() // 东八区 = +480
  const sign = tzOffsetMin >= 0 ? "+" : "-"
  const abs = Math.abs(tzOffsetMin)
  const offset = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
    offset
  )
}
