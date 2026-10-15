/**
 * 基于完整 Buffer 的 multipart/form-data 解析（MVP：请求体已在内存中并受上限约束）。
 * 相比流式解析实现更简单、边界更可控；文件由调用方落盘。
 */

export interface MultipartPart {
  field: string
  /** 有 filename 视为文件 */
  filename?: string
  contentType: string
  data: Buffer
}

/** 从 Content-Type 头中提取 boundary */
export function getBoundary(contentType: string): string | null {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  if (!m) return null
  return (m[1] ?? m[2]).trim()
}

function parseDisposition(header: string): { name?: string; filename?: string } {
  const result: { name?: string; filename?: string } = {}
  const nameMatch = /;\s*name="([^"]*)"/i.exec(header)
  if (nameMatch) result.name = nameMatch[1]
  // 优先匹配 filename*（RFC 5987），再回退普通 filename
  const starMatch = /;\s*filename\*="[^']*'([^']*)'/i.exec(header)
  const fileMatch = /;\s*filename="([^"]*)"/i.exec(header)
  if (starMatch) result.filename = decodeURIComponent(starMatch[1])
  else if (fileMatch) result.filename = fileMatch[1]
  return result
}

/** 解析 multipart 请求体 */
export function parseMultipart(body: Buffer, boundary: string): MultipartPart[] {
  const parts: MultipartPart[] = []
  const delimiter = Buffer.from(`--${boundary}`)
  const closeDelimiter = Buffer.from(`--${boundary}--`)

  // 定位所有分隔符出现的位置
  const positions: number[] = []
  let from = 0
  for (;;) {
    const idx = body.indexOf(delimiter, from)
    if (idx === -1) break
    positions.push(idx)
    from = idx + delimiter.length
    // 命中结束分隔符则停止
    if (body.slice(idx, idx + closeDelimiter.length).equals(closeDelimiter)) break
  }

  for (let i = 0; i < positions.length - 1; i++) {
    const start = positions[i] + delimiter.length
    // 跳过可能的 \r\n
    let cursor = start
    if (body[cursor] === 0x0d && body[cursor + 1] === 0x0a) cursor += 2
    const end = positions[i + 1]
    // part 内容 = [cursor, end)，末尾去掉 \r\n
    const rawEnd = end - 2 >= cursor ? end - 2 : end
    const segment = body.subarray(cursor, rawEnd)

    // 分离 header 与 body（\r\n\r\n）
    const sep = segment.indexOf('\r\n\r\n')
    if (sep === -1) continue
    const headerText = segment.subarray(0, sep).toString('utf8')
    const data = segment.subarray(sep + 4)

    // 解析头部
    let field = ''
    let filename: string | undefined
    let contentType = 'application/octet-stream'
    for (const line of headerText.split('\r\n')) {
      if (/^content-disposition:/i.test(line)) {
        const d = parseDisposition(line)
        field = d.name ?? ''
        filename = d.filename
      } else if (/^content-type:/i.test(line)) {
        contentType = line.slice(line.indexOf(':') + 1).trim()
      }
    }

    if (!field) continue
    parts.push({ field, filename, contentType, data })
  }

  return parts
}

/** 净化文件名：去掉路径分隔与控制字符，仅用于展示与扩展名提取 */
export function sanitizeFilename(name: string): string {
  const base = name.replace(/^.*[\\/]/, '')
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f]/g, '').slice(0, 255)
}
