/** 把「10MB / 512KB / 1GB」或纯字节数解析为字节数 */
export function parseSize(input: string | number): number {
  if (typeof input === 'number') return Math.max(0, Math.floor(input))
  const m = /^([\d.]+)\s*(B|KB|MB|GB|TB)?$/i.exec(input.trim())
  if (!m) throw new Error(`无法解析的大小: ${input}`)
  const value = parseFloat(m[1])
  const unit = (m[2] ?? 'B').toUpperCase()
  const factors: Record<string, number> = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024, TB: 1024 * 1024 * 1024 * 1024 }
  return Math.floor(value * (factors[unit] ?? 1))
}

/** 把「24h / 30m / 7d / 30s」或毫秒数解析为毫秒；0 表示永久 */
export function parseDuration(input: string | number): number {
  if (typeof input === 'number') return Math.max(0, Math.floor(input))
  const trimmed = input.trim()
  if (trimmed === '0') return 0
  const m = /^(\d+)\s*(ms|s|m|h|d)?$/i.exec(trimmed)
  if (!m) throw new Error(`无法解析的时长: ${input}`)
  const value = parseInt(m[1], 10)
  const unit = (m[2] ?? 'ms').toLowerCase()
  const factors: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  return value * (factors[unit] ?? 1)
}
