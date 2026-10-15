// 端到端功能测试：真正启动 AuthServer，覆盖注册/登录/鉴权/改密失效/IP/静态/404
import { createAuthServer } from '../dist/index.js'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let passed = 0
let failed = 0
function assert(cond, msg) {
  if (cond) {
    passed++
    console.log('  ✅', msg)
  } else {
    failed++
    console.error('  ❌', msg)
  }
}

const work = mkdtempSync(join(tmpdir(), 'xie-auth-test-'))
const storeFile = join(work, 'users.json')
const staticDir = join(work, 'public')
const uploadDir = join(work, 'uploads')
mkdirSync(staticDir, { recursive: true })
writeFileSync(join(staticDir, 'index.html'), '<h1>HOME</h1>')
const downloadFile = join(work, '报表.txt')
writeFileSync(downloadFile, 'FILE-DATA-中文内容')
const viewsDir = join(work, 'views')
mkdirSync(viewsDir, { recursive: true })
writeFileSync(
  join(viewsDir, 'user.html'),
  '<h1>{{user.name}}</h1><p>{{{user.bio}}}</p><p>esc={{user.bio}}</p><p>miss=[{{user.nothing}}]</p>',
)

const PORT = 39717
const BASE = `http://127.0.0.1:${PORT}`

const server = createAuthServer()
  .userStore(storeFile)
  .static(staticDir)
  .title('MyApp 控制台')
  .views(viewsDir)
  .upload(uploadDir, { maxSize: '5MB', ttl: '0' })
  .use('/ping', () => 'pong')
  .useAuth('/whoami', (ctx) => ctx.user)
  .useAdmin('/admin-only', () => ({ ok: true }))
  .use('/view', (ctx) => ctx.sendView('/user.html', { user: { name: 'Tom', bio: '<b>Hi</b>' } }))
  .use('/view-miss', (ctx) => ctx.sendView('/nope.html'))
  .use('/created', (ctx) => {
    ctx.status(201)
    ctx.set('X-Test', 'abc')
    ctx.cookie('theme', 'dark', { maxAge: 60, httpOnly: true })
    ctx.cookie('pref', 'a b')
    return { ok: true }
  })
  .use('/readck', (ctx) => ({ ua: ctx.get('user-agent'), theme: ctx.cookies.theme ?? null }))
  .use('/dl', (ctx) => ctx.sendFile(downloadFile))
  .use('/dl-inline', (ctx) => ctx.sendFile(downloadFile, { download: false }))
  .use('/page', (ctx) => ctx.sendHtml('<h1>PAGE</h1>'))
  .use('/csv', (ctx) => ctx.sendBuffer(Buffer.from('a,b,c'), { contentType: 'text/csv', filename: 'data.csv' }))
  .use('/plain', (ctx) => ctx.sendText('hello plain'))
  .use('/missfile', (ctx) => ctx.sendFile(join(work, 'not-exist.bin')))
  .serve(PORT)

