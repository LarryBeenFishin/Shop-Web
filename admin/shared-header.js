/* Shared admin header for every nested admin page. */
(function(){
  function install(){
    const path=String(location.pathname||'').replace(/\/+$/,'')||'/';
    if(path==='/admin' || !path.startsWith('/admin/')) return;
    if(document.getElementById('sharedAdminHeader')) return;

    const cfg=window.SHOP_CONFIG||{};
    const style=document.createElement('style');
    style.id='sharedAdminHeaderStyles';
    style.textContent=`
      #sharedAdminHeader{background:#1a3455;color:#fff;width:100%;}
      #sharedAdminHeader .shared-admin-header-inner{max-width:1380px;margin:0 auto;padding:22px 24px;display:flex;align-items:center;justify-content:space-between;gap:18px;}
      #sharedAdminHeader .shared-admin-shop{color:#fff;text-decoration:none;font-size:clamp(22px,3vw,34px);font-weight:900;letter-spacing:.01em;line-height:1.1;}
      #sharedAdminHeader .shared-admin-logout{border:0;border-radius:14px;background:#c72d2d;color:#fff;padding:13px 22px;font-size:16px;font-weight:900;cursor:pointer;min-width:112px;}
      #sharedAdminHeader .shared-admin-logout:hover{filter:brightness(.94)}
      @media(max-width:700px){
        #sharedAdminHeader .shared-admin-header-inner{padding:18px 20px;}
        #sharedAdminHeader .shared-admin-shop{font-size:24px;max-width:68%;}
        #sharedAdminHeader .shared-admin-logout{padding:11px 16px;font-size:15px;min-width:96px;}
      }
    `;
    document.head.appendChild(style);

    const header=document.createElement('header');
    header.id='sharedAdminHeader';
    header.innerHTML=`<div class="shared-admin-header-inner"><a class="shared-admin-shop" href="/admin"></a><button class="shared-admin-logout" type="button">Log Out</button></div>`;
    header.querySelector('.shared-admin-shop').textContent=cfg.name||'YOUR SHOP NAME';
    header.querySelector('.shared-admin-logout').addEventListener('click',async()=>{
      const btn=header.querySelector('.shared-admin-logout');
      btn.disabled=true;
      btn.textContent='Logging Out…';
      try{await fetch('/api/admin-logout',{method:'POST'});}catch(e){console.error(e)}
      location.href='/admin';
    });
    document.body.insertBefore(header,document.body.firstChild);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})();
