/**
 * 流式 multipart/form-data 解析器（增量状态机，零依赖）。
 *
 * 每次只消化「已到达的 chunk」：文件段通过 sink 回调即时写出（典型去向：临时文件追加 + 增量 md5），
 * 内存中任何时刻仅驻留当前 chunk 与一段不足以确认分隔符的尾部（约一个分隔符长度），
 * 因此内存占用与上传文件大小无关。
 *
 * 边界判定遵循 RFC 2046：分隔符必须前置 \r\n（报文起始处允许省略），
 * 其后跟 `--` 表示结束、跟 `\r\n` 表示下一段；被 chunk 劈开的半截分隔符通过尾部保留窗口在下一个 chunk 中重扫确认。
 */

/** 解析出的单个段头部信息 */
export interface PartInfo {
  field: string
  filename?: string
  contentType: string
}

/** 状态机对外的数据出口（同步接口；抛错即中止解析） */
export interface MultipartSink {
  /** 段头部解析完成、数据到来前调用 */
  onPartStart(info: PartInfo): void
  /** 当前段数据，按到达顺序推送 */
  onData(chunk: Buffer): void
  /** 当前段数据结束（下一分隔符确认时调用） */
  onPartEnd(): void
}

/** 单段头部总量上限（防恶意超长头） */
const HEADER_LIMIT = 16 * 1024
/** 单行头部上限（防超长 filename 的 base64 滥用等） */
const LINE_LIMIT = 8 * 1024

/** 解析段头部文本；缺 name 或单行超限返回 null（由调用方判错） */
function parsePartHeader(text: string): PartInfo | null {
  let field: string | undefined
  let filename: string | undefined
  let contentType = 'application/octet-stream'
  for (const line of text.split('\r\n')) {
    if (line.length > LINE_LIMIT) return null
    if (/^content-disposition:/i.test(line)) {
      const nameMatch = /;\s*name="([^"]*)"/i.exec(line)
      if (nameMatch) field = nameMatch[1]
      // 优先匹配 filename*（RFC 5987），再回退普通 filename
      const starMatch = /;\s*filename\*="[^']*'([^']*)'/i.exec(line)
      const fileMatch = /;\s*filename="([^"]*)"/i.exec(line)
      if (starMatch) filename = decodeURIComponent(starMatch[1])
      else if (fileMatch) filename = fileMatch[1]
    } else if (/^content-type:/i.test(line)) {
      contentType = line.slice(line.indexOf(':') + 1).trim()
    }
  }
  if (field === undefined) return null
  return { field, filename, contentType }
}

type State = 'preamble' | 'headers' | 'body' | 'epilogue'

export class MultipartStreamParser {
  /** 分隔符行标记：--boundary（真分隔符须前置 \r\n，或位于报文最开头） */
  private readonly token: Buffer

  private state: State = 'preamble'
  /** 待消化数据；消化后仅保留可能需要跨界重扫的尾部 */
  private buf: Buffer = Buffer.alloc(0)
  /** buf 内的下一次扫描起点（已确认安全的字节不重复扫描） */
  private scanPos = 0
  /** 当前段是否打开（body 态下收到过 onPartStart 且未 onPartEnd） */
  private partOpen = false
  /** 尚未越过首个分隔符（报文起始处的分隔符允许无前置 \r\n） */
  private atStart = true
  /** 解析已中止（外部错误后拒绝继续喂数据） */
  private aborted = false

  private readonly sink: MultipartSink

  constructor(boundary: string, sink: MultipartSink) {
    this.token = Buffer.from(`--${boundary}`)
    this.sink = sink
  }

