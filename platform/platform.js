const state={shops:[],events:[],selectedId:null};
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const number=value=>new Intl.NumberFormat().format(Number(value)||0);
const date=value=>value?new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'Never';
const actionLabel=value=>String(value||'Platform updated').replaceAll('.',' ').replace(/\b\w/g,c=>c.toUpperCase());

async function api(action,options={}){
  const params=new URLSearchParams({action});
  for(const [key,value] of Object.entries(options.query||{}))params.set(key,value);
  const {query,...requestOptions}=options;
  const response=await fetch(`/api/platform-data?${params}`,{cache:'no-store',headers:{'Content-Type':'application/json',...(requestOptions.headers||{})},...requestOptions});
  const data=await response.json().catch(()=>({}));
  if(response.status===401){showLogin();throw new Error('Your owner session has expired')}
  if(!response.ok)throw new Error(data.error||'The platform could not complete that request');
  return data;
}
function toast(message,error=false){const node=$('toast');node.textContent=message;node.classList.toggle('error',error);node.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.classList.remove('show'),2600)}
function showLogin(){$('loginView').classList.remove('hidden');$('appView').classList.add('hidden')}
function showApp(){$('loginView').classList.add('hidden');$('appView').classList.remove('hidden')}
function initials(name){return String(name||'S').split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase()}
function selected(){return state.shops.find(shop=>shop.id===state.selectedId)}

async function load(){
  const data=await api('overview');state.shops=data.shops||[];state.events=data.events||[];render();showApp();
  if(state.selectedId){const exists=selected();if(exists)renderDetail(exists);else $('shopDialog').close()}
}
function render(){
  const active=state.shops.filter(shop=>shop.status==='active').length;
  const appointments=state.shops.reduce((sum,shop)=>sum+(shop.counts?.appointments||0),0);
  const complete=state.shops.filter(shop=>shop.migration?.status==='completed').length;
  $('totalShops').textContent=number(state.shops.length);$('activeShops').textContent=number(active);$('totalAppointments').textContent=number(appointments);$('transferCount').textContent=number(complete);
  $('totalShopsMeta').textContent=state.shops.length===1?'1 shop account':`${state.shops.length} shop accounts`;
  renderShops();renderActivity();
}
function renderShops(){
  const query=$('shopSearch').value.trim().toLowerCase(),status=$('statusFilter').value;
  const shops=state.shops.filter(shop=>{
    const haystack=[shop.name,shop.slug,...(shop.domains||[]).map(domain=>domain.hostname)].join(' ').toLowerCase();
    return (!query||haystack.includes(query))&&(status==='all'||shop.status===status);
  });
  $('shopList').innerHTML=shops.length?shops.map(shop=>{
    const primary=(shop.domains||[]).find(domain=>domain.is_primary)||(shop.domains||[])[0];
    const counts=shop.counts||{};
    return `<article class="shop-row" tabindex="0" role="button" data-shop-id="${esc(shop.id)}" aria-label="Manage ${esc(shop.name)}"><div class="shop-name"><div class="shop-avatar">${esc(initials(shop.name))}</div><div><strong>${esc(shop.name)}</strong><small>${esc(shop.slug)} · ${number((shop.admins||[]).filter(admin=>admin.active).length)} admin${(shop.admins||[]).filter(admin=>admin.active).length===1?'':'s'}</small></div></div><div class="domain-cell"><strong>${esc(primary?.hostname||'No domain mapped')}</strong><small>${primary?.is_primary?'Primary domain':'Domain setup needed'}</small></div><div class="activity-counts"><span class="count-chip">${number(counts.customers)} customers</span><span class="count-chip">${number(counts.inspections)} inspections</span><span class="count-chip">${number(counts.technicians)} techs</span></div><span class="status-badge status-${esc(shop.status)}">${esc(shop.status)}</span><span class="chevron">›</span></article>`;
  }).join(''):'<div class="empty"><strong>No shops found</strong>Try a different search or add a shop.</div>';
  document.querySelectorAll('[data-shop-id]').forEach(row=>{row.addEventListener('click',()=>openShop(row.dataset.shopId));row.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openShop(row.dataset.shopId)}})});
}
function renderActivity(){
  $('activityList').innerHTML=state.events.length?state.events.map(event=>{
    const shop=state.shops.find(item=>item.id===event.shop_id);
    return `<div class="activity-item"><div class="activity-icon">${esc(initials(shop?.name||'P'))}</div><div><strong>${esc(actionLabel(event.action))}</strong><small>${esc(shop?.name||'Platform')} ${event.metadata?.username?`· ${esc(event.metadata.username)}`:''}</small></div><time class="activity-time">${esc(date(event.created_at))}</time></div>`;
  }).join(''):'<div class="empty"><strong>No platform activity yet</strong>Changes made here will be recorded.</div>';
}

