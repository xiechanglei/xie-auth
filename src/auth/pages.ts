const baseStyle = `<style>
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;max-width:880px;margin:2rem auto;padding:0 1rem;color:#222;background:#fafafa}
.card{background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:1.5rem;margin-bottom:1rem;box-shadow:0 1px 3px rgba(0,0,0,.05)}
h1{font-size:1.4rem} h2{font-size:1.1rem;margin-top:0}
input,select,button{font:inherit;padding:.5rem .6rem;border:1px solid #ccc;border-radius:6px}
button{cursor:pointer;background:#2563eb;color:#fff;border:none}button.sec{background:#e5e7eb;color:#222}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #eee;padding:.5rem;text-align:left;font-size:.9rem}
.row{display:flex;gap:.5rem;align-items:center;margin:.4rem 0;flex-wrap:wrap}
.msg{padding:.5rem;border-radius:6px;margin:.5rem 0}.err{background:#fee2e2;color:#b91c1c}.ok{background:#dcfce7;color:#166534}
label{min-width:8rem;color:#555}code{background:#f3f4f6;padding:.1rem .3rem;border-radius:4px}
</style>`

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${baseStyle}</head><body>${body}</body></html>`
}

export function loginPage(): string {
  return shell(
    '登录',
    `<div class="card" style="max-width:420px;margin:3rem auto">
      <h1>登录</h1>
      <div id="msg"></div>
      <div class="row"><label>用户名</label><input id="username" autocomplete="username"></div>
      <div class="row"><label>密码</label><input id="password" type="password" autocomplete="current-password"></div>
      <div class="row"><button id="submit">登录</button> <a href="/auth/register.html">注册</a></div>
    </div>
    <script>${authPageScript('login')}</script>`,
  )
}

export function registerPage(): string {
  return shell(
    '注册',
    `<div class="card" style="max-width:420px;margin:3rem auto">
      <h1>注册</h1>
      <div id="msg"></div>
      <div class="row"><label>用户名</label><input id="username"></div>
      <div class="row"><label>密码</label><input id="password" type="password"></div>
      <div class="row"><label>确认密码</label><input id="password2" type="password"></div>
      <div class="row"><button id="submit">注册</button> <a href="/auth/login.html">返回登录</a></div>
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
  document.getElementById('submit').onclick=function(){
    var u=document.getElementById('username').value.trim();
    var p=document.getElementById('password').value;
    if(!u||!p){msg('用户名和密码不能为空');return}
    var body={username:u,password:p};
    ${mode === 'register' ? "var p2=document.getElementById('password2').value;if(p!==p2){msg('两次密码不一致');return}body.password2=p2;" : ''}
    fetch('/auth/api/${mode}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){return r.json()}).then(function(j){
      if(!j.success){msg(j.message||'失败');return}
      ${mode === 'register' ? "if(j.data&&j.data.needApproval){msg('注册成功，等待管理员审核',true);setTimeout(function(){location.href='/auth/login.html'},1500);return}" : ''}
      location.href=back();
    }).catch(function(e){msg('请求出错:'+e.message)})
  }
})()`
}

export function managerPage(): string {
  return shell(
    '用户管理',
    `<h1>后台管理</h1>
    <div class="card">
      <h2>当前用户 <span id="who"></span></h2>
      <div class="row"><button class="sec" onclick="fetch('/auth/api/logout',{method:'POST'}).then(function(){location.href='/auth/login.html'})">登出</button></div>
    </div>
    <div class="card">
      <h2>注册设置</h2>
      <div class="row"><label>开放注册</label><input type="checkbox" id="openRegistration"><label style="min-width:auto">需要审核</label><input type="checkbox" id="requireApproval"><button id="saveSettings">保存</button></div>
    </div>
    <div class="card">
      <h2>IP 访问控制</h2>
      <div class="row"><label>模式</label><select id="ipMode"><option value="off">关闭</option><option value="blacklist">黑名单</option><option value="whitelist">白名单</option></select></div>
      <div class="row"><label>名单(每行一个IP/CIDR)</label></div>
      <div class="row"><textarea id="ipList" rows="3" style="width:100%;font:inherit;padding:.5rem;border:1px solid #ccc;border-radius:6px"></textarea></div>
      <div class="row"><label>信任代理头</label><input type="checkbox" id="trustProxy"><button id="saveIp">保存</button></div>
    </div>
    <div class="card">
      <h2>用户列表</h2>
      <div id="msg"></div>
      <table><thead><tr><th>用户名</th><th>角色</th><th>状态</th><th>操作</th></tr></thead><tbody id="users"></tbody></table>
    </div>
    <script>${managerScript()}</script>`,
  )
}

function managerScript(): string {
  return `(function(){
  function msg(t,ok){var e=document.getElementById('msg');e.className='msg '+(ok?'ok':'err');e.textContent=t;setTimeout(function(){e.textContent='';e.className=''},3000)}
  function api(path,opts){return fetch(path,opts).then(function(r){return r.json()}).then(function(j){if(!j.success)throw new Error(j.message);return j.data})}
  function json(body){return {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}}
  function loadMe(){api('/auth/api/me').then(function(u){document.getElementById('who').textContent=u.username+' ('+u.role+')';if(u.role!=='admin'){document.body.innerHTML='<div class=card>需要管理员权限</div>'}})}
  function loadSettings(){api('/auth/api/settings').then(function(s){
    document.getElementById('openRegistration').checked=s.openRegistration;
    document.getElementById('requireApproval').checked=s.requireApproval;
    document.getElementById('ipMode').value=s.ipMode;
    document.getElementById('ipList').value=(s.ipList||[]).join('\\n');
    document.getElementById('trustProxy').checked=s.trustProxy;
  })}
  function loadUsers(){api('/auth/api/users').then(function(list){
    var tb=document.getElementById('users');tb.innerHTML='';
    list.forEach(function(u){
      var tr=document.createElement('tr');
      var acts=[];
      if(u.status==='pending')acts.push('<button onclick=act(\\''+u.id+'\\',\\'approve\\')>通过</button> <button class=sec onclick=act(\\''+u.id+'\\',\\'reject\\')>拒绝</button>');
      if(u.status==='active')acts.push('<button class=sec onclick=act(\\''+u.id+'\\',\\'disable\\')>停用</button>');
      if(u.status==='disabled'||u.status==='rejected')acts.push('<button onclick=act(\\''+u.id+'\\',\\'enable\\')>启用</button>');
      acts.push('<button class=sec onclick=resetPw(\\''+u.id+'\\')>改密</button>');
      acts.push('<select onchange=setRole(\\''+u.id+'\\',this.value)><option '+(u.role==='user'?'selected':'')+' value=user>user</option><option '+(u.role==='admin'?'selected':'')+' value=admin>admin</option></select>');
      tr.innerHTML='<td>'+u.username+'</td><td>'+u.role+'</td><td>'+u.status+'</td><td>'+acts.join(' ')+'</td>';
      tb.appendChild(tr);
    });
  })}
  window.act=function(id,a){api('/auth/api/users/'+id+'/'+a,{method:'POST'}).then(function(){msg('已更新',true);loadUsers()}).catch(function(e){msg(e.message)})}
  window.setRole=function(id,role){api('/auth/api/users/'+id+'/role',json({role})).then(function(){msg('角色已更新',true);loadUsers()}).catch(function(e){msg(e.message)})}
  window.resetPw=function(id){var p=prompt('新密码（该用户所有登录令牌将失效）');if(p==null)return;api('/auth/api/users/'+id+'/password',json({password:p})).then(function(){msg('密码已重置',true)}).catch(function(e){msg(e.message)})}
  document.getElementById('saveSettings').onclick=function(){api('/auth/api/settings',json({openRegistration:document.getElementById('openRegistration').checked,requireApproval:document.getElementById('requireApproval').checked})).then(function(){msg('设置已保存',true)}).catch(function(e){msg(e.message)})}
  document.getElementById('saveIp').onclick=function(){var list=document.getElementById('ipList').value.split('\\n').map(function(s){return s.trim()}).filter(Boolean);api('/auth/api/settings',json({ipMode:document.getElementById('ipMode').value,ipList:list,trustProxy:document.getElementById('trustProxy').checked})).then(function(){msg('IP 设置已保存',true)}).catch(function(e){msg(e.message)})}
  loadMe();loadSettings();loadUsers();
})()`
}
