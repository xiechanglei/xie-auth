import type { ServerResponse } from 'node:http'
import { statSync, createReadStream } from 'node:fs'
import { resolve, basename, extname } from 'node:path'
import { RAW_RESPONSE } from '../types.js'
import type { ApiResult, FileResponse, RawResponse } from '../types.js'
import { computeValidators, isFresh, parseRange, rangePreconditionOk } from './fileStream.js'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
}

/** 根据扩展名推断 Content-Type */
export function guessContentType(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
}

/** 判断 handler 返回值是否为原始响应描述对象 */
export function isRawResponse(value: unknown): value is RawResponse {
  return value !== null && typeof value === 'object' && (value as Record<symbol, unknown>)[RAW_RESPONSE] === true
}

/** 组装 Content-Disposition（兼容非 ASCII 文件名，RFC 5987） */
function contentDisposition(type: 'attachment' | 'inline', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '')
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

/** ctx 层累积的响应默认值（状态码 / 头 / Cookie），出口统一应用 */
export interface ResponseDefaults {
  status?: number
  headers?: Record<string, string>
  cookies?: string[]
  append?: Record<string, string[]>
}

/** 在 writeHead 之前把 ctx 累积的 Set-Cookie / 追加头写入响应 */
function emitCookies(res: ServerResponse, d?: ResponseDefaults): void {
  if (!d) return
  if (d.append) {
    for (const [k, vals] of Object.entries(d.append)) for (const v of vals) res.appendHeader(k, v)
  }
  if (d.cookies?.length) {
    for (const c of d.cookies) res.appendHeader('Set-Cookie', c)
  }
}

/** 合并响应头：框架默认 ← ctx 默认 ← 单次 opts */
function withDefaults(
  base: Record<string, string | number>,
  d?: ResponseDefaults,
  extra?: Record<string, string>,
): Record<string, string | number> {
  return { ...base, ...(d?.headers ?? {}), ...(extra ?? {}) }
}

/**
 * 发送磁盘文件：支持条件缓存（ETag / Last-Modified → 304）与单区间 Range（206 / 416）。
 * 两者均为 opt-in：r.etag / r.lastModified / r.range 缺省关闭，保持全量 200 行为。
 * Cookie 已由调用方 sendRawResponse 统一下发，此处不重复。
 */
function serveFile(res: ServerResponse, r: FileResponse, d?: ResponseDefaults): void {
  const req = res.req
  const method = (req?.method ?? 'GET').toUpperCase()
  const filePath = resolve(r.filePath)
  let st
  try {
    st = statSync(filePath)
  } catch {
    st = undefined
  }
  if (!st || !st.isFile()) {
    const text = JSON.stringify({ success: false, message: '文件不存在', data: null })
    res.writeHead(404, withDefaults({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) }, d))
    res.end(text)
    return
  }

  const status = r.status ?? d?.status ?? 200
  const validators = computeValidators(st, r)

  // 缓存 / 用户自定义头（304 与实体响应共用）
  const cacheHeaders: Record<string, string> = {}
  if (r.cacheControl) cacheHeaders['Cache-Control'] = r.cacheControl
  if (validators.etag) cacheHeaders['ETag'] = validators.etag
  if (validators.lastModified) cacheHeaders['Last-Modified'] = validators.lastModified.toUTCString()
  const shared = withDefaults(cacheHeaders, d, r.headers)

  // 1) 条件命中 → 304（不带实体头与 body）
  if ((method === 'GET' || method === 'HEAD') && req && isFresh(req.headers, validators)) {
    res.writeHead(304, shared)
    res.end()
    return
  }

  const fname = r.filename ?? basename(filePath)
  const entity: Record<string, string | number> = {
    'Content-Type': r.mimeType ?? guessContentType(filePath),
    'Content-Disposition': contentDisposition(r.download === false ? 'inline' : 'attachment', fname),
    ...shared,
  }

  // 2) Range → 206 / 416（仅在开启且前置条件通过时）
  if (r.range && (method === 'GET' || method === 'HEAD') && req?.headers.range && rangePreconditionOk(req.headers, validators)) {
    const range = parseRange(req.headers.range as string, st.size)
    if (range === 'unsatisfied') {
      res.writeHead(416, { ...entity, 'Content-Range': `bytes */${st.size}`, 'Accept-Ranges': 'bytes' })
      res.end()
      return
    }
    if (range) {
      const len = range.end - range.start + 1
      res.writeHead(206, {
        ...entity,
        'Content-Range': `bytes ${range.start}-${range.end}/${st.size}`,
        'Content-Length': len,
        'Accept-Ranges': 'bytes',
      })
      if (method === 'HEAD') {
        res.end()
        return
      }
      createReadStream(filePath, { start: range.start, end: range.end }).pipe(res)
      return
    }
    // range === null（语法无效 / 多区间）→ 落到全量
  }

  // 3) 全量 200
  const fullHeaders: Record<string, string | number> = { ...entity, 'Content-Length': st.size }
  if (r.range) fullHeaders['Accept-Ranges'] = 'bytes'
  res.writeHead(status, fullHeaders)
  if (method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(filePath).pipe(res)
}

