/**
 * multipart/form-data 的通用小工具：boundary 提取与文件名净化。
 * 请求体的实际解析由 `multipartStream.ts` 的流式状态机负责（文件边到达边落盘，不全量入内存）。
 */

/** 从 Content-Type 头中提取 boundary */
export function getBoundary(contentType: string): string | null {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  if (!m) return null
  return (m[1] ?? m[2]).trim()
}

/** 净化文件名：去掉路径分隔与控制字符，仅用于展示与扩展名提取 */
export function sanitizeFilename(name: string): string {
  const base = name.replace(/^.*[\\/]/, '')
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f]/g, '').slice(0, 255)
}
