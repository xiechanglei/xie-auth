const baseStyle = `<style>
:root{--ink:#1e293b;--muted:#64748b;--line:#e2e8f0;--brand:#6366f1;--brand-d:#4f46e5;--brand2:#8b5cf6;--radius:14px;--shadow:0 10px 30px rgba(2,6,23,.08)}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--ink);background:#f8fafc;line-height:1.5}
a{color:var(--brand);text-decoration:none}a:hover{text-decoration:underline}
input,select,textarea{width:100%;padding:.6rem .75rem;font:inherit;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink);transition:border .15s,box-shadow .15s}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(99,102,241,.15)}
label{display:block;font-size:.85rem;color:var(--muted);margin:.6rem 0 .3rem;font-weight:600}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;font:inherit;font-weight:600;border:none;border-radius:10px;padding:.6rem 1rem;cursor:pointer;background:var(--brand);color:#fff;transition:transform .05s,background .15s;box-shadow:0 4px 14px rgba(99,102,241,.28)}
.btn:hover{background:var(--brand-d)}.btn:active{transform:translateY(1px)}
.btn-lg{width:100%;padding:.75rem;font-size:1rem}
.btn-ghost{background:#fff;color:var(--ink);border:1px solid var(--line);box-shadow:none}.btn-ghost:hover{background:#f1f5f9}
.btn-danger{background:#fff;color:#dc2626;border:1px solid #fecaca;box-shadow:none}.btn-danger:hover{background:#fef2f2}
.btn-xs{padding:.3rem .6rem;font-size:.78rem;border-radius:8px;box-shadow:none}
.card .btn{margin-top:.6rem}
.msg{padding:.7rem .9rem;border-radius:10px;margin:0 0 1rem;font-size:.9rem;font-weight:500;display:none}
.msg.err{display:block;background:#fef2f2;color:#b91c1c;border:1px solid #fecaca}
.msg.ok{display:block;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0}
.brand{display:flex;align-items:center;gap:.6rem}.brand .logo{width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,var(--brand),var(--brand2));display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:1.1rem}
body.auth{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.5rem;background:radial-gradient(1100px 550px at 12% 8%,#c7d2fe 0,transparent 60%),radial-gradient(1000px 600px at 88% 92%,#ddd6fe 0,transparent 60%),#eef2ff}
.auth-card{width:100%;max-width:400px;background:#fff;border-radius:20px;padding:2rem;box-shadow:0 24px 60px rgba(30,41,59,.18)}
.auth-card h1{margin:1rem 0 1.3rem;font-size:1.4rem}
.auth-foot{margin-top:1.2rem;text-align:center;font-size:.9rem;color:var(--muted)}
body.admin{background:#f1f5f9}
.topbar{position:sticky;top:0;z-index:10;background:rgba(255,255,255,.85);backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid var(--line)}
.topbar .wrap{max-width:1040px;margin:0 auto;padding:.85rem 1.25rem;display:flex;align-items:center;justify-content:space-between}
.topbar .who{color:var(--muted);font-size:.9rem;margin-right:.75rem}
.container{max-width:1040px;margin:1.5rem auto;padding:0 1.25rem;display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;align-items:start}
.full{grid-column:1 / -1}
.card{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:1.25rem;box-shadow:var(--shadow)}
.card h2{margin:0 0 .5rem;font-size:1rem;font-weight:700}
.switch{display:inline-flex;align-items:center;gap:.45rem;font-weight:600;font-size:.9rem;color:var(--ink);margin:0}
.switch input{width:auto}
.row{display:flex;gap:1.25rem;flex-wrap:wrap;align-items:center;margin:.5rem 0}
table{border-collapse:collapse;width:100%}
th,td{padding:.7rem .6rem;text-align:left;border-bottom:1px solid var(--line);font-size:.88rem;vertical-align:middle}
th{color:var(--muted);font-weight:600;font-size:.74rem;text-transform:uppercase;letter-spacing:.04em}
tbody tr:hover{background:#f8fafc}tbody tr:last-child td{border-bottom:none}
.u-name{font-weight:600}
.actions{display:flex;gap:.4rem;flex-wrap:wrap;align-items:center}
.actions select{width:auto;padding:.3rem .5rem;font-size:.78rem;border-radius:8px;border:1px solid var(--line)}
.badge{display:inline-block;padding:.15rem .6rem;border-radius:999px;font-size:.72rem;font-weight:700;letter-spacing:.02em}
.role-admin{background:#ede9fe;color:#6d28d9}.role-user{background:#e0f2fe;color:#0369a1}
.st-active{background:#dcfce7;color:#166534}.st-pending{background:#fef3c7;color:#92400e}.st-rejected{background:#fee2e2;color:#b91c1c}.st-disabled{background:#e2e8f0;color:#475569}
@media(max-width:760px){.container{grid-template-columns:1fr}}
</style>`

