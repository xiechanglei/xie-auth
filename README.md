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
- [原始响应（文件 / 页面下载）](#原始响应文件--页面下载)
- [视图渲染 ctx.sendview](#视图渲染-ctxsendview)
- [ctx 响应控制（status / header / cookie）](#ctx-响应控制status--header--cookie)
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
  .title('我的系统')                   // 可省略，内置页面标题默认 xie-auth
  .upload('./data/uploads')              // 上传临时暂存目录（无默认值，防多应用并行冲突）
  .use('/health', 'GET', () => ({ status: 'ok' }))            // 公开
  .useAuth('/profile', (ctx) => ctx.user)                       // 需登录，method 默认 GET
  .useAdmin('/stats', 'GET,POST', (ctx) => doAdminThing(ctx))   // 仅管理员
  .authGuard('/app/**', { role: 'admin' })                       // 命中且未登录则跳登录页
  .serve(3333)                                                   // 可省略端口，默认 3333

// server.stop() 停止；停止后可再次 serve() 重启
```

启动时库会打印最终生效的配置：`title`、`userStore`、`static`、`port`。

---

## 核心 API

链式调用**无强制顺序**，配置方法之间可任意排列、可重复调用累加；`serve()` 是唯一的启动点。

| 方法 | 说明 | 返回 |
|------|------|------|
| `createAuthServer()` | 工厂函数，返回可链式构建器 | `AuthServer` |
| `.userStore(filePath)` | 用户信息 + 设置的**存储文件**（文件存储，非数据库；不存在时自动创建） | `AuthServer` |
| `.static(dirPath)` | 静态资源托管目录（默认不鉴权） | `AuthServer` |
| `.views(dirPath)` | 视图模板目录（`sendView` 从此读模板）；不配则默认复用 `static` | `AuthServer` |
| `.title(text)` | 内置页面（登录/注册/管理台）的标题，默认 `xie-auth` | `AuthServer` |
| `.upload(dirPath, opts?)` | 上传临时暂存目录（**无默认值**）+ 大小/扩展名等配置 | `AuthServer` |
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
  cookies,  // 只读：解析后的请求 Cookie 对象
  req, res, // 兜底：需要操作原始请求/响应时

  // 响应控制（写一次对所有出口生效，见“ctx 响应控制”）
  status, set, append, get, cookie, clearCookie,
  // 原始响应构建（绕过 JSON 封装，见“原始响应”/“视图渲染”）
  sendFile, sendHtml, sendBuffer, sendText, sendView,
}
```

来源规则：GET 取 `query`，POST/PUT 取 `body`，路径参数恒取 `params`。

> `use` / `useAuth` / `useAdmin` 三档路由的 handler **都接收同样的 `ctx`**，区别只在是否鉴权。

### 文件上传（multipart/form-data）

上传相关配置集中在 `.upload(dirPath, opts?)`（`dirPath` 为**临时暂存目录**）：

```
.upload(dirPath, {
  maxSize:         '10MB',  // 单文件 & 总大小上限
  allowExtensions?: [],     // 扩展名白名单，如 ['png','jpg','pdf']
  maxFiles?:         10,    // 单请求最大文件数
})
```

- **`dirPath` 无默认值**（防止多个应用并行时落到同一目录冲突），配置了 `.upload` 才启用文件上传。
- 解析结果进入 `ctx.files`，按字段名分组、同名归数组，采用**临时暂存 → `transferTo` 转存**模型（类 Spring `MultipartFile`，详见[文件上传生命周期](#文件上传生命周期)）。
- 每个文件对象：`{ field, filename, storedName, mimeType, size, md5, uploadTime, path, transferTo(dest) }`；其中 `md5` 在写盘时基于内存缓冲**实时计算**，不额外二次读盘。

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

> 例外：handler 返回 `ctx.sendFile/sendHtml/sendBuffer/sendText/sendView(...)` 时**绕过 JSON 封装**，直接产出原始响应（见下节）。

---

## 原始响应（文件 / 页面下载）

当需要返回文件下载、HTML 页面等非 JSON 内容时，用 `ctx` 上的响应构建方法 `return` 一个响应描述对象，库会**跳过统一封装**直接发送：

| 方法 | 用途 | Content-Type |
|------|------|--------------|
| `ctx.sendFile(filePath, opts?)` | 返回磁盘文件（**流式**发送，大文件不占内存） | 按扩展名推断，可用 `opts.mimeType` 覆盖 |
| `ctx.sendHtml(html, opts?)` | 返回一段 HTML 页面 | `text/html` |
| `ctx.sendBuffer(buffer, opts?)` | 返回内存内容（如导出的报表 / CSV） | `opts.contentType`，默认 `application/octet-stream` |
| `ctx.sendText(text, opts?)` | 返回纯文本 | `text/plain` |
| `ctx.sendView(viewPath, model?, opts?)` | 渲染**视图目录**下的模板（插值后输出） | `text/html` |

```js
.use('/export', (ctx) => ctx.sendFile('/data/report.pdf'))                       // 默认作为附件下载
.use('/preview', (ctx) => ctx.sendFile('/data/a.png', { download: false }))      // 浏览器内联预览
.use('/export-as', (ctx) => ctx.sendFile('/data/tmp.dat', { filename: '订单.csv' })) // 自定义下载名
.use('/report', (ctx) => ctx.sendHtml('<h1>报表</h1>'))
.use('/dump', (ctx) => ctx.sendBuffer(Buffer.from('a,b\n1,2'), { contentType: 'text/csv', filename: 'd.csv' }))
```

- **下载 vs 内联**：`sendFile` 默认 `Content-Disposition: attachment`，传 `download: false` 改为 `inline`；文件名兼容非 ASCII（RFC 5987 `filename*`）。
- **缺文件**：`sendFile` 指向的路径不存在时自动返回 **404** `{ success:false, ... }`，handler 无需自行判存在。
- 所有方法均支持 `opts.status` 与 `opts.headers` 覆盖状态码 / 追加响应头（更多见下节“ctx 响应控制”，一次性设好无需重复传）。

---

## 文件缓存与 Range（`sendFile`）

面向媒体 / 静态资源服务，`ctx.sendFile` 可选开启**条件缓存**（协商 304）与**断点续传 / 拖动**（Range 206）。均为 **opt-in**，不传相关 opts 时保持原来的全量 200 行为：

```js
// 图片 / 视频内联预览，支持缓存与 Range
.use('/media/:name', (ctx) =>
  ctx.sendFile(`/data/media/${ctx.params.name}`, {
    download: false,
    etag: true,          // 自动生成 ETag = "<mtime>-<size>"（不读文件内容）
    lastModified: true,  // 取文件 mtime 作为 Last-Modified
    cacheControl: 'public, max-age=3600', // 原样下发（不传则不下发）
    range: true,         // 支持单区间 Range → 206 / 416
  }),
)
```

| opts | 默认 | 说明 |
|------|:----:|------|
| `etag` | 关 | `true` 自动生成 `"<mtimeMs>-<size>"`（强校验、零额外读盘）；传字符串为自定义 |
| `lastModified` | 关 | `true` 取文件 mtime；传 `Date` 为指定时间 |
| `cacheControl` | 不下发 | `Cache-Control` 头原文，如 `'public, max-age=3600, immutable'` |
| `range` | 关 | 支持 `Range` 头（单区间） |

**处理优先级**（符合 RFC 9110 简化语义）：

1. **条件命中→ 304**：`If-None-Match` 匹配 ETag（弱比较），或无 `If-None-Match` 时 `If-Modified-Since` ≥ 文件 mtime → 返回 304（无 body）。
2. **Range→ 206 / 416**：开启且带 `Range` 时，先查 `If-Range`（不匹配则忽略 Range 回全量）；合法单区间 → `206` + `Content-Range` 流式输出片段；起始越界 → `416`。
3. **全量 200**：带 `Accept-Ranges: bytes`（仅 `range: true` 时下发）。

**说明**：

- **仅支持单区间**（覆盖视频拖动 / 断点续传绝大多数场景）；多区间请求（如 `bytes=0-1,5-6`）按忽略处理、回全量 200。
- **HEAD** 同样参与缓存 / Range 判定（只发头不发体）；需路由声明支持 HEAD（如 `.use(path, 'GET,HEAD', ...)`）。
- ETag 基于 mtime+size，不读文件内容，因此不破坏流式传输；文件被原地修改后 mtime/size 变化会自动使缓存失效。

---

## 视图渲染 `ctx.sendView()`

从**视图目录**（`.views(dir)` 配置，不配则复用 `static`）读取模板，用 `model` 做插值后作为 `text/html` 返回：

```js
// views/user.html：  <h1>{{user.name}}</h1>  <div>{{{user.bio}}}</div>
.use('/u/:id', (ctx) => ctx.sendView('/user.html', { user: { name: 'Tom', bio: '<b>Hi</b>' } }))
```

插值语法（零依赖的极简 Mustache 子集）：

| 写法 | 含义 |
|------|------|
| `{{ expr }}` | 取值后 **原样**插入（不转义） |
| `{{{ expr }}}` | 与 `{{ }}` 行为一致，同样**原样**插入 |
| `{{ user.name }}` / `{{ list.0.title }}` | 支持点路径与数组下标 |

> ⚠️ **不做任何 HTML 转义**：模板内容的安全性（如防 XSS）由使用者自行保证。

- 缺失变量替换为**空串**；模板文件不存在自动 **404**。
- 仅做值替换，**不含条件 / 循环 / 逻辑**；需要时在 handler 里先算好再塞进 `model`。
- `viewPath` 相对视图目录解析并**防目录穿越**（`..` 被拒绝）。

---

## ctx 响应控制（status / header / cookie）

`ctx` 提供一组响应控制方法，写一次即对**所有出口生效**（JSON 自动封装 / `send*` / `sendView`），无需在每个 `send` 的 `opts` 里重复定义 header：

```js
.use('/create', (ctx) => {
  ctx.status(201)                                   // 状态码
  ctx.set('X-Trace-Id', 'abc')                      // 单个响应头
  ctx.set({ 'A': '1', 'B': '2' })                   // 批量
  ctx.append('Link', '</a.css>; rel=preload')       // 追加（同名多值）
  ctx.cookie('theme', 'dark', { maxAge: 3600, httpOnly: true }) // 写 Cookie
  ctx.clearCookie('theme')                          // 清 Cookie
  return { ok: true }                               // 以上自动带入 JSON 响应
})
const who = ctx.cookies.username                    // 读请求 Cookie（只读对象）
const ua  = ctx.get('user-agent')                   // 读请求头
```

**优先级（从低到高）**：框架默认 → `ctx.status/set/cookie` 累积值 → 单次 `send*(..., opts)` 里的 `opts.status / opts.headers`。

- Cookie 用**追加**方式写入 `Set-Cookie`，多个 Cookie 共存；`clearCookie` 等价 `Max-Age=0`。值经 URL 编码。
- `opts` 里的 `status/headers` 仅用于临时覆盖；常规场景用 `ctx.*` 一次设好即可。

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
  - 登录页提供“**登录后进入管理后台**”选项（优先级：勾选→ `/auth/manager.html`；否则 `?redirect=` 回跳；再否则 `/`）。
  - 页面标题可通过 `.title(text)` 配置（默认 `xie-auth`）。
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

## 最后启用管理员保护（防锁死）

内置管理接口自动维护一条**不变量**：系统必须至少保留一个 `admin + active` 用户，避免“唯一管理员自降级 / 自停用 → 无 openRegistration 可回 → 后台完全锁死”的情况：

- `POST /auth/api/users/:id/role` 将目标降为 `user`：若目标是“最后一个启用中的 admin” → 拒。`500` 并提示“至少保留一个启用中的管理员”。
- `POST /auth/api/users/:id/disable`、`/reject`：同上拦截。
- **不影响**：先将另一个用户 `role=admin`（且 `active`），再处理自己；这是官方推荐的交接流程。
- 保护仅针对“当前会失去 admin 能力”的方向；promote / enable 不拦截。

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

采用**临时暂存区模型**（类 Spring `MultipartFile`），库不替开发者长期保管文件——只在请求期间暂存，由 handler 决定去留：

| 阶段 | 行为 |
|------|------|
| **落地即临时** | 上传文件写入临时区（`.upload(dir)` 目录），按 `<dir>/<uuid>.<ext>` 存盘；写盘时基于内存缓冲实时算出 `md5` |
| **handler 拿文件对象** | `ctx.files.<field>[0]` 提供 `{ filename, size, md5, uploadTime, path, transferTo(dest) }`，`path` 在本请求 handler 期间可读 |
| **需要保留则转存** | 调用 `file.transferTo(dest)` 将临时文件**移动**到正式位置（重命名，跨设备回退复制）；`dest` 为目录则以原始文件名落入，为路径则按确切路径存放（自动建父目录），返回最终绝对路径 |
| **请求结束自动清理** | handler 结束（成功或抛错）后，**未被 `transferTo` 转走**的临时文件一律删除 |
| **启动清孤儿** | 每次服务启动 `purgeStale()` 清空临时区，回收上次进程崩溃 / 重启遗留的孤儿文件 |

```js
.use('/upload', 'POST', (ctx) => {
  const f = ctx.files.file[0]
  const abs = f.transferTo('/data/attachments/')   // 保留：转存到正式目录，返回最终路径
  return { saved: abs, md5: f.md5, size: f.size }   // 未 transferTo 的文件请求结束即删
})
```

> 安全：文件名净化 + 禁止 `..`/绝对路径；临时落盘一律用 uuid 名，原始名仅供展示与 `transferTo` 到目录时的默认命名；可选扩展名白名单与单请求文件数上限；临时目录不通过 `.static` 暴露。

---

## 默认值一览

| 配置 | 方法 | 默认值 |
|------|------|--------|
| 用户/设置存储文件 | `.userStore()` | `~/.xie-auth/users.json`（用户主目录下） |
| 静态资源目录 | `.static()` | 入口文件同级的 `public`（`node app.js` → `./app.js旁的/public`） |
| 视图模板目录 | `.views()` | 未配置时 `sendView` 回退到 `static` 目录 |
| 上传落盘目录 | `.upload()` | **无默认值**（未配置则不启用上传） |
| 服务端口 | `.serve()` | `3333` |
| 上传大小上限 | `.upload()` | `10MB` |
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
│   ├── net/                # multipart / request / response / upload / cookie / template / fileStream
│   └── auth/               # session / pages / guardScript
├── test/                   # 针对构建产物（dist/）的端到端功能测试
│   └── server.test.mjs
├── vite.config.ts          # Vite library mode 配置
├── tsconfig.json / tsconfig.node.json
├── package.json
└── README.md
```
