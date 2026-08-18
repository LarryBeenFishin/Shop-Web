/* Exact shared copy of the main admin action header for nested admin pages. */
(function(){
  function install(){
    const path=String(location.pathname||'').replace(/\/+$/,'')||'/';
    if(path==='/admin' || !path.startsWith('/admin/')) return;
    if(document.getElementById('sharedAdminHeader')) return;

    const cfg=window.SHOP_CONFIG||{};
    document.body.classList.add('shared-admin-nav-installed');

    const style=document.createElement('style');
    style.id='sharedAdminHeaderStyles';
    style.textContent=`
      #sharedAdminHeader{background:#163051;padding:26px;font-family:Arial,sans-serif;color:#163051;width:100%;}
      #sharedAdminHeader *{box-sizing:border-box}
      #sharedAdminHeader .admin-action-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;max-width:1500px;margin:0 auto}
      #sharedAdminHeader .admin-action-card{min-height:124px;border-radius:18px;background:#fff;color:#163051;display:flex;align-items:center;justify-content:flex-start;gap:22px;padding:22px 26px;text-align:left;text-decoration:none;box-shadow:0 12px 28px rgba(0,0,0,.16);transition:transform .15s ease;border:0;font-family:Arial,sans-serif;cursor:pointer;width:100%}
      #sharedAdminHeader .admin-action-card:hover{background:#fff;transform:translateY(-1px)}
      #sharedAdminHeader .logo-card{justify-content:center}
      #sharedAdminHeader .brand-box{background:#fff;color:#163051;border-radius:14px;padding:16px 22px;font-size:25px;font-weight:900;letter-spacing:-.04em;width:100%;text-align:center}
      #sharedAdminHeader .logout-card{justify-content:center;background:linear-gradient(135deg,#af2727,#cf2f2f)!important;color:#fff!important}
      #sharedAdminHeader .action-copy{min-width:0;display:flex;flex-direction:column;align-items:flex-start}
      #sharedAdminHeader .action-title{display:block;font-size:24px;font-weight:800;line-height:1.1;color:#163051}
      #sharedAdminHeader .action-subtitle{display:block;margin-top:8px;font-size:18px;font-weight:400;color:#3f4c5f;line-height:1.25}
      #sharedAdminHeader .logout-card .action-title{color:#fff;font-size:27px}
      #sharedAdminHeader .card-icon-wrap{width:64px;height:64px;min-width:64px;display:flex;align-items:center;justify-content:center}
      #sharedAdminHeader .card-svg{width:64px;height:64px;fill:none;stroke:#1d9958;stroke-width:5;stroke-linecap:round;stroke-linejoin:round;overflow:visible}
      #sharedAdminHeader .svg-fill{fill:#1d9958;stroke:#1d9958}
      #sharedAdminHeader .svg-white,#sharedAdminHeader .logout-svg{stroke:#fff}
      #sharedAdminHeader .active-page{outline:3px solid rgba(29,153,88,.35);outline-offset:-3px}
      body.shared-admin-nav-installed{padding:0!important}
      body.shared-admin-nav-installed .wrap{padding:18px}
      body.shared-admin-nav-installed main .hero,
      body.shared-admin-nav-installed .wrap>.top{display:none!important}
      @media(max-width:900px){
        #sharedAdminHeader{padding:24px 14px 26px}
        #sharedAdminHeader .admin-action-grid{gap:12px}
        #sharedAdminHeader .admin-action-card{min-height:78px;border-radius:14px;padding:14px;gap:12px;box-shadow:0 8px 18px rgba(0,0,0,.14)}
        #sharedAdminHeader .card-icon-wrap,#sharedAdminHeader .card-svg{width:48px;height:48px;min-width:48px}
        #sharedAdminHeader .action-title{font-size:15px}
        #sharedAdminHeader .action-subtitle{font-size:13px;margin-top:5px}
        #sharedAdminHeader .logout-card .action-title{font-size:18px}
        #sharedAdminHeader .brand-box{font-size:20px}
      }
      @media(max-width:430px){
        #sharedAdminHeader{padding:22px 12px 24px}
        #sharedAdminHeader .admin-action-grid{gap:10px}
        #sharedAdminHeader .admin-action-card{padding:12px}
        #sharedAdminHeader .action-title{font-size:14px}
        #sharedAdminHeader .action-subtitle{font-size:12px}
      }
    `;
    document.head.appendChild(style);

    const calendarIcon=`<span class="card-icon-wrap"><svg class="card-svg" viewBox="0 0 64 64"><rect x="10" y="14" width="38" height="36" rx="6"/><path d="M18 9v10M40 9v10M10 25h38M18 34h16M18 42h12"/><circle class="svg-fill" cx="47" cy="47" r="12"/><path class="svg-white" d="M47 40v14M40 47h14"/></svg></span>`;
    const inspectionIcon=`<span class="card-icon-wrap"><svg class="card-svg" viewBox="0 0 64 64"><rect x="15" y="13" width="34" height="42" rx="6"/><path d="M25 13c0-4 3-7 7-7s7 3 7 7M25 13h14M25 31h14M25 42h14"/></svg></span>`;
    const historyIcon=`<span class="card-icon-wrap"><svg class="card-svg" viewBox="0 0 64 64"><path d="M16 22A20 20 0 1 1 13 37"/><path d="M16 22H6V12"/><path d="M32 21v14h13"/></svg></span>`;
    const customersIcon=`<span class="card-icon-wrap"><svg class="card-svg" viewBox="0 0 64 64"><circle class="svg-fill" cx="25" cy="24" r="10"/><path class="svg-fill" d="M8 52c2-12 10-18 17-18s15 6 17 18H8z"/><circle class="svg-fill" cx="43" cy="27" r="8"/><path class="svg-fill" d="M36 52c2-9 8-14 14-14s11 5 13 14H36z"/></svg></span>`;
    const logoutIcon=`<span class="card-icon-wrap"><svg class="card-svg logout-svg" viewBox="0 0 64 64"><path d="M26 10H13v44h13M35 20l13 12-13 12M20 32h28"/></svg></span>`;

    const header=document.createElement('header');
    header.id='sharedAdminHeader';
    header.innerHTML=`<div class="admin-action-grid">
      <a class="admin-action-card logo-card" href="/admin"><div class="brand-box"></div></a>
      <a class="admin-action-card" href="/admin?newAppointment=1">${calendarIcon}<span class="action-copy"><span class="action-title">New Appointment</span><span class="action-subtitle">Schedule a new<br>service appointment</span></span></a>
      <a class="admin-action-card ${path==='/admin/inspection'?'active-page':''}" href="/admin/inspection">${inspectionIcon}<span class="action-copy"><span class="action-title">Inspection Form</span><span class="action-subtitle">Create a new<br>inspection form</span></span></a>
      <a class="admin-action-card ${path==='/admin/inspection-history'?'active-page':''}" href="/admin/inspection-history">${historyIcon}<span class="action-copy"><span class="action-title">Inspection History</span><span class="action-subtitle">View past<br>inspections</span></span></a>
      <a class="admin-action-card ${path==='/admin/customers'?'active-page':''}" href="/admin/customers">${customersIcon}<span class="action-copy"><span class="action-title">Customer Profiles</span><span class="action-subtitle">Manage customer<br>information</span></span></a>
      <button class="admin-action-card logout-card" type="button">${logoutIcon}<span class="action-title">Log Out</span></button>
    </div>`;

    header.querySelector('.brand-box').textContent=cfg.name||'YOUR SHOP NAME';
    header.querySelector('.logout-card').addEventListener('click',async()=>{
      const btn=header.querySelector('.logout-card');
      btn.disabled=true;
      try{await fetch('/api/admin-logout',{method:'POST'});}catch(e){console.error(e)}
      location.href='/admin';
    });
    document.body.insertBefore(header,document.body.firstChild);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})();
