# @xie-work/xie-auth

> 一个面向第三方 Node.js 开发者的**嵌入式认证服务库**。引入本库后，你无需再自己处理「用户 / 注册 / 登录 / 鉴权 / 权限」这些事——库内置了登录、注册、用户管理界面与接口，你只需按链式 API 声明业务接口即可。

- 开发语言：**TypeScript**
- 构建工具：**Vite（library mode，产出 ESM + CJS 双格式）**
- 运行环境：**Node.js ≥ 18**
- 存储：**基于文件，无需数据库**
- 边界：**库只接管 `/auth/` 目录下的路由、页面与接口**，根路径 `/` 与业务页面归属开发者

> ℹ️ 本 README 描述库的接口设计与用法，与 `src/` 实现一致。核心能力（链式 Builder、文件存储、内置登录/注册/管理、鉴权档位、改密失效、上传、IP 过滤、守卫）已实现；`npm run test:build` 会跑端到端功能测试验证。

---

## 目录

- [快速开始](#快速开始)
- [核心 API](#核心-api)
- [路由与 handler](#路由与-handler)
- [统一响应格式](#统一响应格式)
- [HTTP 状态码约定](#http-状态码约定)
- [内置认证能力](#内置认证能力)
- [登录态与令牌](#登录态与令牌)
- [注册、审核与首个管理员](#注册审核与首个管理员)
- [改密即失效（tokenVersion）](#改密即失效tokenversion)
- [IP 黑 / 白名单](#ip-黑--白名单)
- [登录跳转（客户端守卫 + 声明式守卫）](#登录跳转客户端守卫--声明式守卫)
- [文件上传生命周期](#文件上传生命周期)
- [默认值一览](#默认值一览)
- [构建与测试](#构建与测试)

---

## 快速开始

```ts
import { createAuthServer } from '@xie-work/xie-auth'

const server = createAuthServer()
  .userStore('./data/users.json')        // 可省略，默认 ~/.xie-auth/users.json
  .static('./public')                    // 可省略，默认入口文件同级的 public
  .upload('./data/uploads')              // 上传落盘目录（无默认值，防多应用并行冲突）
  .use('/health', 'GET', () => ({ status: 'ok' }))            // 公开
  .useAuth('/profile', (ctx) => ctx.user)                       // 需登录，method 默认 GET
  .useAdmin('/stats', 'GET,POST', (ctx) => doAdminThing(ctx))   // 仅管理员
  .authGuard('/app/**', { role: 'admin' })                       // 命中且未登录则跳登录页
  .serve(3333)                                                   // 可省略端口，默认 3333

// server.stop() 停止；停止后可再次 serve() 重启
```

启动时库会打印最终生效的配置：`userStore`、`static`、`port`。

---

## 核心 API

链式调用**无强制顺序**，配置方法之间可任意排列、可重复调用累加；`serve()` 是唯一的启动点。

| 方法 | 说明 | 返回 |
|------|------|------|
| `createAuthServer()` | 工厂函数，返回可链式构建器 | `AuthServer` |
| `.userStore(filePath)` | 用户信息 + 设置的**存储文件**（文件存储，非数据库；不存在时自动创建） | `AuthServer` |
| `.static(dirPath)` | 静态资源托管目录（默认不鉴权） | `AuthServer` |
| `.upload(dirPath, opts?)` | 上传落盘目录（**无默认值**）+ 大小/有效期等配置 | `AuthServer` |
| `.use(path, method?, handler)` | 注册**公开**接口（不拦截） | `AuthServer` |
| `.useAuth(path, method?, handler)` | 注册**受保护**接口（需登录） | `AuthServer` |
| `.useAdmin(path, method?, handler)` | 注册**管理员**接口（需 admin） | `AuthServer` |
| `.authGuard(pattern, opts?)` | 声明式页面守卫，命中且未登录则 302 跳登录页 | `AuthServer` |
| `.serve(port?)` | 启动服务，返回 `AuthServer` | `AuthServer` |
| `.stop()` | 停止服务，可再次 `serve()` 重启 | `void` |

### path
- 固定：`/health`
- 路径参数：`/users/:id`、`/repos/:owner/:name`，命中后进入 `ctx.params`

### method
- 默认 `GET`，可省略
- 支持多个，逗号分隔：`'GET,POST'`（大小写不敏感、自动去空格）
- 实际命中方法通过 `ctx.method` 获取

---

## 路由与 handler

handler 接收一个统一的 **`ctx` 对象**，参数按来源分命名空间（避免同名互相覆盖），开发者无需自己从 `request` 里扒参数：

```ts
ctx = {
  params,   // 路径参数          /users/:id → { id }
  query,    // 查询串参数         ?page=2    → { page: '2' }
  body,     // 请求体（JSON / urlencoded 自动解析）
  files,    // 上传文件（见下）
  method,   // 实际命中方法
  path,     // 路由定义路径
  user,     // 当前登录用户；未登录为 null（受保护/管理员路由必有）
  req, res, // 兜底：需要操作原始请求/响应时
}
```

来源规则：GET 取 `query`，POST/PUT 取 `body`，路径参数恒取 `params`。

> `use` / `useAuth` / `useAdmin` 三档路由的 handler **都接收同样的 `ctx`**，区别只在是否鉴权。

### 文件上传（multipart/form-data）

上传相关配置集中在 `.upload(dirPath, opts?)`：

```
.upload(dirPath, {
  maxSize:         '10MB',  // 单文件 & 总大小上限
  ttl:             '24h',   // 临时文件保留时长，0 = 永久
  allowExtensions?: [],     // 扩展名白名单，如 ['png','jpg','pdf']
  maxFiles?:         10,    // 单请求最大文件数
})
```

- **`dirPath` 无默认值**（防止多个应用并行时落到同一目录冲突），配置了 `.upload` 才启用文件上传。
- 解析结果进入 `ctx.files`，按字段名分组、同名归数组，采用**落盘 + 两段式生命周期**（详见[文件上传生命周期](#文件上传生命周期)）。
- 解析后每项：`{ field, filename, storedName, mimeType, size, path, keep(), delete() }`。

---

## 统一响应格式

所有接口返回由库自动封装，**handler 只需关心业务数据，返回值一律塞进 `data`**：

| 情况 | HTTP 状态码 | 响应体 |
|------|:-----------:|--------|
| handler 正常返回（对象/字符串/数字等） | `200` | `{ success: true, message: 'ok', data: <handler 返回值> }` |
| handler 显式返回完整 `{ success, message, data }` | `200` | 原样透传（可自定义 message/success） |
| handler 抛出异常 | `500` | `{ success: false, message: <error.message>, data: null }` |
| 鉴权失败（`useAuth`/`useAdmin`） | `401` | `{ success: false, message: 'Unauthorized', data: null }` |
| IP 被拒绝 | `403` | `{ success: false, message: 'Forbidden', data: null }` |

---

## HTTP 状态码约定

| 场景 | 状态码 |
|------|:------:|
| 正常响应 | `200` |
| 未登录 / token 非法 / 过期 / tokenVersion 失效 | `401` |
| IP 黑 / 白名单拒绝 | `403` |
| handler 抛出异常 | `500` |

---

## 内置认证能力

库自动挂载以下内容（均在 `/auth/` 下），开发者无需实现：

- **页面**：`/auth/login.html`、`/auth/register.html`、`/auth/manager.html`（管理员专用）
- **接口**：注册、登录、登出、`GET /auth/api/me`（返回当前用户），以及管理接口（审核 / 停用 / 改密 / 设置注册开关 / IP 名单等，均 admin only）
- **客户端守卫脚本**：`/auth/xie-auth.js`（见[登录跳转](#登录跳转客户端守卫--声明式守卫)）

### 用户模型（草稿）

```
User {
  id, username, passwordHash,
  role:   'admin' | 'user',
  status: 'active' | 'pending' | 'rejected' | 'disabled',
  tokenVersion, createdAt, ...
}
```

`userStore` 文件同时保存 **用户列表** 与 **全局设置**（`openRegistration` / `requireApproval` / IP 名单等）。

---

## 登录态与令牌

- **登录态承载**：以 **HttpOnly Cookie** 为主（支撑服务端判断与跳转）；同时兼容 `Authorization: Bearer <token>`，方便纯 API 调用。
- **密码哈希**：Node 内置 **`scrypt`**，零第三方依赖。
- **令牌**：**HMAC 自签**（payload 内含 `tokenVersion` 与 `iat`，不引入 JWT 库）。
- 每次请求都以 `userStore` 中的**实时用户数据**注入 `ctx.user`，token 只用于"认人"，**权限/角色以存储里的当前值判定**。

---

## 注册、审核与首个管理员

- **首个注册用户自动成为 `admin` 且免审核**（`status: active`）。
- 首个用户之后：
  - `requireApproval`（注册是否需审核）**默认开启** → 新用户注册进入 `pending`，由 admin 在 `manager.html` 审核通过 / 拒绝。
  - `openRegistration`（是否开放注册）**默认关闭** → 关闭时不接受新注册；admin 可再打开。
  - 系统**无用户时强制视为开放注册**（否则第一个管理员无法产生）。
- 登录时 `pending` / `rejected` 用户会被拒绝并给出明确提示；`disabled` 用户无法登录。

---

## 改密即失效（tokenVersion）

HMAC 自签 token 无状态，签发后到期前天然有效。为支持"改密后旧 token 立即失效"，采用**令牌版本号**：

- 每个用户带 `tokenVersion`（初值 0），签发的 token payload 记录该值。
- 校验时解析签名后，比对 `token.tokenVersion === user.tokenVersion`，不等即视为无效（**401**）。
- **改密码（本人或 admin 后台改）→ `tokenVersion++`** → 该用户此前所有 token 立即全部失效，须重新登录。
- 同一机制顺带覆盖：停用 / 删除用户（状态非 `active` 直接拒绝）、角色变更后权限以实时存储为准。
- **不维护会话表 / 黑名单**：文件存储下并发写会话表过重且易脏，版本号方案零额外结构。

---

## IP 黑 / 白名单

后台（admin）可配的访问网关，存于 `userStore` 设置段：

- `ipMode: 'off' | 'blacklist' | 'whitelist'`
- `ipList: string[]`（支持精确 IP 与 CIDR，如 `192.168.1.0/24`）
- 作为**最外层网关**，在路由匹配前判定；命中拒绝规则直接 **403**。
- **保护范围包含 `/auth/` 自身**（更安全的默认）。
- **防锁死保险**：`whitelist` 模式下必须至少保留当前操作者自己的 IP。
- `trustProxy` **默认关闭**：真实 IP 默认取 socket 地址，避免 `X-Forwarded-For` 被伪造绕过。

---

## 登录跳转（客户端守卫 + 声明式守卫）

库不接管开发者页面路由，"何时跳转"由开发者通过以下两种方式声明，均支持登录成功后 `?redirect=` 回跳原页（仅允许站内相对路径，防开放重定向）。

### A. 客户端守卫脚本（省心主路径）

在想守卫的页面加一行：

```html
<script src="/auth/xie-auth.js" data-required data-role="admin"></script>
```

脚本自动：
- 页面加载即调 `/auth/api/me`，未登录则 `location = '/auth/login.html?redirect=' + 当前URL`；带 `data-role` 时同时校验角色。
- **全局拦截 `fetch` / `XHR`**：接口返回 `401` 时自动跳登录页（带 redirect）。
- 暴露便捷 API：`XieAuth.login() / logout() / getUser() / isLoggedIn() / redirectToLogin()`。

### C. 声明式守卫 `.authGuard(pattern, opts?)`

```
.authGuard('/app/**', { role: 'admin' })
```

命中该路径模式且未登录（或角色不符）时，服务端 **302** 跳转到 `/auth/login.html?redirect=<原始路径>`。用于"整段路径都要登录/某角色"的批量声明，避免每页加脚本。

---

## 文件上传生命周期

采用**两段式（临时区 → 转正）**，自动消化"开发者未处理的孤儿文件"：

| 阶段 | 行为 |
|------|------|
| **落地即临时** | 上传文件先进临时区（`upload(dir)` 目录），按 `<dir>/yyyy-MM-dd/<uuid>.<ext>` 存盘 |
| **handler 转正** | 对需要保留的文件调用 `file.keep()` → 移出到**库固定的永久区**（`<dir>/kept/`），不再受 ttl 影响 |
| **未认领自动清理** | 未 `keep()` 的临时文件超过 `ttl`（默认 **24h**）由清理器删除 |

清理器实现：
- **基于文件 mtime 扫描**，不用内存计时器 → 服务重启 / `stop()` 后依然有效，启动时做一次全量扫描；周期可配（默认每 30 分钟）。
- `ttl = 0` 退化为"全部永久保留"，由开发者自行管理。
- 除 `keep()` 外，`file.delete()` 可主动删除任意已存文件。

> 安全：文件名净化 + 禁止 `..`/绝对路径；落盘一律用 uuid 名，原始名仅供展示；可选扩展名/MIME 白名单；上传目录不通过 `.static` 暴露执行。

---

## 默认值一览

| 配置 | 方法 | 默认值 |
|------|------|--------|
| 用户/设置存储文件 | `.userStore()` | `~/.xie-auth/users.json`（用户主目录下） |
| 静态资源目录 | `.static()` | 入口文件同级的 `public`（`node app.js` → `./app.js旁的/public`） |
| 上传落盘目录 | `.upload()` | **无默认值**（未配置则不启用上传） |
| 服务端口 | `.serve()` | `3333` |
| 上传大小上限 | `.upload()` | `10MB` |
| 临时文件有效期 | `.upload()` | `24h` |
| 单请求最大文件数 | `.upload()` | `10` |
| `method` | `.use/.useAuth/.useAdmin` | `GET` |

---

## 构建与测试

```bash
npm install          # 安装依赖
npm run build        # 类型检查 + 构建，产出 dist/（ESM/CJS/d.ts）
npm run dev          # watch 模式开发
npm run test         # 跑端到端功能测试（test/ 基于构建产物 dist/ 验证）
npm run test:build   # 先构建再测试
```

### 项目结构

```
xie-auth/
├── src/                    # 库源码
│   ├── index.ts            # 入口：导出 createAuthServer / AuthServer / 类型
│   ├── AuthServer.ts       # 链式 Builder + 请求分发流水线 + 内置路由
│   ├── types.ts / crypto.ts / store.ts / router.ts / util.ts / ipFilter.ts
│   ├── net/                # multipart / request / response / upload
│   └── auth/               # session / pages / guardScript
├── test/                   # 针对构建产物（dist/）的端到端功能测试
│   └── server.test.mjs
├── vite.config.ts          # Vite library mode 配置
├── tsconfig.json / tsconfig.node.json
├── package.json
└── README.md
```
