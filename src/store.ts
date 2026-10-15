import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { PublicUser, Settings, StoredUser, StoreData } from './types.js'
import { DEFAULT_SETTINGS } from './types.js'
import { randomSecret, uuid } from './crypto.js'

/**
 * 基于文件的存储：保存 secret、settings、users。
 * 读取进内存，写入采用「临时文件 + rename」的原子方式，降低并发写脏风险。
 */
export class Store {
  readonly filePath: string
  private data: StoreData

  constructor(filePath: string) {
    this.filePath = resolve(filePath)
    this.data = this.load()
  }

  private load(): StoreData {
    if (existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, 'utf8')
        const parsed = JSON.parse(raw) as Partial<StoreData>
        return {
          secret: parsed.secret ?? randomSecret(),
          settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
          users: Array.isArray(parsed.users) ? parsed.users : [],
        }
      } catch {
        // 文件损坏时不覆盖，抛错让调用方感知
        throw new Error(`userStore 文件解析失败: ${this.filePath}`)
      }
    }
    return { secret: randomSecret(), settings: { ...DEFAULT_SETTINGS }, users: [] }
  }

  /** 持久化到磁盘 */
  save(): void {
    const dir = dirname(this.filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = `${this.filePath}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    renameSync(tmp, this.filePath)
  }

  get secret(): string {
    return this.data.secret
  }

  get settings(): Settings {
    return this.data.settings
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.data.settings = { ...this.data.settings, ...patch }
    this.save()
    return this.data.settings
  }

  get users(): StoredUser[] {
    return this.data.users
  }

  hasUsers(): boolean {
    return this.data.users.length > 0
  }

  findByUsername(username: string): StoredUser | undefined {
    return this.data.users.find((u) => u.username === username)
  }

  findById(id: string): StoredUser | undefined {
    return this.data.users.find((u) => u.id === id)
  }

  /** 新增用户；若为首个用户则自动成为 active 的 admin */
  addUser(input: { username: string; passwordHash: string; role?: StoredUser['role']; status?: StoredUser['status'] }): StoredUser {
    const isFirst = this.data.users.length === 0
    const now = Date.now()
    const user: StoredUser = {
      id: uuid(),
      username: input.username,
      passwordHash: input.passwordHash,
      role: isFirst ? 'admin' : (input.role ?? 'user'),
      // 首个用户免审核，直接 active
      status: isFirst ? 'active' : (input.status ?? 'pending'),
      tokenVersion: 0,
      createdAt: now,
      updatedAt: now,
    }
    this.data.users.push(user)
    this.save()
    return user
  }

  /** 按 id 局部更新用户并持久化 */
  updateUser(id: string, patch: Partial<StoredUser>): StoredUser | undefined {
    const user = this.findById(id)
    if (!user) return undefined
    Object.assign(user, patch, { updatedAt: Date.now() })
    this.save()
    return user
  }

  /** 自增 tokenVersion（改密 / 停用 / 删除场景使旧 token 失效） */
  bumpTokenVersion(id: string): void {
    const user = this.findById(id)
    if (!user) return
    user.tokenVersion += 1
    user.updatedAt = Date.now()
    this.save()
  }

  /** 首个用户注册完成后：默认关闭开放注册 */
  lockRegistrationIfFirstAdmin(): void {
    if (this.data.users.length === 1) {
      this.data.settings.openRegistration = false
      this.save()
    }
  }
}

/** 剔除敏感字段 */
export function toPublicUser(user: StoredUser): PublicUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
  }
}
