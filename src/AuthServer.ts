import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, statSync, createReadStream, readFileSync } from 'node:fs'
import { join, resolve, normalize, dirname } from 'node:path'
import { homedir } from 'node:os'
import type {
  Access,
  Ctx,
  GuardRule,
  Handler,
  Route,
  UserRole,
  UserStatus,
  BufferResponse,
  FileResponse,
  HtmlResponse,
  TextResponse,
  ViewResponse,
} from './types.js'
import { RAW_RESPONSE } from './types.js'
import { Store, toPublicUser } from './store.js'
import { hashPassword, verifyPassword } from './crypto.js'
import { normalizeMethods, compilePath, findRoute, globToRegExp } from './router.js'
import { parseQuery, parseRequestBody } from './net/request.js'
import { sendJson, sendHtml, sendRedirect, wrapResult, isRawResponse, sendRawResponse, guessContentType } from './net/response.js'
import type { ResponseDefaults } from './net/response.js'
import { parseCookies, serializeCookie } from './net/cookie.js'
import { renderTemplate } from './net/template.js'
import { UploadManager } from './net/upload.js'
import { getClientIp, isIpAllowed } from './ipFilter.js'
import {
  issueToken,
  resolveUser,
  setAuthCookie,
  clearAuthCookie,
  safeRedirect,
} from './auth/session.js'
import { loginPage, registerPage, managerPage } from './auth/pages.js'
import { guardScript } from './auth/guardScript.js'
import { parseSize } from './util.js'
import type { ResolvedUploadConfig, UploadOptions } from './types.js'

const DEFAULT_STORE = join(homedir(), '.xie-auth', 'users.json')
const DEFAULT_PORT = 3333
const DEFAULT_JSON_LIMIT = 1024 * 1024 // 1MB

/**
 * 入口文件所在目录：`node /path/to/app.js` → `/path/to`。
 * 用于把默认静态目录定位到入口文件同级的 public。
 * （取 process.argv[1]，而非 process.cwd()；REPL / -e 等场景回退到 cwd）
 */
function entryDir(): string {
  const script = process.argv[1]
  return script ? dirname(resolve(script)) : process.cwd()
}

const DEFAULT_STATIC = join(entryDir(), 'public')

interface GuardCompiled extends GuardRule {
  regex: RegExp
}

/** 内置 /auth 相关内容的默认路由，在 serve 时注入 */
export class AuthServer {
  private storePath = DEFAULT_STORE
  private staticDir = DEFAULT_STATIC
  private viewsDir: string | null = null
  private pageTitle = 'xie-auth'
  private uploadOpts: { dir: string; opts?: UploadOptions } | null = null
  private routes: Route[] = []
  private guards: GuardCompiled[] = []

  private server: Server | null = null
  private store: Store | null = null
  private uploadManager: UploadManager | null = null
  private uploadConfig: ResolvedUploadConfig | null = null

  // ---- 链式配置 ----
  userStore(filePath: string): this {
    this.storePath = filePath
    return this
  }

  static(dirPath: string): this {
    this.staticDir = dirPath
    return this
  }

  /** 视图模板目录（sendView 从此读模板）；不配则默认复用 static 目录 */
  views(dirPath: string): this {
    this.viewsDir = dirPath
    return this
  }

  /** 内置页面标题（登录/注册/管理台），默认 xie-auth */
  title(text: string): this {
    this.pageTitle = text || 'xie-auth'
    return this
  }

  /** 上传落盘目录配置（dirPath 无默认值，未配置则不启用文件上传） */
  upload(dirPath: string, opts?: UploadOptions): this {
    this.uploadOpts = { dir: dirPath, opts }
    return this
  }

  use(path: string, method?: string | Handler, handler?: Handler): this {
    return this.addRoute('public', path, method, handler)
  }

  useAuth(path: string, method?: string | Handler, handler?: Handler): this {
    return this.addRoute('auth', path, method, handler)
  }

  useAdmin(path: string, method?: string | Handler, handler?: Handler): this {
    return this.addRoute('admin', path, method, handler)
  }

  authGuard(pattern: string, opts?: { role?: UserRole }): this {
    this.guards.push({ pattern, role: opts?.role, regex: globToRegExp(pattern) })
    return this
  }

