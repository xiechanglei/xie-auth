import type { IncomingMessage } from 'node:http'
import { getBoundary } from './multipart.js'
import { MultipartStreamParser, type PartInfo } from './multipartStream.js'
import { UploadManager } from './upload.js'
import type { FilesField, UploadedFile } from '../types.js'

/** 请求体超限错误：携带 statusCode 供出口统一映射为 413 */
export class BodyTooLargeError extends Error {
  readonly statusCode = 413
  constructor(message: string) {
    super(message)
    this.name = 'BodyTooLargeError'
  }
}

/** 给错误附加 HTTP 状态码，供出口统一映射响应 */
function withStatus<T extends Error>(err: T, statusCode: number): T {
  ;(err as T & { statusCode?: number }).statusCode = statusCode
  return err
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

/** 普通（非文件）表单字段的单值上限：字段本应很小，超限视为恶意/误用 */
const FIELD_VALUE_LIMIT = 1024 * 1024 // 1MB

/**
 * 上游读取合并目标：把零碎的 socket chunk 攒到约 256KB 再一次性喂解析器，
 * 摊薄每块的 Buffer.concat 分配、indexOf 扫描、ws.write 与背压往返（与写流 HWM 对齐）。
 */
const COALESCE_TARGET = 256 * 1024

/**
 * 依据 Content-Type 解析请求体。
 * - multipart/form-data：**流式**解析，文件段边到达边写临时文件（增量 md5），整包不驻留内存；
 * - 其余类型：按 limitBytes 缓冲读取后解析。
 * 新创建的临时文件（含中途失败的半成品）绝对路径会 push 进传入的 tempPaths，供调用方 finally 兜底清理。
 */
export async function parseRequestBody(
  req: IncomingMessage,
  limitBytes: number,
  uploadManager: UploadManager | null,
  tempPaths: string[],
): Promise<Payload> {
  const contentType = (req.headers['content-type'] ?? '').toString()

  if (contentType.includes('multipart/form-data')) {
    return parseMultipartStream(req, contentType, uploadManager, tempPaths)
  }

  const body: Record<string, unknown> = {}
  const files: FilesField = {}
  const method = (req.method ?? 'GET').toUpperCase()
  const raw = method === 'GET' || method === 'HEAD' ? Buffer.alloc(0) : await readBody(req, limitBytes)
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

  // 未知类型：原文放 __raw
  body.__raw = raw.toString('utf8')
  return { body, files }
}

/**
 * 流式接收 multipart：驱动 MultipartStreamParser，文件段交给 UploadManager 创建的 sink 落盘，
 * 普通字段攒内存（受 FIELD_VALUE_LIMIT 约束）。解析结束后等待各文件段 finish（刷盘 + 定稿 md5）。
 */
async function parseMultipartStream(
  req: IncomingMessage,
  contentType: string,
  uploadManager: UploadManager | null,
  tempPaths: string[],
): Promise<Payload> {
  const boundary = getBoundary(contentType)
  if (!boundary) throw new Error('multipart 请求缺少 boundary')

  const body: Record<string, unknown> = {}
  const files: FilesField = {}

  // 当前打开段的接收状态
  let curField = ''
  let curSink: ReturnType<UploadManager['createSink']> | null = null
  let fieldChunks: Buffer[] = []
  let fieldLen = 0
  let fileCount = 0
  /** 各文件段的 finish 任务，解析完成后统一 await */
  const finishing: Promise<void>[] = []

  function pushFile(f: UploadedFile): void {
    if (!files[f.field]) files[f.field] = []
    files[f.field].push(f)
  }

  const sink = {
    onPartStart(info: PartInfo): void {
      curField = info.field
      curSink = null
      fieldChunks = []
      fieldLen = 0
      if (info.filename !== undefined) {
        if (!uploadManager) throw withStatus(new Error('未配置 .upload()，不支持文件上传'), 400)
        fileCount++
        if (fileCount > uploadManager.maxFiles) {
          throw withStatus(new Error(`上传文件数量超过上限（${uploadManager.maxFiles}）`), 413)
        }
        curSink = uploadManager.createSink(info, tempPaths)
      }
    },
    onData(chunk: Buffer): void {
      if (curSink) {
        curSink.onData(chunk) // 单文件超限在此抛 413，中止整个解析
      } else {
        fieldLen += chunk.length
        if (fieldLen > FIELD_VALUE_LIMIT) {
          throw withStatus(new Error(`表单字段 "${curField}" 超过大小上限`), 413)
        }
        fieldChunks.push(chunk)
      }
    },
    onPartEnd(): void {
      if (curSink) {
        const s = curSink
        curSink = null
        finishing.push(s.finish().then((f) => pushFile(f)))
      } else {
        body[curField] = Buffer.concat(fieldChunks).toString('utf8')
      }
    },
  }

  const parser = new MultipartStreamParser(boundary, sink)
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      parser.abort()
      // 不 destroy req：req/res 共用同一 socket，销毁会让超限的 413 响应还没写出就 RST。
      // 仅暂停读取（后续 data 受 settled 保护被忽略），由出口 sendJson 写错误后自然关闭连接。
      req.pause()
      reject(err)
    }

    // 合并零碎 chunk：攒到 ~COALESCE_TARGET 再一次性喂解析器，摊薄每块固定开销
    const pending: Buffer[] = []
    let pendingLen = 0
    const flush = (): void => {
      if (settled || pendingLen === 0) return
      const merged = pending.length === 1 ? pending[0] : Buffer.concat(pending, pendingLen)
      pending.length = 0
      pendingLen = 0
      try {
        parser.feed(merged)
      } catch (err) {
        return fail(err as Error)
      }
      // 背压：当前段为文件且写流积压超水位 → 暂停读取，排空后恢复（在途数据上界≈水位线+一个合并块，恒定）
      const sinkRef = curSink
      if (sinkRef && !sinkRef.drained) {
        req.pause()
        sinkRef.whenDrained().then(() => {
          if (settled) return
          // 恢复前复查：若写流已出错（磁盘写失败等），以干净错误中止而非挂起
          if (sinkRef.hasError()) return fail(sinkRef.getError() ?? new Error('临时文件写入失败'))
          req.resume()
        })
      }
    }

    req.on('data', (chunk: Buffer) => {
      if (settled) return
      pending.push(chunk)
      pendingLen += chunk.length
      if (pendingLen >= COALESCE_TARGET) flush()
    })
    req.on('end', () => {
      if (settled) return
      flush() // 先把残余合并块喂完
      if (settled) return // flush 内可能已 fail
      try {
        parser.finish()
      } catch (err) {
        return fail(err as Error)
      }
      settled = true
      resolve()
    })
    req.on('error', (err: Error) => fail(err))
  })

  // 等待所有文件段刷盘定稿（含 md5），填充 ctx.files
  await Promise.all(finishing)
  return { body, files }
}