async function login(event){
  event.preventDefault();$('loginError').textContent='';
  const response=await fetch('/api/platform-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('ownerUsername').value,password:$('ownerPassword').value})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){$('loginError').textContent=data.error||'Could not sign in';return}
  $('ownerPassword').value='';
  try{await load()}catch(error){$('loginError').textContent=error.message}
}
async function logout(){await fetch('/api/platform-logout',{method:'POST'}).catch(()=>{});showLogin()}
function slugify(value){return String(value||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}
async function createShop(event){
  event.preventDefault();
  if(event.submitter?.value==='cancel'){$('createShopDialog').close();return}
  const form=event.currentTarget,data=Object.fromEntries(new FormData(form));$('createShopError').textContent='';$('createShopSubmit').disabled=true;
  try{await api('shop',{method:'POST',body:JSON.stringify(data)});form.reset();$('createShopDialog').close();await load();toast(`${data.name} was created`)}catch(error){$('createShopError').textContent=error.message}finally{$('createShopSubmit').disabled=false}
}
function openShop(id){state.selectedId=id;const shop=selected();if(!shop)return;renderDetail(shop);$('shopDialog').showModal()}
function renderDetail(shop){
  $('detailTitle').textContent=shop.name;$('detailSubtitle').textContent=shop.slug;$('detailStatus').className=`status-badge status-${shop.status}`;$('detailStatus').textContent=shop.status;
  const form=$('shopDetailsForm'),contact=shop.public_config?.contact||{},brand=shop.public_config?.brand||{};
  for(const [name,value] of Object.entries({name:shop.name,slug:shop.slug,timezone:shop.timezone,status:shop.status,notification_email:shop.notification_email||'',logo_url:brand.logo_url||'',contact_name:contact.name||'',contact_email:contact.email||'',contact_phone:contact.phone||''})){if(form.elements[name])form.elements[name].value=value}
  const primary=(shop.domains||[]).find(domain=>domain.is_primary)||(shop.domains||[])[0];
  $('openAdminLink').href=primary?`https://${primary.hostname}/admin`:'#';$('openAdminLink').classList.toggle('hidden',!primary);
  renderDomains(shop);renderAdmins(shop);renderDetailMetrics(shop);renderMigration(shop);
}
function renderDetailMetrics(shop){const counts=shop.counts||{};$('detailMetrics').innerHTML=[['Appointments',counts.appointments],['Customers',counts.customers],['Inspections',counts.inspections],['Technicians',counts.technicians]].map(([label,value])=>`<div class="mini-metric"><strong>${number(value)}</strong><span>${label}</span></div>`).join('')}
function renderDomains(shop){
  $('domainList').innerHTML=(shop.domains||[]).length?shop.domains.map(domain=>`<div class="managed-row"><div><strong>${esc(domain.hostname)}</strong><small>${domain.is_primary?'Primary · mapped':'Mapped domain'}</small></div><div class="row-actions">${domain.is_primary?'':`<button class="tiny-button" data-primary-domain="${esc(domain.id)}">Make primary</button>`}<button class="tiny-button danger" data-delete-domain="${esc(domain.id)}">Remove</button></div></div>`).join(''):'<div class="empty"><strong>No domains mapped</strong>Add the shop’s website domain below.</div>';
  document.querySelectorAll('[data-primary-domain]').forEach(button=>button.onclick=()=>setPrimaryDomain(button.dataset.primaryDomain));
  document.querySelectorAll('[data-delete-domain]').forEach(button=>button.onclick=()=>deleteDomain(button.dataset.deleteDomain));
}
function renderAdmins(shop){
  $('adminList').innerHTML=(shop.admins||[]).length?shop.admins.map(admin=>`<div class="managed-row"><div><strong>${esc(admin.name)} · ${esc(admin.username)}</strong><small>${admin.active?'Active':'Disabled'} · Last sign-in: ${esc(date(admin.last_login_at))}</small></div><div class="row-actions"><button class="tiny-button" data-reset-admin="${esc(admin.id)}">Reset password</button><button class="tiny-button ${admin.active?'danger':''}" data-toggle-admin="${esc(admin.id)}" data-active="${admin.active?'false':'true'}">${admin.active?'Disable':'Enable'}</button></div></div>`).join(''):'<div class="empty"><strong>No admin accounts</strong>Add the first shop administrator below.</div>';
  document.querySelectorAll('[data-reset-admin]').forEach(button=>button.onclick=()=>resetAdmin(button.dataset.resetAdmin));
  document.querySelectorAll('[data-toggle-admin]').forEach(button=>button.onclick=()=>toggleAdmin(button.dataset.toggleAdmin,button.dataset.active==='true'));
}
function renderMigration(shop){const migration=shop.migration||{};const form=$('migrationForm');form.elements.status.value=migration.status||'not_started';form.elements.source.value=migration.source||'';form.elements.notes.value=migration.notes||''}

async function saveShop(event){event.preventDefault();const shop=selected(),data=Object.fromEntries(new FormData(event.currentTarget));data.id=shop.id;try{await api('shop',{method:'PATCH',body:JSON.stringify(data)});await load();toast('Shop details saved')}catch(error){showDialogError(error)}}
async function addDomain(event){event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));data.shop_id=state.selectedId;data.is_primary=event.currentTarget.elements.is_primary.checked;try{await api('domain',{method:'POST',body:JSON.stringify(data)});event.currentTarget.reset();await load();toast('Domain added')}catch(error){showDialogError(error)}}
async function setPrimaryDomain(id){try{await api('domain',{method:'PATCH',body:JSON.stringify({id,shop_id:state.selectedId,is_primary:true})});await load();toast('Primary domain updated')}catch(error){showDialogError(error)}}
async function deleteDomain(id){if(!confirm('Remove this domain mapping?'))return;try{await api('domain',{method:'DELETE',query:{id,shop_id:state.selectedId}});await load();toast('Domain removed')}catch(error){showDialogError(error)}}
async function addAdmin(event){event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));data.shop_id=state.selectedId;try{await api('admin',{method:'POST',body:JSON.stringify(data)});event.currentTarget.reset();await load();toast('Administrator added')}catch(error){showDialogError(error)}}
async function toggleAdmin(id,active){try{await api('admin',{method:'PATCH',body:JSON.stringify({id,shop_id:state.selectedId,active})});await load();toast(active?'Administrator enabled':'Administrator disabled')}catch(error){showDialogError(error)}}
async function resetAdmin(id){const password=prompt('Enter a new temporary password (at least 8 characters):');if(password===null)return;if(password.length<8){showDialogError(new Error('Password must be at least 8 characters'));return}try{await api('admin',{method:'PATCH',body:JSON.stringify({id,shop_id:state.selectedId,password})});toast('Temporary password updated')}catch(error){showDialogError(error)}}
async function saveMigration(event){event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));data.shop_id=state.selectedId;try{await api('migration',{method:'PATCH',body:JSON.stringify(data)});await load();toast('Transfer status updated')}catch(error){showDialogError(error)}}
function showDialogError(error){$('shopDialogError').textContent=error.message;toast(error.message,true);setTimeout(()=>$('shopDialogError').textContent='',4000)}

