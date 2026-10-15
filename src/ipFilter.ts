import type { IncomingMessage } from 'node:http'
import type { Settings } from './types.js'

/** 取客户端 IP：默认用 socket 地址；trustProxy 时才参考 X-Forwarded-For */
export function getClientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for']
    if (xff) {
      const first = (Array.isArray(xff) ? xff[0] : xff).split(',')[0].trim()
      if (first) return normalizeIp(first)
    }
  }
  return normalizeIp(req.socket.remoteAddress ?? '')
}

/** 去掉 IPv4 映射前缀（::ffff:1.2.3.4 → 1.2.3.4） */
export function normalizeIp(ip: string): string {
  const m = /^::ffff:(.+)$/i.exec(ip)
  return m ? m[1] : ip
}

function ipv4ToLong(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let result = 0
  for (const p of parts) {
    const n = Number(p)
    if (!Number.isInteger(n) || n < 0 || n > 255) return null
    result = (result << 8) | n
  }
  return result >>> 0
}

/** 判断 ip 是否匹配某条规则：精确相等 或 落在 CIDR 内 */
export function ipMatches(ip: string, entry: string): boolean {
  const target = normalizeIp(ip)
  if (entry.includes('/')) {
    const [range, bitsStr] = entry.split('/')
    const bits = Number(bitsStr)
    const a = ipv4ToLong(target)
    const b = ipv4ToLong(range)
    if (a === null || b === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false
    const mask = bits === 0 ? 0 : (~((1 << (32 - bits)) - 1)) >>> 0
    return (a & mask) === (b & mask)
  }
  return target === normalizeIp(entry)
}

/** 依据 settings 判定该 IP 是否允许访问 */
export function isIpAllowed(ip: string, settings: Settings): boolean {
  if (settings.ipMode === 'off') return true
  const matched = settings.ipList.some((entry) => entry.trim() && ipMatches(ip, entry.trim()))
  if (settings.ipMode === 'blacklist') return !matched // 命中黑名单 → 拒绝
  if (settings.ipMode === 'whitelist') return matched // 白名单：仅命中才允许
  return true
}