  /** 喂入一个 chunk；内部循环消化直到数据不足以继续 */
  feed(chunk: Buffer): void {
    if (this.aborted) throw new Error('解析已中止')
    if (this.state === 'epilogue') return // 结束分隔符之后的字节（epilogue）一律忽略
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk])
    this.drain()
  }

  /** 上游流正常结束时调用：未到结束分隔符视为报文截断 */
  finish(): void {
    if (this.aborted) return
    if (this.state !== 'epilogue') throw new Error('multipart 报文不完整（未找到结束分隔符）')
  }

  /** 主动中止（出错清理时），后续 feed/finish 均不再动作 */
  abort(): void {
    this.aborted = true
    this.buf = Buffer.alloc(0)
  }

  // ---- 内部实现 ----

  private drain(): void {
    for (;;) {
      if (this.state === 'headers') {
        if (!this.drainHeaders()) return
        continue
      }
      // preamble / body：寻找分隔符标记 --boundary
      const p = this.buf.indexOf(this.token, this.scanPos)
      if (p === -1) {
        // 无候选：发出安全前缀，保留「前置 \r\n + 最长半截 token」窗口等待下一 chunk
        this.emitHold(Math.max(this.buf.length - (this.token.length + 2), 0))
        return
      }

      // 校验 p 处是否为真正的分隔符行起点
      let dataEnd: number
      if (p === 0 && this.atStart) {
        dataEnd = 0 // 报文起始的首分隔符，之前无内容
      } else if (p >= 2 && this.buf[p - 2] === 0x0d && this.buf[p - 1] === 0x0a) {
        dataEnd = p - 2 // 前置 \r\n 属于协议（数据行结束符），不计入段数据
      } else {
        // 内容中误现 --boundary（前面不是行首）：跳过 1 字节继续找
        this.scanPos = p + 1
        continue
      }

      // 检查分隔符之后的 2 字节：'--' 结束 / \r\n 下一段 / 其他为误命中
      const after = p + this.token.length
      if (this.buf.length < after + 2) {
        // 确认字节还没收全：发出 [0, dataEnd) 的数据，保留分隔符起头等待下一 chunk
        this.emitData(dataEnd)
        return
      }
      const a = this.buf[after]
      const b = this.buf[after + 1]
      let close: boolean
      if (a === 0x2d && b === 0x2d) close = true // --boundary-- 结束
      else if (a === 0x0d && b === 0x0a) close = false // --boundary\r\n 下一段
      else {
        // 误命中（如文件内容包含 --boundaryXxx 且恰好行首）：跳过 token 继续
        this.scanPos = after
        this.atStart = false
        continue
      }

      // 分隔符确认：当前段数据到 dataEnd 结束
      this.emitData(dataEnd) // 注意：dataEnd>0 时 buf 已前移 dataEnd 字节
      if (this.state === 'body' && this.partOpen) {
        this.sink.onPartEnd()
        this.partOpen = false
      }
      // 前进到 token 之后（保留其后的 \r\n 交 headers 处理）
      // after 是相对 emitData 之前的原始 buf，buf 已被前移 dataEnd，故此处需扣减
      this.buf = this.buf.subarray(after - dataEnd)
      this.scanPos = 0
      this.atStart = false

      if (close) {
        this.state = 'epilogue'
        this.buf = Buffer.alloc(0)
        return
      }
      this.state = 'headers'
    }
  }

  /** 消化头部文本直至 \r\n\r\n；成功返回 true（切到 body 态并回调 onPartStart） */
  private drainHeaders(): boolean {
    const sep = this.buf.indexOf('\r\n\r\n', this.scanPos)
    if (sep === -1) {
      if (this.buf.length > HEADER_LIMIT) throw new Error('multipart 段头部超长')
      this.scanPos = Math.max(this.buf.length - 3, 0)
      return false
    }
    const info = parsePartHeader(this.buf.subarray(0, sep).toString('utf8'))
    if (!info) throw new Error('multipart 段缺少 content-disposition/name 或头部行超长')
    this.buf = this.buf.subarray(sep + 4)
    this.scanPos = 0
    this.state = 'body'
    this.partOpen = true
    this.sink.onPartStart(info)
    return true
  }

  /** 把 buf 前 n 字节作为当前段数据发出并移除（preamble 态丢弃）；不改动分隔符起头 */
  private emitData(n: number): void {
    if (n <= 0) return
    if (this.state === 'body' && this.partOpen) this.sink.onData(this.buf.subarray(0, n))
    this.buf = this.buf.subarray(n)
    this.scanPos = 0
  }

  /** 发出前 keepFrom 字节、保留 [keepFrom, end) 作为跨界窗口 */
  private emitHold(keepFrom: number): void {
    this.emitData(keepFrom)
  }
}
