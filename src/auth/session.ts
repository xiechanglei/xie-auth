import type { IncomingMessage, ServerResponse } from 'node:http'
import { signToken, verifyToken } from '../crypto.js'
import type { Store } from '../store.js'
import { toPublicUser } from '../store.js'
import type { PublicUser } from '../types.js'
import { parseCookies, serializeCookie } from '../net/cookie.js'

export const AUTH_COOKIE = 'xie_auth'

export { parseCookies }

/** 为用户签发 token */
export function issueToken(store: Store, userId: string): string {
  const user = store.findById(userId)
  if (!user) throw new Error('用户不存在，无法签发 token')
  const now = Date.now()
  return signToken(
    { uid: user.id, tv: user.tokenVersion, iat: now, exp: now + store.settings.tokenTtl * 1000 },
    store.secret,
  )
}

/** 从 Cookie 或 Authorization: Bearer 中提取 token */
export function extractToken(req: IncomingMessage): string | null {
  const cookies = parseCookies(req)
  if (cookies[AUTH_COOKIE]) return cookies[AUTH_COOKIE]
  const auth = req.headers.authorization
  if (auth && /^bearer /i.test(auth)) return auth.slice(7).trim()
  return null
}

/** 解析当前登录用户：token 有效 + 未过期 + tokenVersion 匹配 + 状态 active */
export function resolveUser(store: Store, req: IncomingMessage): PublicUser | null {
  const token = extractToken(req)
  if (!token) return null
  const payload = verifyToken(token, store.secret)
  if (!payload) return null
  if (payload.exp < Date.now()) return null
  const user = store.findById(payload.uid)
  if (!user) return null
  // 改密 / 停用会使 tokenVersion 变化 → 旧 token 立即失效
  if (user.tokenVersion !== payload.tv) return null
  if (user.status !== 'active') return null
  return toPublicUser(user)
}

/** 设置登录 Cookie（追加式，避免与其他 Set-Cookie 相互覆盖） */
export function setAuthCookie(res: ServerResponse, token: string, ttlSeconds: number): void {
  const secure = false // MVP：如需 HTTPS 可置为 true
  res.appendHeader(
    'Set-Cookie',
    serializeCookie(AUTH_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: ttlSeconds, secure }),
  )
}

/** 清除登录 Cookie */
export function clearAuthCookie(res: ServerResponse): void {
  res.appendHeader('Set-Cookie', serializeCookie(AUTH_COOKIE, '', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 0 }))
}

/** 校验回跳地址：仅允许站内相对路径，防开放重定向 */
export function safeRedirect(redirect: string | undefined): string {
  if (!redirect) return '/'
  if (/^\/(?!\/)/.test(redirect) && !redirect.startsWith('/auth/')) return redirect
  return '/'
}
