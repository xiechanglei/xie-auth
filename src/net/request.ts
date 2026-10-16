import type { IncomingMessage } from 'node:http'
import { parseMultipart, getBoundary } from './multipart.js'
import { UploadManager } from './upload.js'
import type { FilesField } from '../types.js'

/** 请求体超限错误：携带 statusCode 供出口统一映射为 413 */
export class BodyTooLargeError extends Error {
  readonly statusCode = 413
  constructor(message: string) {
    super(message)
    this.name = 'BodyTooLargeError'
  }
}

/** 读取请求体为 Buffer，超过上限则 reject */
export function readBody(req: IncomingMessage, limitBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // 预检 Content-Length：超限直接拒绝，不开始接收请求体（避免大 body 先占内存再报错）
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > limitBytes) {
      reject(new BodyTooLargeError('请求体超过大小上限'))
      req.destroy()
      return
    }
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > limitBytes) {
        reject(new BodyTooLargeError('请求体超过大小上限'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** 从 URL 解析查询串参数 */
export function parseQuery(url: string): Record<string, string> {
  const idx = url.indexOf('?')
  const query: Record<string, string> = {}
  if (idx === -1) return query
  const sp = new URLSearchParams(url.slice(idx + 1))
  for (const [k, v] of sp) query[k] = v
  return query
}

export interface Payload {
  body: Record<string, unknown>
  files: FilesField
}

/**
 * 依据 Content-Type 解析请求体；multipart 时文件交由 uploadManager 落盘。
 * 新创建的临时文件绝对路径会 push 进传入的 tempPaths（即使中途抛错也已收集，供调用方 finally 清理）。
 */
export async function parseBody(req: IncomingMessage, raw: Buffer, uploadManager: UploadManager | null, tempPaths: string[]): Promise<Payload> {
  const contentType = (req.headers['content-type'] ?? '').toString()
  const body: Record<string, unknown> = {}
  const files: FilesField = {}

  if (raw.length === 0) return { body, files }

  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(raw.toString('utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        Object.assign(body, parsed as Record<string, unknown>)
      } else {
        body.__raw = parsed
      }
    } catch {
      throw new Error('请求体不是合法 JSON')
    }
    return { body, files }
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const sp = new URLSearchParams(raw.toString('utf8'))
    for (const [k, v] of sp) body[k] = v
    return { body, files }
  }

  if (contentType.includes('multipart/form-data')) {
    const boundary = getBoundary(contentType)
    if (!boundary) throw new Error('multipart 请求缺少 boundary')
    const parts = parseMultipart(raw, boundary)
    for (const part of parts) {
      if (part.filename === undefined) {
        body[part.field] = part.data.toString('utf8')
      }
    }
    if (uploadManager) {
      Object.assign(files, await uploadManager.persist(parts, tempPaths))
    }
    return { body, files }
  }

  // 未知类型：原文放 __raw
  body.__raw = raw.toString('utf8')
  return { body, files }
}