  private addRoute(access: Access, path: string, method?: string | Handler, handler?: Handler): this {
    const m = typeof method === 'function' ? undefined : method
    const h = (typeof method === 'function' ? method : handler) as Handler
    if (!h) throw new Error(`路由 ${path} 缺少 handler`)
    const { matcher, paramNames } = compilePath(path)
    this.routes.push({ rawPath: path, methods: normalizeMethods(m), handler: h, access, matcher, paramNames })
    return this
  }

  // ---- 生命周期 ----
  serve(port = DEFAULT_PORT): this {
    if (this.server) throw new Error('服务已在运行，请先 stop()')

    this.store = new Store(this.storePath)
    if (this.uploadOpts) {
      this.uploadConfig = this.resolveUpload(this.uploadOpts)
      this.uploadManager = new UploadManager(this.uploadConfig)
      // 启动时清空临时暂存区，回收上次崩溃 / 重启遗留的孤儿文件
      this.uploadManager.purgeStale()
    } else {
      this.uploadConfig = null
      this.uploadManager = null
    }
    this.registerBuiltinRoutes()

    const handler = (req: IncomingMessage, res: ServerResponse) => {
      this.dispatch(req, res).catch((err: Error) => {
        if (!res.headersSent) sendJson(res, 500, { success: false, message: err.message, data: null })
        else res.end()
      })
    }
    this.server = createServer(handler)
    this.server.listen(port)

    console.log('[xie-auth] 服务已启动')
    console.log('  title     :', this.pageTitle)
    console.log('  userStore :', resolve(this.storePath))
    console.log('  static    :', resolve(this.staticDir))
    console.log('  views     :', this.viewsDir ? resolve(this.viewsDir) : '(未配置，sendView 复用 static)')
    console.log('  upload    :', this.uploadOpts ? resolve(this.uploadOpts.dir) : '(未配置)')
    console.log('  port      :', port)
    return this
  }

  stop(): void {
    if (this.server) {
      this.server.close()
      this.server = null
    }
  }

  private resolveUpload(cfg: { dir: string; opts?: UploadOptions }): ResolvedUploadConfig {
    const o = cfg.opts ?? {}
    return {
      dir: resolve(cfg.dir),
      maxSizeBytes: o.maxSize !== undefined ? parseSize(o.maxSize) : parseSize('10MB'),
      allowExtensions: o.allowExtensions ?? null,
      maxFiles: o.maxFiles ?? 10,
    }
  }

  // ---- 请求分发 ----
  private async dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const store = this.store!
    const url = req.url ?? '/'
    const pathname = url.split('?')[0]
    const method = (req.method ?? 'GET').toUpperCase()

    // 1) IP 网关（含 /auth/ 自身）
    const ip = getClientIp(req, store.settings.trustProxy)
    if (!isIpAllowed(ip, store.settings)) {
      sendJson(res, 403, { success: false, message: 'Forbidden', data: null })
      return
    }

    // 2) /auth 页面与脚本（库自有）
    if (this.handleAuthAssets(req, pathname, res, store)) return

    // 3) 声明式守卫：命中且未登录/角色不符 → 跳登录
    const user = resolveUser(store, req)
    for (const g of this.guards) {
      if (g.regex.test(pathname)) {
        if (!user) {
          sendRedirect(res, `/auth/login.html?redirect=${encodeURIComponent(pathname)}`)
          return
        }
        if (g.role && user.role !== g.role) {
          sendJson(res, 403, { success: false, message: 'Forbidden', data: null })
          return
        }
        break
      }
    }

    // 4) 业务 / 内置 API 路由
    const found = findRoute(this.routes, pathname, method)
    if (found) {
      if (found.route.access !== 'public' && !user) {
        sendJson(res, 401, { success: false, message: 'Unauthorized', data: null })
        return
      }
      if (found.route.access === 'admin' && user?.role !== 'admin') {
        sendJson(res, 403, { success: false, message: 'Forbidden', data: null })
        return
      }
      await this.runHandler(found.route, found.params, req, res, method, url, user)
      return
    }

    // 5) 静态资源（仅 GET/HEAD，不鉴权）
    if (method === 'GET' || method === 'HEAD') {
      if (this.serveStatic(pathname, res, method)) return
    }

