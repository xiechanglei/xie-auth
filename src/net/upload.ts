import { mkdirSync, renameSync, unlinkSync, statSync, existsSync, readdirSync, copyFileSync, createWriteStream } from 'node:fs'
import type { WriteStream } from 'node:fs'
import { once } from 'node:events'
import { createHash, type Hash } from 'node:crypto'
import { join, resolve, extname, dirname, sep } from 'node:path'
import type { PartInfo } from './multipartStream.js'
import type { ResolvedUploadConfig, UploadedFile, UploadedFileMeta } from '../types.js'
import { sanitizeFilename } from './multipart.js'
import { uuid } from '../crypto.js'

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

/** 给错误附加 HTTP 状态码，供出口统一映射响应 */
function withStatus<T extends Error>(err: T, statusCode: number): T {
  ;(err as T & { statusCode?: number }).statusCode = statusCode
  return err
}

/** 移动文件，跨设备（EXDEV）回退为复制 + 删除 */
function moveFile(from: string, to: string): void {
  try {
    renameSync(from, to)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      copyFileSync(from, to)
      unlinkSync(from)
    } else {
      throw err
    }
  }
}

/**
 * 流式接收单个上传文件：创建即打开临时文件与增量 MD5，
 * 数据按到达顺序同步追加写盘，内存占用与文件大小无关。
 * 任何失败（超限 / 截断 / 写盘错误）都会销毁写流并删除半成品，由 tempPaths 兜底清理。
 */
class FileSink {
  private readonly ws: WriteStream
  private readonly hash: Hash
  /** 元信息留待 finish 时组装 */
  private readonly meta0: Omit<UploadedFileMeta, 'size' | 'md5' | 'uploadTime'>
  private received = 0
  private readonly maxSize: number
  private readonly absPath: string
  private closed = false
  /** 写流内部缓冲已满（write 返回 false），需暂停上游读取直到 drain */
  private backpressured = false
  /** 异步写错误（提前捕获，避免无监听时抛未处理异常 / writev-after-destroyed） */
  private writeError: Error | null = null

  constructor(info: { dir: string; storedName: string; field: string; filename: string; mimeType: string }, maxSize: number, tempPaths: string[]) {
    this.maxSize = maxSize
    const filePath = join(info.dir, info.storedName)
    this.absPath = resolve(filePath)
    tempPaths.push(this.absPath) // 创建即登记，中途失败同样能被清理
    this.ws = createWriteStream(filePath)
    this.hash = createHash('md5')
    this.meta0 = { ...info, path: this.absPath }
    // 提前挂 error：大文件写入中途的磁盘/句柄错误在此捕获，后续 onData 抛出以干净中止
    this.ws.on('error', (err: Error) => {
      if (!this.writeError) this.writeError = err
    })
  }

  /** 超限抛带 statusCode 413 的错误，由解析器中止整个请求 */
  onData(chunk: Buffer): void {
    if (this.writeError) throw this.writeError
    if (this.ws.destroyed) throw this.writeError ?? new Error('临时文件写入已中断')
    this.received += chunk.length
    if (this.received > this.maxSize) {
      this.discard()
      throw withStatus(new Error(`文件 "${this.meta0.filename}" 超过大小上限`), 413)
    }
    this.hash.update(chunk)
    // 返回值 false 表示写流缓冲已满：置背压位，由上游暂停读取，杜绝无界内存排队与 writev-after-destroyed
    if (!this.ws.write(chunk)) this.backpressured = true
  }

  /** 是否可继续接收下一个 chunk（无背压且流未损坏） */
  get drained(): boolean {
    return !this.backpressured && !this.ws.destroyed && this.writeError === null
  }

  /** 等待写流排空；出错 / 关闭同样返回，避免上游永久挂起 */
  whenDrained(): Promise<void> {
    if (!this.backpressured) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const done = (): void => {
        this.backpressured = false
        // 三个 once 监听都要显式摘除：大文件反复背压时若残留会累积触发 MaxListeners 泄漏
        this.ws.removeListener('drain', done)
        this.ws.removeListener('error', done)
        this.ws.removeListener('close', done)
        resolve()
      }
      this.ws.once('drain', done)
      this.ws.once('error', done)
      this.ws.once('close', done)
    })
  }

  /** 是否已发生异步写错误 / 流被销毁（供上游恢复读取前判定） */
  hasError(): boolean {
    return this.writeError !== null || this.ws.destroyed
  }

  getError(): Error | null {
    return this.writeError
  }

  /** 收尾：等待刷盘后返回可直接放进 ctx.files 的文件对象 */
  async finish(): Promise<UploadedFile> {
    if (this.closed) throw new Error('文件段已结束')
    this.closed = true
    if (this.writeError) throw this.writeError
    if (this.ws.destroyed) throw this.writeError ?? new Error('临时文件写入失败')
    this.ws.end()
    // 磁盘错误时 'finish' 不触发而触发 'error'，两者竞速后以 error 优先
    await Promise.race([
      once(this.ws, 'finish'),
      once(this.ws, 'error').then((args) => Promise.reject(args[0] as Error)),
    ])
    const meta: UploadedFileMeta = {
      ...this.meta0,
      size: this.received,
      md5: this.hash.digest('hex'),
      uploadTime: Date.now(),
    }
    return wrapFile(meta)
  }

  /** 中止：销毁写流并删除半成品 */
  discard(): void {
    this.closed = true
    try {
      this.ws.destroy()
    } catch {
      /* 忽略 */
    }
  }
}

