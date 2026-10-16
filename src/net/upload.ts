import { mkdirSync, renameSync, unlinkSync, statSync, existsSync, readdirSync, copyFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve, extname, dirname, sep } from 'node:path'
import type { MultipartPart } from './multipart.js'
import type { FilesField, ResolvedUploadConfig, UploadedFile, UploadedFileMeta } from '../types.js'
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
 * 上传文件管理（临时暂存区模型，类 Spring MultipartFile）：
 * - 落盘到 config.dir 临时区，handler 期间拿到含 md5/size/uploadTime 的文件对象；
 * - 需保留时通过 file.transferTo(dest) 转存到正式位置（移出临时区）；
 * - 请求结束后由 cleanupTemp 删除未被转存的临时文件；
 * - 服务启动时 purgeStale() 清空临时区，回收上次崩溃 / 重启遗留的孤儿文件。
 */
export class UploadManager {
  private config: ResolvedUploadConfig

  constructor(config: ResolvedUploadConfig) {
    this.config = config
    ensureDir(config.dir)
  }

  /** 将 multipart 中的文件部分落盘；按字段分组返回，同时把创建的临时路径 push 进 tempPaths（供调用方兜底清理）。异步写盘，避免大文件同步 I/O 阻塞事件循环 */
  async persist(parts: MultipartPart[], tempPaths: string[]): Promise<FilesField> {
    const files: FilesField = {}
    const dir = this.config.dir
    ensureDir(dir)

    // 允许扩展名集合只算一次（而不是每个 part 重复 map）
    const allowSet =
      this.config.allowExtensions && this.config.allowExtensions.length > 0
        ? new Set(this.config.allowExtensions.map((e) => e.toLowerCase().replace('.', '')))
        : null

    let count = 0
    for (const part of parts) {
      if (part.filename === undefined) continue // 非文件字段跳过
      count++
      if (count > this.config.maxFiles) {
        throw withStatus(new Error(`上传文件数量超过上限（${this.config.maxFiles}）`), 413)
      }
      if (part.data.length > this.config.maxSizeBytes) {
        throw withStatus(new Error(`文件 "${sanitizeFilename(part.filename)}" 超过大小上限`), 413)
      }

      const cleanName = sanitizeFilename(part.filename)
      const ext = extname(cleanName)
      const storedName = `${uuid()}${ext}`
      const filePath = join(dir, storedName)

      if (allowSet) {
        const extNoDot = ext.replace('.', '').toLowerCase()
        if (!allowSet.has(extNoDot)) {
          throw withStatus(new Error(`不允许的文件类型: ${cleanName}`), 400)
        }
      }

      // 异步写盘（不阻塞事件循环）+ 基于内存缓冲算 md5：数据已在内存，无额外二次读盘
      await writeFile(filePath, part.data)
      const absTemp = resolve(filePath)
      tempPaths.push(absTemp)
      const md5 = createHash('md5').update(part.data).digest('hex')

      const meta: UploadedFileMeta = {
        field: part.field,
        filename: cleanName,
        storedName,
        mimeType: part.contentType,
        size: part.data.length,
        md5,
        uploadTime: Date.now(),
        path: absTemp,
      }
      const file = this.wrap(meta)
      if (!files[part.field]) files[part.field] = []
      files[part.field].push(file)
    }
    return files
  }

  /** 包装成带 transferTo 行为的文件对象 */
  private wrap(meta: UploadedFileMeta): UploadedFile {
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