/** 执行原始响应（文件流式 / HTML / Buffer / Text）；绕过统一 JSON 封装 */
export function sendRawResponse(res: ServerResponse, r: Exclude<RawResponse, { kind: 'view' }>, d?: ResponseDefaults): void {
  const status = r.status ?? d?.status ?? 200
  emitCookies(res, d)
  const extra = r.headers

  if (r.kind === 'file') {
    serveFile(res, r, d)
    return
  }

  if (r.kind === 'html') {
    const headers = withDefaults({ 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(r.html) }, d, extra)
    res.writeHead(status, headers)
    res.end(r.html)
    return
  }

  if (r.kind === 'text') {
    const body = Buffer.from(r.text, 'utf-8')
    res.writeHead(status, withDefaults({ 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.byteLength }, d, extra))
    res.end(body)
    return
  }

  // buffer
  const headers = withDefaults(
    { 'Content-Type': r.contentType ?? 'application/octet-stream', 'Content-Length': r.buffer.byteLength },
    d,
    extra,
  )
  if (r.filename || r.download) {
    headers['Content-Disposition'] = contentDisposition(r.download === false ? 'inline' : 'attachment', r.filename ?? 'download')
  }
  res.writeHead(status, headers)
  res.end(r.buffer)
}

/** 发送 JSON 响应 */
export function sendJson(res: ServerResponse, status: number, payload: unknown, d?: ResponseDefaults): void {
  const text = JSON.stringify(payload)
  emitCookies(res, d)
  res.writeHead(status, withDefaults({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) }, d))
  res.end(text)
}

/** 发送 HTML 响应 */
export function sendHtml(res: ServerResponse, status: number, html: string, extra?: Record<string, string>): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    ...extra,
  })
  res.end(html)
}

/** 302 跳转 */
export function sendRedirect(res: ServerResponse, url: string, status = 302): void {
  res.writeHead(status, { Location: url })
  res.end()
}

/** 把 handler 的返回值封装成统一响应；若已是完整 ApiResult 则透传 */
export function wrapResult(returned: unknown): ApiResult {
  if (
    returned !== null &&
    typeof returned === 'object' &&
    !Array.isArray(returned) &&
    'success' in returned &&
    'message' in returned &&
    'data' in returned
  ) {
    const r = returned as Record<string, unknown>
    return { success: Boolean(r.success), message: String(r.message), data: (r.data ?? null) as unknown }
  }
  return { success: true, message: 'ok', data: (returned ?? null) as unknown }
}

/** 追加响应头（用于 Set-Cookie 等） */
export function appendHeader(res: ServerResponse, name: string, value: string): void {
  res.setHeader(name, value)
}
