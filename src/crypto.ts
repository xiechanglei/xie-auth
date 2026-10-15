import { scryptSync, randomBytes, createHmac, timingSafeEqual, randomUUID } from 'node:crypto'

const SCRYPT_KEYLEN = 64

/** 生成随机 uuid */
export function uuid(): string {
  return randomUUID()
}

/** 生成随机密钥（hex） */
export function randomSecret(): string {
  return randomBytes(32).toString('hex')
}

/** 用 scrypt 对密码做哈希，返回 `salt:hash` */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex')
  return `${salt}:${hash}`
}

/** 校验密码是否匹配哈希 */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN)
  const expected = Buffer.from(hash, 'hex')
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url')
}

/** token 载荷 */
export interface TokenPayload {
  uid: string
  /** tokenVersion */
  tv: number
  /** issued at (ms) */
  iat: number
  /** expire at (ms) */
  exp: number
}

/** 签发 HMAC 自签 token：`payloadB64.sigB64` */
export function signToken(payload: TokenPayload, secret: string): string {
  const body = base64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  const sig = sign(body, secret)
  return `${body}.${sig}`
}

/** 验签并解析 token；签名不符 / 结构错误返回 null（过期由调用方判定） */
export function verifyToken(token: string, secret: string): TokenPayload | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, sig] = parts
  const expected = sign(body, secret)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const json = Buffer.from(body, 'base64url').toString('utf8')
    const payload = JSON.parse(json) as TokenPayload
    if (typeof payload.uid !== 'string' || typeof payload.tv !== 'number') return null
    return payload
  } catch {
    return null
  }
}