$('loginForm').addEventListener('submit',login);$('logoutButton').addEventListener('click',logout);$('newShopButton').addEventListener('click',()=>{$('createShopError').textContent='';delete $('createShopForm').elements.slug.dataset.edited;$('createShopDialog').showModal()});$('createShopForm').addEventListener('submit',createShop);$('createShopForm').elements.name.addEventListener('input',event=>{const slug=$('createShopForm').elements.slug;if(!slug.dataset.edited)slug.value=slugify(event.target.value)});$('createShopForm').elements.slug.addEventListener('input',event=>event.target.dataset.edited='true');$('closeShopDialog').addEventListener('click',()=>$('shopDialog').close());$('shopDetailsForm').addEventListener('submit',saveShop);$('addDomainForm').addEventListener('submit',addDomain);$('addAdminForm').addEventListener('submit',addAdmin);$('migrationForm').addEventListener('submit',saveMigration);$('shopSearch').addEventListener('input',renderShops);$('statusFilter').addEventListener('change',renderShops);$('menuButton').addEventListener('click',()=>document.body.classList.toggle('menu-open'));$('menuScrim').addEventListener('click',()=>document.body.classList.remove('menu-open'));document.querySelectorAll('.sidebar nav a').forEach(link=>link.addEventListener('click',()=>document.body.classList.remove('menu-open')));
load().catch(error=>{if(!/session|Unauthorized/i.test(error.message))$('loginError').textContent=error.message;showLogin()});
