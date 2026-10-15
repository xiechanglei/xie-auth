import { mkdirSync, renameSync, unlinkSync, statSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve, extname } from 'node:path'
import type { MultipartPart } from './multipart.js'
import type { FilesField, ResolvedUploadConfig, UploadedFile, UploadedFileMeta } from '../types.js'
import { sanitizeFilename } from './multipart.js'
import { uuid } from '../crypto.js'

/** 当天日期目录名 yyyy-MM-dd */
function dateDir(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

/**
 * 上传文件管理：落盘到临时区、提供 keep()/delete()、以及基于 mtime 的过期清理器。
 */
export class UploadManager {
  private config: ResolvedUploadConfig
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(config: ResolvedUploadConfig) {
    this.config = config
    ensureDir(config.dir)
    ensureDir(config.keptDir)
  }

  /** 将 multipart 中的文件部分落盘，返回按字段分组的 UploadedFile */
  persist(parts: MultipartPart[]): FilesField {
    const files: FilesField = {}
    const dir = this.config.dir
    const dayDir = join(dir, dateDir())
    ensureDir(dayDir)

    let count = 0
    for (const part of parts) {
      if (part.filename === undefined) continue // 非文件字段跳过
      count++
      if (count > this.config.maxFiles) {
        throw new Error(`上传文件数量超过上限（${this.config.maxFiles}）`)
      }
      if (part.data.length > this.config.maxSizeBytes) {
        throw new Error(`文件 "${sanitizeFilename(part.filename)}" 超过大小上限`)
      }

      const cleanName = sanitizeFilename(part.filename)
      const ext = extname(cleanName)
      const storedName = `${uuid()}${ext}`
      const filePath = join(dayDir, storedName)

      if (this.config.allowExtensions && this.config.allowExtensions.length > 0) {
        const extNoDot = ext.replace('.', '').toLowerCase()
        if (!this.config.allowExtensions.map((e) => e.toLowerCase().replace('.', '')).includes(extNoDot)) {
          throw new Error(`不允许的文件类型: ${cleanName}`)
        }
      }

      writeFileSync(filePath, part.data)
      const meta: UploadedFileMeta = {
        field: part.field,
        filename: cleanName,
        storedName,
        mimeType: part.contentType,
        size: part.data.length,
        path: resolve(filePath),
      }
      const file = this.wrap(meta)
      if (!files[part.field]) files[part.field] = []
      files[part.field].push(file)
    }
    return files
  }

  /** 包装成带 keep()/delete() 行为的对象 */
  private wrap(meta: UploadedFileMeta): UploadedFile {
    const cfg = this.config
    return {
      ...meta,
      keep(): string {
        const target = join(cfg.keptDir, meta.storedName)
        ensureDir(cfg.keptDir)
        renameSync(meta.path, target)
        return resolve(target)
      },
      delete(): void {
        if (existsSync(meta.path)) unlinkSync(meta.path)
      },
    }
  }

  /**
   * 启动清理器：立即扫一次，然后周期扫描。
   * 只清临时区（keptDir 永久区不动），基于 mtime，ttl=0 时不清理。
   */
  startSweeper(intervalMs = 30 * 60 * 1000): void {
    if (this.config.ttlMs <= 0) return
    if (this.timer) return
    this.sweepOnce()
    this.timer = setInterval(() => this.sweepOnce(), intervalMs)
    // 不阻塞进程退出
    if (typeof this.timer.unref === 'function') this.timer.unref()
  }

  stopSweeper(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 删除临时区中超过 ttl 的文件 */
  sweepOnce(): void {
    if (this.config.ttlMs <= 0) return
    const now = Date.now()
    const root = this.config.dir
    if (!existsSync(root)) return
    for (const entry of readdirSync(root)) {
      const dayPath = join(root, entry)
      let st
      try {
        st = statSync(dayPath)
      } catch {
        continue
      }
      if (!st.isDirectory()) continue
      for (const f of readdirSync(dayPath)) {
        const fp = join(dayPath, f)
        try {
          const fst = statSync(fp)
          if (now - fst.mtimeMs > this.config.ttlMs) unlinkSync(fp)
        } catch {
          // 忽略竞态
        }
      }
    }
  }
}