/**
 * 上传文件管理（临时暂存区模型，类 Spring MultipartFile）：
 * - 请求体流式解析，文件段按到达顺序写入 config.dir 临时区（同时增量算 md5），
 *   handler 期间拿到含 md5/size/uploadTime 的文件对象；
 * - 需保留时通过 file.transferTo(dest) 转存到正式位置（移出临时区）；
 * - 请求结束后由 cleanupTemp 删除未被转存的临时文件（含中途失败的半成品）；
 * - 服务启动时 purgeStale() 清空临时区，回收上次崩溃 / 重启遗留的孤儿文件。
 */
export class UploadManager {
  private config: ResolvedUploadConfig
  private allowSet: Set<string> | null

  constructor(config: ResolvedUploadConfig) {
    this.config = config
    ensureDir(config.dir)
    this.allowSet =
      config.allowExtensions && config.allowExtensions.length > 0
        ? new Set(config.allowExtensions.map((e) => e.toLowerCase().replace('.', '')))
        : null
  }

  /** 单次请求允许的文件数上限（供解析器在创建 sink 前拦截） */
  get maxFiles(): number {
    return this.config.maxFiles
  }

  /**
   * 为 multipart 中的一个文件段创建落盘接收器（校验在创建前完成，不合法直接抛错不出盘）。
   * 字段序号计数、files 分组由调用方（parseRequestBody）负责。
   */
  createSink(info: PartInfo, tempPaths: string[]): FileSink {
    if (info.filename === undefined) throw new Error('非文件段不应创建 Sink')
    if (this.allowSet) {
      const extNoDot = extname(sanitizeFilename(info.filename)).replace('.', '').toLowerCase()
      if (!this.allowSet.has(extNoDot)) {
        throw withStatus(new Error(`不允许的文件类型: ${sanitizeFilename(info.filename)}`), 400)
      }
    }
    const cleanName = sanitizeFilename(info.filename)
    const storedName = `${uuid()}${extname(cleanName)}`
    return new FileSink(
      { dir: this.config.dir, storedName, field: info.field, filename: cleanName, mimeType: info.contentType },
      this.config.maxSizeBytes,
      tempPaths,
    )
  }

  /**
   * 服务启动时清空临时暂存区：逐个删除 dir 下的普通文件（保留子目录，避免误删）。
   * 回收上一次进程崩溃 / 重启时未来得及清理的孤儿临时文件。
   */
  purgeStale(): void {
    const root = this.config.dir
    if (!existsSync(root)) {
      ensureDir(root)
      return
    }
    for (const entry of readdirSync(root)) {
      const fp = join(root, entry)
      try {
        if (statSync(fp).isFile()) unlinkSync(fp)
      } catch {
        // 忽略竞态 / 权限问题
      }
    }
  }

  /** 请求结束后清理：删除仍存在的临时文件（已被 transferTo 移走的自然跳过） */
  static cleanupTemp(tempPaths: string[]): void {
    for (const p of tempPaths) {
      try {
        if (existsSync(p)) unlinkSync(p)
      } catch {
        // 忽略竞态
      }
    }
  }
}

/** 包装成带 transferTo 行为的文件对象 */
function wrapFile(meta: UploadedFileMeta): UploadedFile {
  return {
    ...meta,
    transferTo(dest: string): string {
      const finalPath = resolveDest(meta, dest)
      ensureDir(dirname(finalPath))
      moveFile(meta.path, finalPath)
      return finalPath
    },
  }
}

/** 解析 transferTo 目标：目录→用原始文件名落入；否则视为确切文件路径 */
function resolveDest(meta: UploadedFileMeta, dest: string): string {
  const looksDir = dest.endsWith('/') || dest.endsWith(sep)
  const abs = resolve(dest)
  if (looksDir) return join(abs, meta.filename || meta.storedName)
  let isDir = false
  try {
    isDir = statSync(abs).isDirectory()
  } catch {
    isDir = false
  }
  return isDir ? join(abs, meta.filename || meta.storedName) : abs
}
