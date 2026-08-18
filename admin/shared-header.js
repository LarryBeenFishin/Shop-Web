/* Shared admin dashboard controls for every nested admin page. */
(function(){
  function install(){
    const path=String(location.pathname||'').replace(/\/+$/,'')||'/';
    if(path==='/admin' || !path.startsWith('/admin/')) return;
    if(document.getElementById('sharedAdminHeader')) return;

    const cfg=window.SHOP_CONFIG||{};
    const style=document.createElement('style');
    style.id='sharedAdminHeaderStyles';
    style.textContent=`
      #sharedAdminHeader{background:#1a3455;color:#fff;width:100%;font-family:Arial,sans-serif;}
      #sharedAdminHeader *{box-sizing:border-box}
      #sharedAdminHeader .shared-admin-wrap{max-width:1380px;margin:0 auto;padding:22px 24px 26px;}
      #sharedAdminHeader .shared-admin-top{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:18px;}
      #sharedAdminHeader .shared-admin-shop{color:#fff;text-decoration:none;font-size:clamp(22px,3vw,34px);font-weight:900;letter-spacing:.01em;line-height:1.1;}
      #sharedAdminHeader .shared-admin-logout{border:0;border-radius:14px;background:#c72d2d;color:#fff;padding:13px 22px;font-size:16px;font-weight:900;cursor:pointer;min-width:112px;}
      #sharedAdminHeader .shared-admin-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;}
      #sharedAdminHeader .shared-admin-card{min-height:98px;background:#fff;color:#173457;text-decoration:none;border-radius:18px;padding:18px 20px;display:flex;align-items:center;gap:16px;border:1px solid rgba(255,255,255,.15);box-shadow:0 3px 10px rgba(5,20,40,.08);transition:transform .12s ease,box-shadow .12s ease;}
      #sharedAdminHeader .shared-admin-card:hover{transform:translateY(-1px);box-shadow:0 8px 20px rgba(5,20,40,.14)}
      #sharedAdminHeader .shared-admin-card.active{outline:3px solid rgba(36,161,95,.25)}
      #sharedAdminHeader .shared-admin-icon{width:52px;height:52px;flex:0 0 52px;border-radius:14px;background:#edf9f2;color:#24a15f;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:900;}
      #sharedAdminHeader .shared-admin-copy{min-width:0}
      #sharedAdminHeader .shared-admin-title{font-size:20px;font-weight:900;line-height:1.15;color:#173457;}
      #sharedAdminHeader .shared-admin-sub{font-size:13px;line-height:1.35;color:#526278;margin-top:4px;}
      #sharedAdminHeader .shared-admin-logout:hover{filter:brightness(.94)}
      @media(max-width:700px){
        #sharedAdminHeader .shared-admin-wrap{padding:18px 16px 20px;}
        #sharedAdminHeader .shared-admin-top{margin-bottom:14px;}
        #sharedAdminHeader .shared-admin-shop{font-size:24px;max-width:65%;}
        #sharedAdminHeader .shared-admin-logout{padding:11px 15px;font-size:15px;min-width:94px;}
        #sharedAdminHeader .shared-admin-grid{gap:10px;}
        #sharedAdminHeader .shared-admin-card{min-height:82px;padding:13px;gap:11px;border-radius:15px;}
        #sharedAdminHeader .shared-admin-icon{width:44px;height:44px;flex-basis:44px;font-size:24px;border-radius:12px;}
        #sharedAdminHeader .shared-admin-title{font-size:16px;}
        #sharedAdminHeader .shared-admin-sub{display:none;}
      }
      @media(max-width:470px){
        #sharedAdminHeader .shared-admin-grid{grid-template-columns:1fr;}
      }
    `;
    document.head.appendChild(style);

    const current=path;
    const cards=[
      {href:'/admin?newAppointment=1',icon:'🗓️',title:'New Appointment',sub:'Schedule a new service appointment',match:''},
      {href:'/admin/inspection',icon:'📋',title:'Inspection Form',sub:'Create a new inspection form',match:'/admin/inspection'},
      {href:'/admin/inspection-history',icon:'↶',title:'Inspection History',sub:'View past inspections',match:'/admin/inspection-history'},
      {href:'/admin/customers',icon:'👥',title:'Customer Profiles',sub:'Manage customer information',match:'/admin/customers'}
    ];

    const header=document.createElement('header');
    header.id='sharedAdminHeader';
    header.innerHTML=`
      <div class="shared-admin-wrap">
        <div class="shared-admin-top">
          <a class="shared-admin-shop" href="/admin"></a>
          <button class="shared-admin-logout" type="button">Log Out</button>
        </div>
        <nav class="shared-admin-grid" aria-label="Admin shortcuts">
          ${cards.map(c=>`<a class="shared-admin-card ${c.match&&current===c.match?'active':''}" href="${c.href}"><span class="shared-admin-icon" aria-hidden="true">${c.icon}</span><span class="shared-admin-copy"><span class="shared-admin-title">${c.title}</span><span class="shared-admin-sub">${c.sub}</span></span></a>`).join('')}
        </nav>
      </div>`;
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