async function waitForReady() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/ping`)
      if (r.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((res) => setTimeout(res, 50))
  }
  throw new Error('服务未能就绪')
}

async function main() {
  await waitForReady()

  console.log('\n[公开接口与鉴权档位]')
  const ping = await (await fetch(`${BASE}/ping`)).json()
  assert(ping.success && ping.data === 'pong', 'GET /ping 返回 pong')

  const whoUnauth = await fetch(`${BASE}/whoami`)
  assert(whoUnauth.status === 401, '未登录访问 useAuth 路由返回 401')

  console.log('\n[首个管理员注册]')
  const reg = await (
    await fetch(`${BASE}/auth/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin0', password: 'secret123' }),
    })
  ).json()
  assert(reg.success && reg.data.needApproval === false && reg.data.status === 'active', '首个用户自动 active 免审核')
  const adminId = reg.data.id

  const locked = await (
    await fetch(`${BASE}/auth/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'someone', password: 'x' }),
    })
  ).json()
  assert(!locked.success && /未开放注册/.test(locked.message), '首用户后默认关闭注册')

  console.log('\n[登录与 Cookie 会话]')
  const loginRes = await fetch(`${BASE}/auth/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin0', password: 'secret123' }),
  })
  const setCookie = loginRes.headers.get('set-cookie')
  assert(loginRes.status === 200 && !!setCookie && setCookie.includes('xie_auth='), '登录成功并下发 Cookie')
  const cookie = setCookie.split(';')[0]

  const whoAuth = await (await fetch(`${BASE}/whoami`, { headers: { cookie } })).json()
  assert(whoAuth.success && whoAuth.data.username === 'admin0', '带 Cookie 访问 useAuth 返回当前用户')

  const adminRoute = await (await fetch(`${BASE}/admin-only`, { headers: { cookie } })).json()
  assert(adminRoute.success && adminRoute.data.ok === true, 'admin 访问 useAdmin 路由通过')

  console.log('\n[改密即失效 tokenVersion]')
  const reset = await (
    await fetch(`${BASE}/auth/api/users/${adminId}/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ password: 'newsecret' }),
    })
  ).json()
  assert(reset.success, 'admin 通过管理接口重置密码')
  const whoAfterReset = await fetch(`${BASE}/whoami`, { headers: { cookie } })
  assert(whoAfterReset.status === 401, '改密后旧 token 立即失效（401）')

  console.log('\n[静态资源与 404]')
  const home = await fetch(`${BASE}/`)
  const homeText = await home.text()
  assert(home.ok && homeText.includes('HOME'), '静态目录 index.html 可访问')
  const notFound = await fetch(`${BASE}/no-such-route`)
  assert(notFound.status === 404, '未知路由返回 404')

  console.log('\n[内置页面]')
  const loginPage = await fetch(`${BASE}/auth/login.html`)
  const loginHtml = await loginPage.text()
  assert(loginPage.ok && loginHtml.includes('登录'), '内置登录页可访问')
  assert(loginHtml.includes('MyApp 控制台'), '页面标题可通过 .title() 配置')
  assert(loginHtml.includes('id="toAdmin"'), '登录页提供“登录后进入管理后台”选项')
  const guardJs = await fetch(`${BASE}/auth/xie-auth.js`)
  assert(guardJs.ok && (await guardJs.text()).includes('XieAuth'), '客户端守卫脚本可访问')

  console.log('\n[管理员禁用用户]')
  // 上面改密已使旧 cookie 失效，用新密码重新登录 admin
  const adminReLogin = await fetch(`${BASE}/auth/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin0', password: 'newsecret' }),
  })
  const adminCookie = adminReLogin.headers.get('set-cookie').split(';')[0]
  // 开放注册且免审核，便于创建普通用户
  await fetch(`${BASE}/auth/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ openRegistration: true, requireApproval: false }),
  })
  const reg2 = await (
    await fetch(`${BASE}/auth/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'pw123456' }),
    })
  ).json()
  assert(reg2.success && reg2.data.status === 'active', '免审核注册直接 active')

  const login2Res = await fetch(`${BASE}/auth/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'pw123456' }),
  })
  const cookie2 = login2Res.headers.get('set-cookie').split(';')[0]
  assert((await (await fetch(`${BASE}/whoami`, { headers: { cookie: cookie2 } })).json()).data.username === 'alice', 'alice 登录后可访问受保护路由')

  const disableRes = await (
    await fetch(`${BASE}/auth/api/users/${reg2.data.id}/disable`, { method: 'POST', headers: { cookie: adminCookie } })
  ).json()
  assert(disableRes.success && disableRes.data.status === 'disabled', 'admin 禁用用户成功')
  const whoAfterDisable = await fetch(`${BASE}/whoami`, { headers: { cookie: cookie2 } })
  assert(whoAfterDisable.status === 401, '被禁用用户旧 token 立即失效（401）')
  const loginAfterDisable = await (await fetch(`${BASE}/auth/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'pw123456' }) })).json()
  assert(!loginAfterDisable.success && /停用/.test(loginAfterDisable.message), '被禁用用户无法重新登录')

  console.log('\n[原始响应：文件/HTML/Buffer/Text]')
  const dl = await fetch(`${BASE}/dl`)
  const dlText = await dl.text()
  assert(dl.status === 200 && dlText === 'FILE-DATA-中文内容', 'sendFile 返回文件内容')
  assert(/attachment/.test(dl.headers.get('content-disposition') || ''), 'sendFile 默认作为附件下载')
  assert(/filename\*=UTF-8''/.test(dl.headers.get('content-disposition') || ''), '非 ASCII 文件名使用 RFC5987 编码')
  const dlInline = await fetch(`${BASE}/dl-inline`)
  await dlInline.text()
  assert(/inline/.test(dlInline.headers.get('content-disposition') || ''), 'sendFile download:false 为内联')
  const page = await fetch(`${BASE}/page`)
  assert(page.headers.get('content-type')?.includes('text/html') && (await page.text()).includes('PAGE'), 'sendHtml 返回 HTML 页面')
  const csv = await fetch(`${BASE}/csv`)
  assert(csv.headers.get('content-type') === 'text/csv' && (await csv.text()) === 'a,b,c', 'sendBuffer 返回内存内容')
  assert(/attachment/.test(csv.headers.get('content-disposition') || ''), 'sendBuffer 指定 filename 时作为附件')
  const plain = await fetch(`${BASE}/plain`)
  assert(plain.headers.get('content-type')?.includes('text/plain') && (await plain.text()) === 'hello plain', 'sendText 返回纯文本')
  const missfile = await fetch(`${BASE}/missfile`)
  const missJson = await missfile.json()
  assert(missfile.status === 404 && missJson.success === false, 'sendFile 文件不存在返回 404')

  console.log('\n[sendView 模板渲染]')
  const view = await fetch(`${BASE}/view`)
  const viewHtml = await view.text()
  assert(view.headers.get('content-type')?.includes('text/html'), 'sendView 返回 text/html')
  assert(viewHtml.includes('<h1>Tom</h1>'), 'sendView 插值 {{user.name}}')
  assert(viewHtml.includes('<p><b>Hi</b></p>'), 'sendView {{{ }}} 原样输出 HTML')
  assert(viewHtml.includes('esc=&lt;b&gt;Hi&lt;/b&gt;'), 'sendView {{ }} 默认转义防 XSS')
  assert(viewHtml.includes('miss=[]'), 'sendView 缺失变量替换为空串')
  const viewMiss = await fetch(`${BASE}/view-miss`)
  assert(viewMiss.status === 404, 'sendView 模板不存在返回 404')

  console.log('\n[ctx 响应控制：status/header/cookie]')
  const created = await fetch(`${BASE}/created`)
  assert(created.status === 201, 'ctx.status() 作用于 JSON 出口')
  assert(created.headers.get('x-test') === 'abc', 'ctx.set() 设置响应头')
  const setCookies = created.headers.getSetCookie()
  assert(setCookies.some((c) => c.startsWith('theme=dark')) && setCookies.some((c) => c.includes('HttpOnly')), 'ctx.cookie() 下发 HttpOnly Cookie')
  assert(setCookies.some((c) => c.startsWith('pref=a%20b')), 'ctx.cookie() 值经 URL 编码')
  const readck = await (await fetch(`${BASE}/readck`, { headers: { cookie: 'theme=dark' } })).json()
  assert(readck.data.theme === 'dark' && typeof readck.data.ua === 'string', 'ctx.cookies / ctx.get 可读请求信息')

  server.stop()
  rmSync(work, { recursive: true, force: true })

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error('测试异常:', e)
  server.stop()
  rmSync(work, { recursive: true, force: true })
  process.exit(1)
})
