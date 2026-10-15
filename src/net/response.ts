import type { ServerResponse } from 'node:http'
import type { ApiResult } from '../types.js'

/** 发送 JSON 响应 */
export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const text = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  })
  res.end(text)
}

/** 发送 HTML 响应 */
export function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
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