    // 6) 404
    sendJson(res, 404, { success: false, message: 'Not Found', data: null })
  }

  private async runHandler(
    route: Route,
    params: Record<string, string>,
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    url: string,
    user: Ctx['user'],
  ): Promise<void> {
    // 请求体上限：multipart 走流式解析（文件边到达边落盘，单文件受 maxSize 约束），
    // limitBytes 仅对非 multipart（JSON / form）的缓冲读取生效，固定用 json 上限。
    const limit = DEFAULT_JSON_LIMIT
    // 本次请求落盘的临时文件（transferTo 会移走；未被转存的在 finally 中清理）
    const tempPaths: string[] = []
    // ctx 层累积的响应默认值：无论 return 数据还是 send*，出口统一应用
    const defaults: ResponseDefaults = { headers: {}, cookies: [], append: {} }
    try {
      const { body, files } = await parseRequestBody(req, limit, this.uploadManager, tempPaths)
      const ctx: Ctx = {
        params,
        query: parseQuery(url),
        body,
        files,
        method,
        path: route.rawPath,
        user,
        req,
        res,
        get cookies() {
          return parseCookies(req)
        },
        status: (code) => {
          defaults.status = code
        },
        set: (name, value) => {
          if (typeof name === 'string') {
            if (value !== undefined) defaults.headers![name] = value
          } else {
            Object.assign(defaults.headers!, name)
          }
        },
        append: (name, value) => {
          ;(defaults.append![name] ??= []).push(value)
        },
        get: (name) => {
          const v = req.headers[name.toLowerCase()]
          return Array.isArray(v) ? v[0] : v
        },
        cookie: (name, value, opts) => {
          defaults.cookies!.push(serializeCookie(name, value, opts))
        },
        clearCookie: (name, opts) => {
          defaults.cookies!.push(serializeCookie(name, '', { ...opts, maxAge: 0 }))
        },
        sendFile: (filePath, opts) =>
          ({ [RAW_RESPONSE]: true, kind: 'file', filePath, ...opts } as unknown as FileResponse),
        sendHtml: (html, opts) => ({ [RAW_RESPONSE]: true, kind: 'html', html, ...opts } as unknown as HtmlResponse),
        sendBuffer: (buffer, opts) =>
          ({ [RAW_RESPONSE]: true, kind: 'buffer', buffer, ...opts } as unknown as BufferResponse),
        sendText: (text, opts) => ({ [RAW_RESPONSE]: true, kind: 'text', text, ...opts } as unknown as TextResponse),
        sendView: (viewPath, model, opts) =>
          ({ [RAW_RESPONSE]: true, kind: 'view', viewPath, model: model ?? {}, ...opts } as unknown as ViewResponse),
      }
      const returned = await route.handler(ctx)
      if (res.writableEnded) return
      if (isRawResponse(returned)) {
        if (returned.kind === 'view') {
          const rendered = this.renderView(returned.viewPath)
          if (!rendered.ok) {
            sendJson(res, 404, { success: false, message: rendered.message, data: null }, defaults)
            return
          }
          const html = renderTemplate(rendered.html, returned.model)
          const desc = { [RAW_RESPONSE]: true, kind: 'html', html, status: returned.status, headers: returned.headers } as unknown as HtmlResponse
          sendRawResponse(res, desc, defaults)
          return
        }
        sendRawResponse(res, returned, defaults)
        return
      }
      sendJson(res, defaults.status ?? 200, wrapResult(returned), defaults)
    } catch (err) {
      if (res.writableEnded) return
      const status = (err as { statusCode?: number }).statusCode ?? 500
      sendJson(res, status, { success: false, message: (err as Error).message, data: null }, defaults)
      // 流式上传超限等场景中途中止时请求体未读完（已 pause）。用 destroy 发 RST 会冲掉客户端
      // 尚未读取的 413 响应；改为响应 flush 完后 resume 优雅排空剩余请求体（解析器已 abort，
      // data 事件被 settled 拦截仅丢弃、不驻留内存），让连接自然收尾。
      if (!req.readableEnded) res.on('finish', () => req.resume())
    } finally {
      // 无论成功 / 报错，都清掉本次未被 transferTo 转走的临时文件
      UploadManager.cleanupTemp(tempPaths)
    }
  }

  /** 定位并读取视图模板（相对视图目录，防目录穿越） */
  private renderView(viewPath: string): { ok: true; html: string } | { ok: false; message: string } {
    const root = resolve(this.viewsDir ?? this.staticDir)
    const rel = normalize(decodeURIComponent(viewPath.split('?')[0])).replace(/^([/\\])+/, '')
    const full = join(root, rel)
    if (!full.startsWith(root)) return { ok: false, message: '非法模板路径' }
    if (!existsSync(full) || !statSync(full).isFile()) return { ok: false, message: '模板不存在' }
    return { ok: true, html: readFileSync(full, 'utf-8') }
  }

  // ---- /auth 静态页面与脚本 ----
  private handleAuthAssets(req: IncomingMessage, pathname: string, res: ServerResponse, store: Store): boolean {
    if (pathname === '/auth/xie-auth.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
      res.end(guardScript())
      return true
    }
    if (pathname === '/auth/login.html') {
      sendHtml(res, 200, loginPage(this.pageTitle))
      return true
    }
    if (pathname === '/auth/register.html') {
      sendHtml(res, 200, registerPage(this.pageTitle))
      return true
    }
    if (pathname === '/auth/manager.html') {
      // 管理页需登录且为 admin，否则跳登录
      const u = resolveUser(store, req)
      if (!u || u.role !== 'admin') {
        sendRedirect(res, `/auth/login.html?redirect=${encodeURIComponent(pathname)}`)
        return true
      }
      sendHtml(res, 200, managerPage(this.pageTitle))
      return true
    }
    return false
  }

  // ---- 静态资源 ----
  private serveStatic(pathname: string, res: ServerResponse, method: string): boolean {
    const root = resolve(this.staticDir)
    const safe = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '')
    const filePath = join(root, safe)
    if (!filePath.startsWith(root)) return false // 防目录穿越
    if (!existsSync(filePath)) return false
    let st
    try {
      st = statSync(filePath)
    } catch {
      return false
    }
    let target = filePath
    if (st.isDirectory()) {
      target = join(filePath, 'index.html')
      if (!existsSync(target)) return false
    }
    res.writeHead(200, {
      'Content-Type': guessContentType(target),
      'Content-Length': statSync(target).size,
    })
    if (method === 'HEAD') {
      res.end()
      return true
    }
    createReadStream(target).pipe(res)
    return true
  }

  // ---- 内置 /auth/api 路由 ----
  private registerBuiltinRoutes(): void {
    const store = this.store!
    const builtin = (path: string, m: string, access: Access, h: Handler) => {
      const { matcher, paramNames } = compilePath(path)
      this.routes.unshift({ rawPath: path, methods: normalizeMethods(m), handler: h, access, matcher, paramNames })
    }

    // 注册（公开）
    builtin('/auth/api/register', 'POST', 'public', (ctx) => {
      const username = String(ctx.body.username ?? '').trim()
      const password = String(ctx.body.password ?? '')
      if (!username || !password) throw new Error('用户名和密码不能为空')
      const canRegister = !store.hasUsers() || store.settings.openRegistration
      if (!canRegister) throw new Error('当前未开放注册')
      if (store.findByUsername(username)) throw new Error('用户名已存在')
      const requireApproval = store.hasUsers() && store.settings.requireApproval
      const status: UserStatus = requireApproval ? 'pending' : 'active'
      const user = store.addUser({ username, passwordHash: hashPassword(password), status })
      store.lockRegistrationIfFirstAdmin()
      return { needApproval: requireApproval, id: user.id, status: user.status }
    })

    // 登录（公开）
    builtin('/auth/api/login', 'POST', 'public', (ctx) => {
      const username = String(ctx.body.username ?? '').trim()
      const password = String(ctx.body.password ?? '')
      const user = store.findByUsername(username)
      if (!user || !verifyPassword(password, user.passwordHash)) throw new Error('用户名或密码错误')
      if (user.status === 'pending') throw new Error('账号待管理员审核')
      if (user.status === 'rejected') throw new Error('账号注册未被批准')
      if (user.status === 'disabled') throw new Error('账号已被停用')
      const token = issueToken(store, user.id)
      setAuthCookie(ctx.res, token, store.settings.tokenTtl)
      return { user: toPublicUser(user), redirect: safeRedirect(ctx.query.redirect) }
    })

    // 登出（公开）
    builtin('/auth/api/logout', 'POST', 'public', (ctx) => {
      clearAuthCookie(ctx.res)
      return { loggedOut: true }
    })

    // 当前用户（需登录）
    builtin('/auth/api/me', 'GET', 'auth', (ctx) => ctx.user)

    /**
     * 防锁死不变量：系统必须至少保留一个 "admin + active" 用户。
     * 命中下面任一路径都会导致无人能再进后台，因此需提前拒绝：
     *  - 将最后一个启用中的 admin 降为 user
     *  - 停用 / 拒绝最后一个启用中的 admin
     * 合法回退流程：先把另一个用户提为 admin，再处理自己。
     */
    const isLastActiveAdmin = (userId: string): boolean => {
      const t = store.findById(userId)
      if (!t || t.role !== 'admin' || t.status !== 'active') return false
      return !store.users.some((u) => u.id !== userId && u.role === 'admin' && u.status === 'active')
    }

    // 用户列表（admin）
    builtin('/auth/api/users', 'GET', 'admin', () => store.users.map(toPublicUser))

    // 审核 / 停用 / 启用（admin）
    builtin('/auth/api/users/:id/:action', 'POST', 'admin', (ctx) => {
      const { id, action } = ctx.params
      const map: Record<string, UserStatus> = { approve: 'active', reject: 'rejected', disable: 'disabled', enable: 'active' }
      const next = map[action]
      if (!next) throw new Error(`未知操作: ${action}`)
      // 停用 / 拒绝 会使目标脱离 active；若目标是最后一个启用 admin，拒绝
      if (next !== 'active' && isLastActiveAdmin(id)) {
        throw new Error('系统必须至少保留一个启用中的管理员，无法停用/拒绝')
      }
      const updated = store.updateUser(id, { status: next })
      if (!updated) throw new Error('用户不存在')
      // 停用/拒绝 → 令牌失效
      if (next !== 'active') store.bumpTokenVersion(id)
      return toPublicUser(updated)
    })

    // 改角色（admin）
    builtin('/auth/api/users/:id/role', 'POST', 'admin', (ctx) => {
      const role = String(ctx.body.role) as UserRole
      if (role !== 'admin' && role !== 'user') throw new Error('非法角色')
      // 将最后一个启用 admin 降为 user 会锁死系统，拒绝
      if (role === 'user' && isLastActiveAdmin(ctx.params.id)) {
        throw new Error('系统必须至少保留一个启用中的管理员，无法降级')
      }
      const updated = store.updateUser(ctx.params.id, { role })
      if (!updated) throw new Error('用户不存在')
      return toPublicUser(updated)
    })

    // 改密（admin）——改后 bump tokenVersion 使旧 token 失效
    builtin('/auth/api/users/:id/password', 'POST', 'admin', (ctx) => {
      const password = String(ctx.body.password ?? '')
      if (!password) throw new Error('新密码不能为空')
      const updated = store.updateUser(ctx.params.id, { passwordHash: hashPassword(password) })
      if (!updated) throw new Error('用户不存在')
      store.bumpTokenVersion(ctx.params.id)
      return { reset: true }
    })

    // 读取设置（admin）
    builtin('/auth/api/settings', 'GET', 'admin', () => store.settings)

    // 更新设置（admin）
    builtin('/auth/api/settings', 'POST', 'admin', (ctx) => {
      const patch: Record<string, unknown> = {}
      for (const key of ['openRegistration', 'requireApproval', 'trustProxy', 'ipMode', 'ipList'] as const) {
        if (ctx.body[key] !== undefined) patch[key] = ctx.body[key]
      }
      // 防锁死：whitelist 模式必须至少保留操作者当前 IP
      if (patch.ipMode === 'whitelist') {
        const list = (patch.ipList as string[]) ?? []
        const myIp = getClientIp(ctx.req, store.settings.trustProxy)
        if (!list.some((e) => e === myIp)) list.push(myIp)
        patch.ipList = list
      }
      return store.updateSettings(patch)
    })
  }
}
