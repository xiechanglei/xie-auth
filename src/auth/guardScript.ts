/** 客户端守卫脚本内容（由库在 /auth/xie-auth.js 提供） */
export function guardScript(): string {
  return `;(function(){
  var script = document.currentScript || (function(){var s=document.getElementsByTagName('script');return s[s.length-1]})();
  function redirectToLogin(){
    var back = encodeURIComponent(location.pathname + location.search);
    location.href = '/auth/login.html?redirect=' + back;
  }
  window.XieAuth = {
    getUser: function(){ return fetch('/auth/api/me').then(function(r){return r.json()}).then(function(j){return j.success?j.data:null}) },
    isLoggedIn: function(){ return this.getUser().then(function(u){return !!u}) },
    redirectToLogin: redirectToLogin,
    logout: function(){ return fetch('/auth/api/logout',{method:'POST'}).then(function(){location.href='/auth/login.html'}) },
    login: function(u,p){ return fetch('/auth/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})}).then(function(r){return r.json()}) }
  };
  function handle401(){ if(script && script.hasAttribute('data-required')) redirectToLogin(); }
  var origFetch = window.fetch;
  window.fetch = function(){ return origFetch.apply(this,arguments).then(function(res){ if(res.status===401) handle401(); return res }) };
  var origOpen = XMLHttpRequest.prototype.open, origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(){this.__m=arguments[0];this.__u=arguments[1];return origOpen.apply(this,arguments)};
  XMLHttpRequest.prototype.send=function(){ var x=this; x.addEventListener('load',function(){ if(x.status===401) handle401() }); return origSend.apply(this,arguments) };
  if(script && script.hasAttribute('data-required')){
    var needRole = script.getAttribute('data-role');
    window.XieAuth.getUser().then(function(u){
      if(!u){ redirectToLogin(); return }
      if(needRole && u.role!==needRole){ document.body.innerHTML='<div style="padding:2rem">需要 '+needRole+' 权限，<a href="/auth/login.html">重新登录</a></div>'; }
    });
  }
})();`
}
