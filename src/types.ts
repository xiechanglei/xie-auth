import type { IncomingMessage, ServerResponse } from 'node:http'

/** 用户角色 */
export type UserRole = 'admin' | 'user'

/** 用户状态 */
export type UserStatus = 'active' | 'pending' | 'rejected' | 'disabled'

/** 存储中的用户记录 */
export interface StoredUser {
  id: string
  username: string
  /** scrypt 派生密钥的哈希（含 salt），格式 salt:hash */
  passwordHash: string
  role: UserRole
  status: UserStatus
  /** 令牌版本号：改密 / 停用时自增，使旧 token 失效 */
  tokenVersion: number
  createdAt: number
  updatedAt: number
}

/** 对外暴露的用户信息（剔除敏感字段） */
export interface PublicUser {
  id: string
  username: string
  role: UserRole
  status: UserStatus
  createdAt: number
}

/** IP 过滤模式 */
export type IpMode = 'off' | 'blacklist' | 'whitelist'

/** 全局设置（存于 userStore 文件的 settings 段） */
export interface Settings {
  /** 是否开放注册；无用户时强制视为开放 */
  openRegistration: boolean
  /** 注册是否需要管理员审核 */
  requireApproval: boolean
  /** IP 过滤模式 */
  ipMode: IpMode
  /** IP 名单，支持精确 IP 与 CIDR */
  ipList: string[]
  /** 是否信任 X-Forwarded-For 取真实 IP */
  trustProxy: boolean
  /** token 有效期（秒） */
  tokenTtl: number
}

/** 存储文件整体结构 */
export interface StoreData {
  /** HMAC 签名密钥（首次启动随机生成） */
  secret: string
  settings: Settings
  users: StoredUser[]
}

/** 默认设置 */
export const DEFAULT_SETTINGS: Settings = {
  openRegistration: true,
  requireApproval: true,
  ipMode: 'off',
  ipList: [],
  trustProxy: false,
  tokenTtl: 3600 * 12,
}

/** 单个上传文件在内存中的描述（落盘后） */
export interface UploadedFileMeta {
  /** 表单字段名 */
  field: string
  /** 客户端提交的原始文件名（仅展示） */
  filename: string
  /** 落盘使用的 uuid 名 */
  storedName: string
  mimeType: string
  size: number
  /** 落盘的绝对路径（临时区） */
  path: string
}

/** handler 可操作的上传文件对象 */
export interface UploadedFile extends UploadedFileMeta {
  /** 转正：移动到永久区，返回新绝对路径；不受 ttl 清理 */
  keep(): string
  /** 主动删除该文件 */
  delete(): void
}

/** 上传文件集合：按字段名分组，同名归数组 */
export type FilesField = Record<string, UploadedFile[]>

/** 请求上下文：库已把参数按来源整理好，开发者无需自己扒 request */
export interface Ctx {
  /** 路径参数 /users/:id → { id } */
  params: Record<string, string>
  /** 查询串参数 */
  query: Record<string, string>
  /** 请求体（JSON / urlencoded 自动解析） */
  body: Record<string, unknown>
  /** 上传文件 */
  files: FilesField
  /** 实际命中的 HTTP 方法（大写） */
  method: string
  /** 命中的路由定义路径 */
  path: string
  /** 当前登录用户；未登录为 null */
  user: PublicUser | null
  /** 原始请求 / 响应，兜底用 */
  req: IncomingMessage
  res: ServerResponse
}

/** 统一响应结构 */
export interface ApiResult<T = unknown> {
  success: boolean
  message: string
  data: T | null
}

/** 业务 handler：返回值一律塞进 data */
export type Handler = (ctx: Ctx) => unknown | Promise<unknown>

/** 路由权限档位 */
export type Access = 'public' | 'auth' | 'admin'

/** 内部注册的路由 */
export interface Route {
  rawPath: string
  methods: string[]
  handler: Handler
  access: Access
  /** 由 rawPath 编译出的正则与参数名 */
  matcher: RegExp
  paramNames: string[]
}

/** authGuard 声明 */
export interface GuardRule {
  pattern: string
  role?: UserRole
}

/** 上传配置（dirPath 为必填，无默认） */
export interface UploadOptions {
  maxSize?: string | number
  ttl?: string | number
  allowExtensions?: string[]
  maxFiles?: number
}

/** 解析后的上传配置 */
export interface ResolvedUploadConfig {
  dir: string
  keptDir: string
  maxSizeBytes: number
  ttlMs: number
  allowExtensions: string[] | null
  maxFiles: number
}
