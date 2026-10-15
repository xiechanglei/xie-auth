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
