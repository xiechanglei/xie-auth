import type { IncomingHttpHeaders } from 'node:http'

/** sendFile 缓存 / Range 相关的原始选项（从 FileResponse 摘出） */
export interface FileCacheOptions {
  /** ETag：true 自动生成 `"<mtimeMs>-<size>"`（强校验，不读内容）；字符串=自定义；缺省关闭 */
  etag?: boolean | string
  /** Last-Modified：true 取文件 mtime；Date=指定时间；缺省关闭 */
  lastModified?: boolean | Date
  /** Cache-Control 头原文，如 'public, max-age=3600, immutable'；不传则不下发 */
  cacheControl?: string
  /** 是否支持 Range / 206 / 416；缺省关闭 */
  range?: boolean
}

export interface FileValidators {
  etag?: string
  lastModified?: Date
}

/** 去掉弱标记 W/，仅比较指纹串 */
function stripWeak(tag: string): string {
  return tag.trim().replace(/^W\//, '')
}

/**
 * 依据文件 stat 与选项生成校验值（etag / last-modified）。
 * etag 采用 mtime+size 组合的**强校验**串，零额外读盘，可安全用于 If-Range / If-Match。
 */
export function computeValidators(stat: { size: number; mtime: Date }, opts: FileCacheOptions): FileValidators {
  const v: FileValidators = {}
  if (opts.etag) {
    v.etag =
      typeof opts.etag === 'string'
        ? /^"?/.test(opts.etag.trim())
          ? opts.etag.trim()
          : `"${opts.etag}"`
        : `"${stat.mtime.getTime().toString(16)}-${stat.size.toString(16)}"`
  }
  if (opts.lastModified) {
    v.lastModified = opts.lastModified === true ? stat.mtime : opts.lastModified
  }
  return v
}

/** If-None-Match / If-Modified-Since 命中判定：true 表示客户端副本仍新鲜，应回 304 */
export function isFresh(headers: IncomingHttpHeaders, v: FileValidators): boolean {
  const inm = headers['if-none-match']
  if (typeof inm === 'string' && v.etag) {
    if (inm.trim() === '*') return true
    // If-None-Match 采用弱比较（忽略 W/ 差异）
    return inm.split(',').some((t) => stripWeak(t) === stripWeak(v.etag!))
  }
  const ims = headers['if-modified-since']
  if (typeof ims === 'string' && v.lastModified) {
    const since = Date.parse(ims)
    if (!Number.isNaN(since)) {
      const lm = Math.floor(v.lastModified.getTime() / 1000)
      return lm <= Math.floor(since / 1000)
    }
  }
  return false
}

/** If-Range 前置校验：缺省视为通过；不匹配当前校验值则应忽略 Range 回全量 */
export function rangePreconditionOk(headers: IncomingHttpHeaders, v: FileValidators): boolean {
  const ir = headers['if-range']
  if (ir === undefined) return true
  const value = Array.isArray(ir) ? ir[0] : String(ir)
  // 若为 ETag 形式（以 " 或 W/" 开头）
  const isEtagForm = /^\s*(W\/)?"/.test(value)
  if (isEtagForm && v.etag) return stripWeak(value) === stripWeak(v.etag)
  const t = Date.parse(value)
  if (!Number.isNaN(t) && v.lastModified) {
    return Math.floor(v.lastModified.getTime() / 1000) === Math.floor(t / 1000)
  }
  return false
}

export interface ByteRange {
  start: number
  end: number
}

/**
 * 解析单区间 Range。返回：
 * - ByteRange 有效区间（闭区间，0-based）
 * - 'unsatisfied' 起始越界 → 416
 * - null 无 Range / 语法无效 / 多区间（MVP 不支持）→ 调用方按全量处理
 */
export function parseRange(header: string | undefined, size: number): ByteRange | 'unsatisfied' | null {
  if (!header) return null
  const m = /^bytes=(.+)$/i.exec(header.trim())
  if (!m) return null
  const specs = m[1].split(',').map((s) => s.trim()).filter(Boolean)
  if (specs.length !== 1) return null // 多区间：MVP 忽略，回全量
  const spec = specs[0]

  // 后缀区间 bytes=-N（最后 N 字节）
  if (spec.startsWith('-')) {
    const n = Number(spec.slice(1))
    if (!Number.isFinite(n) || n <= 0) return null
    return { start: Math.max(size - n, 0), end: size - 1 }
  }

  const [startStr, endStr] = spec.split('-')
  const start = Number(startStr)
  if (!Number.isFinite(start) || start < 0 || start >= size) return 'unsatisfied'
  let end: number
  if (endStr === undefined || endStr === '') end = size - 1
  else {
    end = Number(endStr)
    if (!Number.isFinite(end)) return null
    end = Math.min(end, size - 1)
  }
  if (end < start) return 'unsatisfied'
  return { start, end }
}
