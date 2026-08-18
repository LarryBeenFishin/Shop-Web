/* Shared copy of the LIVE main admin navigation for every nested admin page. */
(function(){
  function install(){
    const path=String(location.pathname||'').replace(/\/+$/,'')||'/';
    if(path==='/admin' || !path.startsWith('/admin/') || document.getElementById('sharedAdminHeader')) return;
    const cfg=window.SHOP_CONFIG||{};
    document.body.classList.add('shared-admin-nav-installed');

    const style=document.createElement('style');
    style.id='sharedAdminHeaderStyles';
    style.textContent=`
      #sharedAdminHeader{background:#163051;width:100%;font-family:Arial,sans-serif;color:#163051;border-bottom:1px solid rgba(255,255,255,.08)}
      #sharedAdminHeader *{box-sizing:border-box}
      #sharedAdminHeader .admin-action-grid{max-width:1500px;margin:0 auto;padding:14px 24px 18px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;align-items:stretch}
      #sharedAdminHeader .admin-action-card{border:0;font-family:Arial,sans-serif;cursor:pointer;text-decoration:none;display:flex;align-items:center;text-align:left;color:#163051}
      #sharedAdminHeader .logo-card{grid-column:1/4;min-height:52px;padding:0 4px;background:transparent!important;border:0!important;box-shadow:none!important;border-radius:0;justify-content:flex-start;pointer-events:none}
      #sharedAdminHeader .logo-card .brand-box{width:auto;padding:0;background:transparent;color:#fff;border-radius:0;box-shadow:none;text-align:left;font-size:24px;font-weight:900;letter-spacing:-.03em}
      #sharedAdminHeader .logout-card{grid-column:4;grid-row:1;justify-self:end;align-self:center;width:auto;min-width:112px;min-height:42px;padding:10px 16px;border-radius:11px;background:#af2727!important;color:#fff!important;box-shadow:none!important;gap:7px;justify-content:center}
      #sharedAdminHeader .logout-card:hover{background:#911f1f!important}
      #sharedAdminHeader .logout-card .card-icon-wrap{display:none}
      #sharedAdminHeader .logout-card .action-title{font-size:14px!important;line-height:1;color:#fff!important}
      #sharedAdminHeader .admin-action-card:not(.logo-card):not(.logout-card){min-height:82px;padding:14px 16px;gap:12px;border-radius:14px;border:1px solid rgba(22,48,81,.08);box-shadow:0 3px 10px rgba(5,18,36,.10);background:#fff;transition:border-color .15s ease,box-shadow .15s ease,transform .15s ease}
      #sharedAdminHeader .admin-action-card:not(.logo-card):not(.logout-card):hover{background:#fff;border-color:rgba(29,153,88,.42);box-shadow:0 7px 18px rgba(5,18,36,.14);transform:translateY(-1px)}
      #sharedAdminHeader .card-icon-wrap{width:42px;height:42px;min-width:42px;border-radius:11px;background:#edf9f2;display:flex;align-items:center;justify-content:center}
      #sharedAdminHeader .card-svg{width:30px;height:30px;fill:none;stroke:#1d9958;stroke-width:5;stroke-linecap:round;stroke-linejoin:round;overflow:visible}
      #sharedAdminHeader .svg-fill{fill:#1d9958;stroke:#1d9958}
      #sharedAdminHeader .svg-white,#sharedAdminHeader .logout-svg{stroke:#fff}
      #sharedAdminHeader .action-copy{min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:0}
      #sharedAdminHeader .action-title{display:block;font-size:16px;font-weight:800;line-height:1.15;letter-spacing:-.01em;color:#163051}
      #sharedAdminHeader .action-subtitle{display:block;margin-top:4px;font-size:12.5px;font-weight:400;line-height:1.25;color:#66758b}
      body.shared-admin-nav-installed{padding:0!important}
      body.shared-admin-nav-installed>.wrap{padding:18px!important}
      body.shared-admin-nav-installed main>.hero,body.shared-admin-nav-installed .wrap>.top{display:none!important}
      @media(max-width:900px){
        #sharedAdminHeader .admin-action-grid{grid-template-columns:repeat(2,minmax(0,1fr));padding:12px 14px 14px;gap:10px}
        #sharedAdminHeader .logo-card{grid-column:1;min-height:46px}
        #sharedAdminHeader .logo-card .brand-box{font-size:20px}
        #sharedAdminHeader .logout-card{grid-column:2;grid-row:1;min-height:38px;min-width:92px;padding:9px 13px}
        #sharedAdminHeader .admin-action-card:not(.logo-card):not(.logout-card){min-height:74px;padding:12px 13px}
        #sharedAdminHeader .card-icon-wrap{width:38px;height:38px;min-width:38px}
        #sharedAdminHeader .card-svg{width:27px;height:27px}
        #sharedAdminHeader .action-title{font-size:14px}
        #sharedAdminHeader .action-subtitle{font-size:11.5px;margin-top:3px}
      }
      @media(max-width:540px){
        #sharedAdminHeader .admin-action-grid{padding:10px 10px 12px;gap:8px}
        #sharedAdminHeader .logo-card .brand-box{font-size:17px}
        #sharedAdminHeader .logout-card{min-width:78px;padding:8px 11px}
        #sharedAdminHeader .logout-card .action-title{font-size:12px!important}
        #sharedAdminHeader .admin-action-card:not(.logo-card):not(.logout-card){min-height:64px;padding:10px;gap:8px}
        #sharedAdminHeader .card-icon-wrap{width:34px;height:34px;min-width:34px;border-radius:9px}
        #sharedAdminHeader .card-svg{width:24px;height:24px}
        #sharedAdminHeader .action-title{font-size:13px}
        #sharedAdminHeader .action-subtitle{display:none}
      }
    `;
    document.head.appendChild(style);

    const icons={
      calendar:`<span class="card-icon-wrap"><svg class="card-svg" viewBox="0 0 64 64"><rect x="10" y="14" width="38" height="36" rx="6"/><path d="M18 9v10M40 9v10M10 25h38M18 34h16M18 42h12"/><circle class="svg-fill" cx="47" cy="47" r="12"/><path class="svg-white" d="M47 40v14M40 47h14"/></svg></span>`,
      inspection:`<span class="card-icon-wrap"><svg class="card-svg" viewBox="0 0 64 64"><rect x="15" y="13" width="34" height="42" rx="6"/><path d="M25 13c0-4 3-7 7-7s7 3 7 7M25 13h14M25 31h14M25 42h14"/></svg></span>`,
      history:`<span class="card-icon-wrap"><svg class="card-svg" viewBox="0 0 64 64"><path d="M16 22A20 20 0 1 1 13 37"/><path d="M16 22H6V12"/><path d="M32 21v14h13"/></svg></span>`,
      customers:`<span class="card-icon-wrap"><svg class="card-svg" viewBox="0 0 64 64"><circle class="svg-fill" cx="25" cy="24" r="10"/><path class="svg-fill" d="M8 52c2-12 10-18 17-18s15 6 17 18H8z"/><circle class="svg-fill" cx="43" cy="27" r="8"/><path class="svg-fill" d="M36 52c2-9 8-14 14-14s11 5 13 14H36z"/></svg></span>`
    };
    const card=(href,icon,title,sub)=>`<a class="admin-action-card" href="${href}">${icon}<span class="action-copy"><span class="action-title">${title}</span><span class="action-subtitle">${sub}</span></span></a>`;
    const header=document.createElement('header');
    header.id='sharedAdminHeader';
    header.innerHTML=`<div class="admin-action-grid">
      <div class="admin-action-card logo-card"><div class="brand-box"></div></div>
      <button class="admin-action-card logout-card" type="button"><span class="action-title">Log Out</span></button>
      ${card('/admin?newAppointment=1',icons.calendar,'New Appointment','Schedule a new<br>service appointment')}
      ${card('/admin/inspection',icons.inspection,'Inspection Form','Create a new<br>inspection form')}
      ${card('/admin/inspection-history',icons.history,'Inspection History','View past<br>inspections')}
      ${card('/admin/customers',icons.customers,'Customer Profiles','Manage customer<br>information')}
    </div>`;
    header.querySelector('.brand-box').textContent=cfg.name||'YOUR SHOP NAME';
    header.querySelector('.logout-card').addEventListener('click',async()=>{try{await fetch('/api/admin-logout',{method:'POST'})}catch(e){} location.href='/admin'});
    document.body.insertBefore(header,document.body.firstChild);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