function doc(title: string, bodyClass: string, inner: string): string {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${baseStyle}</head><body class="${bodyClass}">${inner}</body></html>`
}

function brandMark(name: string, suffix = ''): string {
  return `<div class="brand"><div class="logo">X</div><span style="font-weight:700">${name}${suffix}</span></div>`
}

export function loginPage(title = 'xie-auth'): string {
  return doc(
    `登录 · ${title}`,
    'auth',
    `<div class="auth-card">
      ${brandMark(title)}
      <h1>登录</h1>
      <div id="msg" class="msg"></div>
      <label for="username">用户名</label>
      <input id="username" autocomplete="username" placeholder="请输入用户名">
      <label for="password">密码</label>
      <input id="password" type="password" autocomplete="current-password" placeholder="请输入密码">
      <div style="margin-top:1rem"><label class="switch"><input type="checkbox" id="toAdmin"> 登录后进入管理后台</label></div>
      <div style="margin-top:1.5rem"><button id="submit" class="btn btn-lg">登 录</button></div>
      <div class="auth-foot">还没有账号？<a href="/auth/register.html">立即注册</a></div>
    </div>
    <script>${authPageScript('login')}</script>`,
  )
}

export function registerPage(title = 'xie-auth'): string {
  return doc(
    `注册 · ${title}`,
    'auth',
    `<div class="auth-card">
      ${brandMark(title)}
      <h1>创建账号</h1>
      <div id="msg" class="msg"></div>
      <label for="username">用户名</label>
      <input id="username" autocomplete="username" placeholder="设置用户名">
      <label for="password">密码</label>
      <input id="password" type="password" autocomplete="new-password" placeholder="设置密码">
      <label for="password2">确认密码</label>
      <input id="password2" type="password" autocomplete="new-password" placeholder="再次输入密码">
      <div style="margin-top:1.5rem"><button id="submit" class="btn btn-lg">注 册</button></div>
      <div class="auth-foot">已有账号？<a href="/auth/login.html">返回登录</a></div>
    </div>
    <script>${authPageScript('register')}</script>`,
  )
}

/** 登录 / 注册页共用脚本：读取 ?redirect 提交后跳转 */
function authPageScript(mode: 'login' | 'register'): string {
  return `(function(){
  var params=new URLSearchParams(location.search);
  function back(){return params.get('redirect')||'/'}
  function msg(t,ok){var e=document.getElementById('msg');e.className='msg '+(ok?'ok':'err');e.textContent=t}
  function submit(){
    var u=document.getElementById('username').value.trim();
    var p=document.getElementById('password').value;
    if(!u||!p){msg('用户名和密码不能为空');return}
    var body={username:u,password:p};
    ${mode === 'register' ? "var p2=document.getElementById('password2').value;if(p!==p2){msg('两次密码不一致');return}body.password2=p2;" : ''}
    var btn=document.getElementById('submit');btn.disabled=true;
    fetch('/auth/api/${mode}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){return r.json()}).then(function(j){
      btn.disabled=false;
      if(!j.success){msg(j.message||'失败');return}
      ${mode === 'register' ? "if(j.data&&j.data.needApproval){msg('注册成功，等待管理员审核',true);setTimeout(function(){location.href='/auth/login.html'},1600);return}" : ''}
      ${
        mode === 'login'
          ? "var toAdmin=document.getElementById('toAdmin');location.href=(toAdmin&&toAdmin.checked)?'/auth/manager.html':(params.get('redirect')||'/');"
          : 'location.href=back();'
      }
    }).catch(function(e){btn.disabled=false;msg('请求出错:'+e.message)})
  }
  document.getElementById('submit').onclick=submit;
  document.addEventListener('keydown',function(e){if(e.key==='Enter')submit()});
})()`
}

export function managerPage(title = 'xie-auth'): string {
  return doc(
    `管理台 · ${title}`,
    'admin',
    `<div class="topbar"><div class="wrap">
      ${brandMark(title, ' 管理台')}
      <div><span class="who">当前：<b id="who">—</b></span><button class="btn btn-ghost btn-xs" onclick="fetch('/auth/api/logout',{method:'POST'}).then(function(){location.href='/auth/login.html'})">登出</button></div>
    </div></div>
    <div class="container">
      <div class="card">
        <h2>注册设置</h2>
        <div class="row">
          <label class="switch"><input type="checkbox" id="openRegistration"> 开放注册</label>
          <label class="switch"><input type="checkbox" id="requireApproval"> 需要审核</label>
        </div>
        <button id="saveSettings" class="btn btn-xs">保存设置</button>
      </div>
      <div class="card">
        <h2>IP 访问控制</h2>
        <label for="ipMode">模式</label>
        <select id="ipMode"><option value="off">关闭</option><option value="blacklist">黑名单</option><option value="whitelist">白名单</option></select>
        <label for="ipList">名单（每行一个 IP / CIDR）</label>
        <textarea id="ipList" rows="3" placeholder="203.0.113.7&#10;192.168.1.0/24"></textarea>
        <div class="row"><label class="switch"><input type="checkbox" id="trustProxy"> 信任代理头 (X-Forwarded-For)</label></div>
        <button id="saveIp" class="btn btn-xs">保存 IP 设置</button>
      </div>
      <div class="card full">
        <h2>用户列表</h2>
        <div id="msg" class="msg"></div>
        <table><thead><tr><th>用户名</th><th>角色</th><th>状态</th><th>操作</th></tr></thead><tbody id="users"></tbody></table>
      </div>
    </div>
    <script>${managerScript()}</script>`,
  )
}

function managerScript(): string {
  return `(function(){
  function msg(t,ok){var e=document.getElementById('msg');e.className='msg '+(ok?'ok':'err');e.textContent=t;setTimeout(function(){e.textContent='';e.className='msg'},3000)}
  function api(path,opts){return fetch(path,opts).then(function(r){return r.json()}).then(function(j){if(!j.success)throw new Error(j.message);return j.data})}
  function json(body){return {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}}
  function loadMe(){api('/auth/api/me').then(function(u){document.getElementById('who').textContent=u.username+' · '+u.role;if(u.role!=='admin'){document.querySelector('.container').innerHTML='<div class="card full">需要管理员权限</div>'}})}
  function loadSettings(){api('/auth/api/settings').then(function(s){
    document.getElementById('openRegistration').checked=s.openRegistration;
    document.getElementById('requireApproval').checked=s.requireApproval;
    document.getElementById('ipMode').value=s.ipMode;
    document.getElementById('ipList').value=(s.ipList||[]).join('\\n');
    document.getElementById('trustProxy').checked=s.trustProxy;
  })}
  function loadUsers(){api('/auth/api/users').then(function(list){
    var tb=document.getElementById('users');tb.innerHTML='';
    if(!list.length){tb.innerHTML='<tr><td colspan=4 style="text-align:center;color:#94a3b8;padding:1.5rem">暂无用户</td></tr>';return}
    list.forEach(function(u){
      var tr=document.createElement('tr');var acts=[];
      if(u.status==='pending')acts.push('<button class="btn btn-xs" onclick=act(\\''+u.id+'\\',\\'approve\\')>通过</button>');
      if(u.status==='pending')acts.push('<button class="btn btn-danger btn-xs" onclick=act(\\''+u.id+'\\',\\'reject\\')>拒绝</button>');
      if(u.status==='active')acts.push('<button class="btn btn-ghost btn-xs" onclick=act(\\''+u.id+'\\',\\'disable\\')>停用</button>');
      if(u.status==='disabled'||u.status==='rejected')acts.push('<button class="btn btn-xs" onclick=act(\\''+u.id+'\\',\\'enable\\')>启用</button>');
      acts.push('<button class="btn btn-ghost btn-xs" onclick=resetPw(\\''+u.id+'\\')>改密</button>');
      acts.push('<select onchange=setRole(\\''+u.id+'\\',this.value)><option '+(u.role==='user'?'selected':'')+' value=user>user</option><option '+(u.role==='admin'?'selected':'')+' value=admin>admin</option></select>');
      tr.innerHTML='<td class="u-name">'+u.username+'</td><td><span class="badge role-'+u.role+'">'+u.role+'</span></td><td><span class="badge st-'+u.status+'">'+u.status+'</span></td><td class="actions">'+acts.join('')+'</td>';
      tb.appendChild(tr);
    });
  })}
  window.act=function(id,a){api('/auth/api/users/'+id+'/'+a,{method:'POST'}).then(function(){msg('已更新',true);loadUsers()}).catch(function(e){msg(e.message)})}
  window.setRole=function(id,role){api('/auth/api/users/'+id+'/role',json({role})).then(function(){msg('角色已更新',true);loadUsers()}).catch(function(e){msg(e.message)})}
  window.resetPw=function(id){var p=prompt('新密码（该用户所有登录令牌将失效）');if(p==null)return;if(!p){msg('密码不能为空');return}api('/auth/api/users/'+id+'/password',json({password:p})).then(function(){msg('密码已重置',true)}).catch(function(e){msg(e.message)})}
  document.getElementById('saveSettings').onclick=function(){api('/auth/api/settings',json({openRegistration:document.getElementById('openRegistration').checked,requireApproval:document.getElementById('requireApproval').checked})).then(function(){msg('设置已保存',true)}).catch(function(e){msg(e.message)})}
  document.getElementById('saveIp').onclick=function(){var list=document.getElementById('ipList').value.split('\\n').map(function(s){return s.trim()}).filter(Boolean);api('/auth/api/settings',json({ipMode:document.getElementById('ipMode').value,ipList:list,trustProxy:document.getElementById('trustProxy').checked})).then(function(){msg('IP 设置已保存',true)}).catch(function(e){msg(e.message)})}
  loadMe();loadSettings();loadUsers();
})()`
}
