import type { IncomingMessage } from 'node:http'

/** Cookie 序列化选项 */
export interface CookieSerializeOptions {
  /** Domain 属性 */
  domain?: string
  /** Path 属性，默认 `/` */
  path?: string
  /** Expires 属性（与 maxAge 二选一，maxAge 优先） */
  expires?: Date
  /** Max-Age 属性，单位**秒** */
  maxAge?: number
  /** HttpOnly */
  httpOnly?: boolean
  /** Secure */
  secure?: boolean
  /** SameSite；true 等价 'Strict'，false 则不输出 */
  sameSite?: 'lax' | 'strict' | 'none' | boolean
}

/** 解析请求 Cookie 头 → { name: value } */
export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie ?? ''
  const out: Record<string, string> = {}
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=')
    if (idx === -1) continue
    const k = pair.slice(0, idx).trim()
    const v = pair.slice(idx + 1).trim()
    if (k) out[k] = decodeURIComponent(v)
  }
  return out
}

/** 序列化单个 Set-Cookie 值 */
export function serializeCookie(name: string, value: string, opts: CookieSerializeOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  if (opts.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.floor(opts.maxAge)}`)
  } else if (opts.expires) {
    parts.push(`Expires=${opts.expires.toUTCString()}`)
  }
  parts.push(`Path=${opts.path ?? '/'}`)
  if (opts.domain) parts.push(`Domain=${opts.domain}`)
  if (opts.httpOnly) parts.push('HttpOnly')
  if (opts.secure) parts.push('Secure')
  if (opts.sameSite === true) parts.push('SameSite=Strict')
  else if (typeof opts.sameSite === 'string') {
    const v = opts.sameSite.toLowerCase()
    parts.push('SameSite=' + (v === 'none' ? 'None' : v === 'strict' ? 'Strict' : 'Lax'))
  }
  return parts.join('; ')
}
