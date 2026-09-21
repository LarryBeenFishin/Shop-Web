const state={shops:[],events:[],selectedId:null,createStep:0,importSetupRequired:false,importFile:null,importRows:[],importPreview:null};
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
async function importApi(action,body){
  const response=await fetch(`/api/platform-import?action=${encodeURIComponent(action)}`,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  if(response.status===401){showLogin();throw new Error('Your owner session has expired')}
  if(!response.ok)throw new Error(data.error||'The data transfer could not complete that request');
  return data;
}
function toast(message,error=false){const node=$('toast');node.textContent=message;node.classList.toggle('error',error);node.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.classList.remove('show'),2600)}
function showLogin(){$('loginView').classList.remove('hidden');$('appView').classList.add('hidden')}
function showApp(){$('loginView').classList.add('hidden');$('appView').classList.remove('hidden')}
function initials(name){return String(name||'S').split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase()}
function selected(){return state.shops.find(shop=>shop.id===state.selectedId)}

async function load(){
  const data=await api('overview');state.shops=data.shops||[];state.events=data.events||[];state.importSetupRequired=data.import_setup_required===true;render();showApp();
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
    const counts=shop.counts||{},setupSteps=onboardingSteps(shop),setupComplete=setupSteps.filter(step=>step.complete).length;
    return `<article class="shop-row" tabindex="0" role="button" data-shop-id="${esc(shop.id)}" aria-label="Manage ${esc(shop.name)}"><div class="shop-name"><div class="shop-avatar">${esc(initials(shop.name))}</div><div><strong>${esc(shop.name)}</strong><small>${esc(shop.slug)} · ${number((shop.admins||[]).filter(admin=>admin.active).length)} admin${(shop.admins||[]).filter(admin=>admin.active).length===1?'':'s'}</small></div></div><div class="domain-cell"><strong>${esc(primary?.hostname||'No domain mapped')}</strong><small>${primary?.is_primary?'Primary domain':'Domain setup needed'}</small></div><div class="activity-counts"><span class="count-chip">Setup ${setupComplete}/7</span><span class="count-chip">${number(counts.customers)} customers</span><span class="count-chip">${number(counts.inspections)} inspections</span><span class="count-chip">${number(counts.technicians)} techs</span></div><span class="status-badge status-${esc(shop.status)}">${esc(shop.status)}</span><span class="chevron">›</span></article>`;
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
function createShopFields(){return $('createShopForm').elements}
function resetCreateShop(){
  const form=$('createShopForm');form.reset();state.createStep=0;$('createShopError').textContent='';$('createShopConfirm').checked=false;
  for(const name of ['slug','notification_email','admin_name','admin_username','admin_email'])delete form.elements[name].dataset.edited;
  showCreateStep();
}
function currentCreatePanel(){return document.querySelector(`[data-create-step="${state.createStep}"]`)}
function validateCreateStep(){
  const fields=[...currentCreatePanel().querySelectorAll('input,select,textarea')];
  for(const field of fields){if(!field.checkValidity()){field.reportValidity();return false}}
  return true;
}
function createReviewRow(label,value){return `<div><span>${esc(label)}</span><strong>${esc(value||'Not provided')}</strong></div>`}
function renderCreateShopReview(){
  const fields=createShopFields();
  $('createShopReview').innerHTML=[
    createReviewRow('Business',fields.name.value),createReviewRow('Shop slug',fields.slug.value),createReviewRow('Timezone',fields.timezone.value),
    createReviewRow('Primary contact',fields.contact_name.value),createReviewRow('Contact email',fields.contact_email.value),createReviewRow('Contact phone',fields.contact_phone.value),
    createReviewRow('Appointment alerts',fields.notification_email.value),createReviewRow('Domain',fields.primary_domain.value||'Add after creation'),
    createReviewRow('Owner login',`${fields.admin_name.value} · ${fields.admin_username.value}`),createReviewRow('Recovery email',fields.admin_email.value)
  ].join('');
}
function showCreateStep(){
  const panels=[...document.querySelectorAll('[data-create-step]')],steps=[...$('createShopProgress').children];
  panels.forEach((panel,index)=>{const active=index===state.createStep;panel.hidden=!active;panel.classList.toggle('active',active)});
  steps.forEach((step,index)=>{step.classList.toggle('active',index===state.createStep);step.classList.toggle('complete',index<state.createStep)});
  $('createShopBack').classList.toggle('hidden',state.createStep===0);$('createShopNext').classList.toggle('hidden',state.createStep===panels.length-1);$('createShopSubmit').classList.toggle('hidden',state.createStep!==panels.length-1);
  if(state.createStep===panels.length-1)renderCreateShopReview();
  const first=panels[state.createStep].querySelector('input,select');if(first)setTimeout(()=>first.focus(),40);
}
function nextCreateStep(){if(!validateCreateStep())return;state.createStep=Math.min(4,state.createStep+1);showCreateStep()}
function previousCreateStep(){state.createStep=Math.max(0,state.createStep-1);showCreateStep()}
async function createShop(event){
  event.preventDefault();
  if(event.submitter?.value==='cancel'){$('createShopDialog').close();return}
  if(state.createStep!==4){nextCreateStep();return}
  const form=event.currentTarget;if(!form.reportValidity())return;
  const data=Object.fromEntries(new FormData(form));$('createShopError').textContent='';$('createShopSubmit').disabled=true;$('createShopSubmit').textContent='Creating…';
  try{
    await api('shop',{method:'POST',body:JSON.stringify(data)});$('createShopDialog').close();await load();
    const created=state.shops.find(shop=>shop.slug===data.slug);if(created)openShop(created.id);
    resetCreateShop();toast(`${data.name} was created. Continue with the setup guide.`)
  }catch(error){$('createShopError').textContent=error.message}
  finally{$('createShopSubmit').disabled=false;$('createShopSubmit').textContent='Create shop'}
}
function openShop(id){state.selectedId=id;resetImport();const shop=selected();if(!shop)return;renderDetail(shop);$('shopDialog').showModal()}
function renderDetail(shop){
  $('detailTitle').textContent=shop.name;$('detailSubtitle').textContent=shop.slug;$('detailStatus').className=`status-badge status-${shop.status}`;$('detailStatus').textContent=shop.status;
  const form=$('shopDetailsForm'),contact=shop.public_config?.contact||{},brand=shop.public_config?.brand||{};
  for(const [name,value] of Object.entries({name:shop.name,slug:shop.slug,timezone:shop.timezone,status:shop.status,notification_email:shop.notification_email||'',logo_url:brand.logo_url||'',contact_name:contact.name||'',contact_email:contact.email||'',contact_phone:contact.phone||''})){if(form.elements[name])form.elements[name].value=value}
  const primary=(shop.domains||[]).find(domain=>domain.is_primary)||(shop.domains||[])[0];
  $('openWebsiteLink').href=primary?`https://${primary.hostname}`:'#';$('openWebsiteLink').classList.toggle('hidden',!primary);
  $('openAdminLink').href=primary?`https://${primary.hostname}/admin`:'#';$('openAdminLink').classList.toggle('hidden',!primary);
  renderOnboarding(shop);renderDomains(shop);renderAdmins(shop);renderDetailMetrics(shop);renderMigration(shop);
}
function setupStepComplete(shop,key){return Boolean(shop.public_config?.onboarding?.[key])}
function onboardingSteps(shop){
  const contact=shop.public_config?.contact||{},hasDomain=(shop.domains||[]).length>0;
  return [
    {title:'Confirm business and contact details',description:'Verify the customer record before creating any connected services.',items:['Official business name, timezone, owner name, email, and phone are correct.','Appointment notification email is the inbox the shop actively monitors.'],complete:Boolean(shop.name&&shop.timezone&&shop.notification_email&&contact.name&&contact.email&&contact.phone),target:'shopDetailsSection'},
    {title:'Confirm the owner login',description:'Make sure the owner has a recoverable account limited to this shop.',items:['Administrator is active and the username was given to the correct owner.','Recovery email belongs to the owner and can receive password-reset messages.'],complete:(shop.admins||[]).some(admin=>admin.active&&admin.email),target:'adminsSection'},
    {title:'Connect the website deployment and domain',description:'Create a separate deployment from the shared codebase.',items:['Create a new Vercel project from the same Shop-Web GitHub repository.','Copy the shared Supabase and communication environment variables.','Set SHOP_SLUG to this shop’s slug and create a unique ADMIN_SESSION_SECRET.',`Deploy, test the preview, connect the primary domain, and save that domain here. Current slug: ${shop.slug}`],complete:hasDomain&&setupStepComplete(shop,'deployment_complete'),key:'deployment_complete',target:'domainsSection',requirement:hasDomain?'':'Add a domain before completing this step.'},
    {title:'Configure the shop workspace',description:'Open the shop admin and tailor the working account.',items:['Confirm the business name and appointment-notification email.','Set weekly appointment hours, time slots, closures, and booking limits.','Review inspection blocks and text-message templates.','Create technician accounts with recovery emails.'],complete:setupStepComplete(shop,'workspace_complete'),key:'workspace_complete',target:'admin'},
    {title:'Connect and test communications',description:'Finish email and texting before real customers use the site.',items:['Verify the sending domain and connect the Resend API key and sender address.','Connect the shop’s Twilio number and set the incoming-message webhook.','Test owner and technician password recovery.','Create a test appointment, confirm the owner alert and customer confirmation, then send and receive a text.'],complete:setupStepComplete(shop,'communications_complete'),key:'communications_complete'},
    {title:'Transfer and verify existing data',description:'Move real records only after the empty shop has passed setup checks.',items:['Make a read-only backup of the old system.','Export customers, appointments, and inspections as separate files.','Preview and import one file at a time; fix invalid rows before continuing.','Compare totals and sample records in the shop admin. If there is no old data, mark this step complete without importing.'],complete:shop.migration?.status==='completed'||setupStepComplete(shop,'data_complete'),key:shop.migration?.status==='completed'?null:'data_complete',target:'migrationCenter'},
    {title:'Run the final launch test',description:'Approve the shop only after the complete customer journey works.',items:['Test public booking, owner login, technician login, inspection delivery, messaging, and password resets.','Confirm the appointment and customer appear only in this shop—not in Tester.','Point the live domain to the new deployment and keep the old system read-only during the handoff.'],complete:setupStepComplete(shop,'launch_complete'),key:'launch_complete'}
  ];
}
function renderOnboarding(shop){
  const hasDomain=(shop.domains||[]).length>0,steps=onboardingSteps(shop);
  const completed=steps.filter(step=>step.complete).length;$('setupProgressText').textContent=`${completed} of ${steps.length} complete`;$('setupProgressBar').style.width=`${Math.round(completed/steps.length*100)}%`;
  let priorComplete=true;
  $('setupStepList').innerHTML=steps.map((step,index)=>{
    const locked=!priorComplete&&!step.complete,requiresDomain=step.key==='deployment_complete'&&!hasDomain,disabled=locked||requiresDomain;
    const status=step.complete?'Complete':locked?'Waiting':'Next step';
    const action=step.target?`<button class="tiny-button" type="button" data-setup-target="${esc(step.target)}">${step.target==='admin'?'Open shop admin':'Open section'}</button>`:'';
    const check=step.key?`<label class="setup-check ${disabled?'disabled':''}"><input type="checkbox" data-onboarding-key="${esc(step.key)}" ${step.complete?'checked':''} ${disabled?'disabled':''}> <span>${step.complete?'Completed':'Mark complete'}</span></label>`:'';
    const tasks=step.items?.length?`<ul>${step.items.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`:'';
    const row=`<article class="setup-step ${step.complete?'complete':''} ${locked?'locked':''}"><div class="setup-step-number">${step.complete?'✓':index+1}</div><div class="setup-step-copy"><div><h4>${esc(step.title)}</h4><span>${esc(status)}</span></div><p>${esc(step.description)}</p>${tasks}${step.requirement?`<small>${esc(step.requirement)}</small>`:''}</div><div class="setup-step-actions">${action}${check}</div></article>`;
    priorComplete=priorComplete&&step.complete;return row;
  }).join('');
  document.querySelectorAll('[data-setup-target]').forEach(button=>button.onclick=()=>openSetupTarget(button.dataset.setupTarget));
  document.querySelectorAll('[data-onboarding-key]').forEach(input=>input.onchange=()=>saveOnboarding(input.dataset.onboardingKey,input.checked,input));
}
function openSetupTarget(target){
  if(target==='admin'){const link=$('openAdminLink');if(!link.classList.contains('hidden'))window.open(link.href,'_blank','noopener');else{toast('Add the shop domain before opening its admin.',true);$('domainsSection').scrollIntoView({behavior:'smooth',block:'start'})}return}
  $(target)?.scrollIntoView({behavior:'smooth',block:'start'});
}
async function saveOnboarding(key,complete,input){
  input.disabled=true;
  try{await api('shop',{method:'PATCH',body:JSON.stringify({id:state.selectedId,[`onboarding_${key}`]:complete})});await load();toast(complete?'Setup step completed':'Setup step reopened')}
  catch(error){input.checked=!complete;input.disabled=false;showDialogError(error)}
}
function renderDetailMetrics(shop){const counts=shop.counts||{};$('detailMetrics').innerHTML=[['Appointments',counts.appointments],['Customers',counts.customers],['Inspections',counts.inspections],['Technicians',counts.technicians]].map(([label,value])=>`<div class="mini-metric"><strong>${number(value)}</strong><span>${label}</span></div>`).join('')}
function renderDomains(shop){
  $('domainList').innerHTML=(shop.domains||[]).length?shop.domains.map(domain=>`<div class="managed-row"><div><strong>${esc(domain.hostname)}</strong><small>${domain.is_primary?'Primary · mapped':'Mapped domain'}</small></div><div class="row-actions">${domain.is_primary?'':`<button class="tiny-button" data-primary-domain="${esc(domain.id)}">Make primary</button>`}<button class="tiny-button danger" data-delete-domain="${esc(domain.id)}">Remove</button></div></div>`).join(''):'<div class="empty"><strong>No domains mapped</strong>Add the shop’s website domain below.</div>';
  document.querySelectorAll('[data-primary-domain]').forEach(button=>button.onclick=()=>setPrimaryDomain(button.dataset.primaryDomain));
  document.querySelectorAll('[data-delete-domain]').forEach(button=>button.onclick=()=>deleteDomain(button.dataset.deleteDomain));
}
function renderAdmins(shop){
  $('adminList').innerHTML=(shop.admins||[]).length?shop.admins.map(admin=>`<div class="managed-row"><div><strong>${esc(admin.name)} · ${esc(admin.username)}</strong><small>${esc(admin.email||'No recovery email')} · ${admin.active?'Active':'Disabled'} · Last sign-in: ${esc(date(admin.last_login_at))}</small></div><div class="row-actions"><button class="tiny-button" data-email-admin="${esc(admin.id)}" data-admin-email="${esc(admin.email||'')}">Edit email</button><button class="tiny-button" data-reset-admin="${esc(admin.id)}">Reset password</button><button class="tiny-button ${admin.active?'danger':''}" data-toggle-admin="${esc(admin.id)}" data-active="${admin.active?'false':'true'}">${admin.active?'Disable':'Enable'}</button></div></div>`).join(''):'<div class="empty"><strong>No admin accounts</strong>Add the first shop administrator below.</div>';
  document.querySelectorAll('[data-email-admin]').forEach(button=>button.onclick=()=>editAdminEmail(button.dataset.emailAdmin,button.dataset.adminEmail));
  document.querySelectorAll('[data-reset-admin]').forEach(button=>button.onclick=()=>resetAdmin(button.dataset.resetAdmin));
  document.querySelectorAll('[data-toggle-admin]').forEach(button=>button.onclick=()=>toggleAdmin(button.dataset.toggleAdmin,button.dataset.active==='true'));
}
function renderMigration(shop){
  const migration=shop.migration||{},status=migration.status||'not_started',form=$('migrationForm');form.elements.status.value=status;form.elements.source.value=migration.source||'';form.elements.notes.value=migration.notes||'';
  const labels={not_started:'Not started',ready:'Files ready',in_progress:'In progress',review:'Ready for review',completed:'Completed'};$('transferBadge').textContent=labels[status]||status;
  const stages=['ready','in_progress','review','completed'],current=stages.indexOf(status);$('transferSteps').innerHTML=stages.map((stage,index)=>`<div class="transfer-step ${index<current||status==='completed'?'done':''} ${index===current&&status!=='completed'?'current':''}">${esc(labels[stage])}</div>`).join('');
  $('importSetupWarning').classList.toggle('hidden',!state.importSetupRequired);$('previewImportButton').disabled=state.importSetupRequired||!state.importFile;
  renderImportHistory(shop);
}
function renderImportHistory(shop){
  const batches=shop.import_batches||[];
  $('importHistory').innerHTML=batches.length?batches.map(batch=>{
    const canRollback=['completed','partial','failed'].includes(batch.status),label=String(batch.data_type||'records').replace(/^./,letter=>letter.toUpperCase());
    return `<div class="batch-row"><div><strong>${esc(batch.filename||`${label} import`)}</strong><small>${esc(label)} · ${esc(date(batch.created_at))} · <span class="batch-status ${esc(batch.status)}">${esc(String(batch.status).replaceAll('_',' '))}</span></small></div><div class="batch-stat"><span>Imported</span><b>${number(batch.imported_rows)}</b></div><div class="batch-stat"><span>Duplicates</span><b>${number(batch.skipped_rows)}</b></div><div class="batch-stat"><span>Invalid</span><b>${number(batch.invalid_rows)}</b></div><div class="row-actions">${canRollback?`<button class="tiny-button danger" type="button" data-rollback-batch="${esc(batch.id)}" data-batch-name="${esc(batch.filename||label)}">Roll back</button>`:''}</div></div>`;
  }).join(''):'<div class="history-empty">No imports have been committed for this shop.</div>';
  document.querySelectorAll('[data-rollback-batch]').forEach(button=>button.onclick=()=>rollbackImport(button.dataset.rollbackBatch,button.dataset.batchName));
}
function resetImport(){
  state.importFile=null;state.importRows=[];state.importPreview=null;
  if($('importFile'))$('importFile').value='';if($('fileName'))$('fileName').textContent='No file selected';
  if($('previewImportButton'))$('previewImportButton').disabled=true;if($('previewEmpty'))$('previewEmpty').classList.remove('hidden');if($('previewResults'))$('previewResults').classList.add('hidden');
  if($('confirmImportCheck'))$('confirmImportCheck').checked=false;if($('commitImportButton'))$('commitImportButton').disabled=true;
}
function parseCsv(text){
  const records=[];let row=[],field='',quoted=false;
  for(let index=0;index<text.length;index++){
    const char=text[index],next=text[index+1];
    if(char==='"'){if(quoted&&next==='"'){field+='"';index++}else quoted=!quoted;continue}
    if(char===','&&!quoted){row.push(field);field='';continue}
    if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&next==='\n')index++;row.push(field);field='';if(row.some(value=>String(value).trim()))records.push(row);row=[];continue}
    field+=char;
  }
  row.push(field);if(row.some(value=>String(value).trim()))records.push(row);if(records.length<2)return [];
  const headers=records.shift().map((header,index)=>String(header||`Column ${index+1}`).replace(/^\uFEFF/,'').trim());
  return records.map(values=>Object.fromEntries(headers.map((header,index)=>[header,values[index]??''])));
}
async function readImportFile(file){
  if(file.size>2.5*1024*1024)throw new Error('Choose a file smaller than 2.5 MB');
  const text=await file.text(),isJson=file.name.toLowerCase().endsWith('.json')||file.type.includes('json');
  let rows;if(isJson){const parsed=JSON.parse(text);rows=Array.isArray(parsed)?parsed:Array.isArray(parsed?.rows)?parsed.rows:Array.isArray(parsed?.data)?parsed.data:null}else rows=parseCsv(text);
  if(!Array.isArray(rows))throw new Error('JSON must contain an array of records');if(!rows.length)throw new Error('The selected file has no data rows');if(rows.length>2000)throw new Error('Split this export into files of 2,000 rows or fewer');
  if(rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new Error('Every imported row must contain named fields');return rows;
}
async function chooseImportFile(file){
  resetImport();if(!file)return;
  try{const rows=await readImportFile(file);state.importFile=file;state.importRows=rows;$('fileName').textContent=`${file.name} · ${number(rows.length)} rows`;$('previewImportButton').disabled=state.importSetupRequired;toast('File ready for preview')}catch(error){showDialogError(error)}
}
async function previewImport(){
  const shop=selected();if(!shop||!state.importFile)return;
  const button=$('previewImportButton');button.disabled=true;button.textContent='Checking file…';$('confirmImportCheck').checked=false;$('commitImportButton').disabled=true;
  try{
    const preview=await importApi('preview',{shop_id:shop.id,data_type:$('importDataType').value,rows:state.importRows});state.importPreview=preview;
    $('previewReady').textContent=number(preview.ready);$('previewDuplicates').textContent=number(preview.duplicates);$('previewInvalid').textContent=number(preview.invalid);
    $('previewRows').innerHTML=(preview.sample||[]).map(item=>`<tr><td>${number(item.row)}</td><td><strong>${esc(item.name||item.vehicle||'Record')}</strong><br><small>${esc([item.phone,item.date,item.vehicle].filter(Boolean).join(' · '))}</small></td><td><span class="row-result ${esc(item.status)}">${esc(item.status)}</span><br><small>${esc(item.reason)}</small></td></tr>`).join('');
    $('previewEmpty').classList.add('hidden');$('previewResults').classList.remove('hidden');$('commitImportButton').disabled=true;
    toast(`${number(preview.ready)} rows are ready to import`);
  }catch(error){showDialogError(error)}finally{button.disabled=state.importSetupRequired||!state.importFile;button.textContent='Preview import'}
}
async function commitImport(){
  const shop=selected(),preview=state.importPreview;if(!shop||!state.importFile||!preview||!$('confirmImportCheck').checked)return;
  const button=$('commitImportButton');button.disabled=true;button.textContent='Importing…';
  try{
    const result=await importApi('import',{shop_id:shop.id,data_type:$('importDataType').value,filename:state.importFile.name,rows:state.importRows});
    toast(`${number(result.imported)} rows imported. Review the shop before completing the transfer.`);resetImport();await load();
  }catch(error){showDialogError(error)}finally{button.textContent='Confirm import';button.disabled=!$('confirmImportCheck').checked||!state.importPreview}
}
async function rollbackImport(batchId,name){
  if(!confirm(`Roll back “${name}”?\n\nThis removes only records created by that import batch. Customer profiles now used by later records will be kept.`))return;
  try{const result=await importApi('rollback',{shop_id:state.selectedId,batch_id:batchId});await load();const removed=result.removed||{};toast(`Rollback complete: ${number((removed.appointments||0)+(removed.inspections||0)+(removed.customers||0))} records removed`)}catch(error){showDialogError(error)}
}

async function saveShop(event){event.preventDefault();const shop=selected(),data=Object.fromEntries(new FormData(event.currentTarget));data.id=shop.id;try{await api('shop',{method:'PATCH',body:JSON.stringify(data)});await load();toast('Shop details saved')}catch(error){showDialogError(error)}}
async function addDomain(event){event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));data.shop_id=state.selectedId;data.is_primary=event.currentTarget.elements.is_primary.checked;try{await api('domain',{method:'POST',body:JSON.stringify(data)});event.currentTarget.reset();await load();toast('Domain added')}catch(error){showDialogError(error)}}
async function setPrimaryDomain(id){try{await api('domain',{method:'PATCH',body:JSON.stringify({id,shop_id:state.selectedId,is_primary:true})});await load();toast('Primary domain updated')}catch(error){showDialogError(error)}}
async function deleteDomain(id){if(!confirm('Remove this domain mapping?'))return;try{await api('domain',{method:'DELETE',query:{id,shop_id:state.selectedId}});await load();toast('Domain removed')}catch(error){showDialogError(error)}}
async function addAdmin(event){
  event.preventDefault();const form=event.currentTarget,button=$('addAdminSubmit');if(button.dataset.busy==='true')return;
  const data=Object.fromEntries(new FormData(form));data.shop_id=state.selectedId;button.dataset.busy='true';button.disabled=true;button.textContent='Adding…';
  try{await api('admin',{method:'POST',body:JSON.stringify(data)});form.reset();await load();toast('Administrator added')}
  catch(error){if(/already exists/i.test(error.message))await load().catch(()=>{});showDialogError(error)}
  finally{button.dataset.busy='false';button.disabled=false;button.textContent='Add admin'}
}
async function toggleAdmin(id,active){try{await api('admin',{method:'PATCH',body:JSON.stringify({id,shop_id:state.selectedId,active})});await load();toast(active?'Administrator enabled':'Administrator disabled')}catch(error){showDialogError(error)}}
async function editAdminEmail(id,current){const email=prompt('Recovery email for this administrator:',current||'');if(email===null)return;try{await api('admin',{method:'PATCH',body:JSON.stringify({id,shop_id:state.selectedId,email})});await load();toast('Recovery email updated')}catch(error){showDialogError(error)}}
async function resetAdmin(id){const password=prompt('Enter a new temporary password (at least 8 characters):');if(password===null)return;if(password.length<8){showDialogError(new Error('Password must be at least 8 characters'));return}try{await api('admin',{method:'PATCH',body:JSON.stringify({id,shop_id:state.selectedId,password})});toast('Temporary password updated')}catch(error){showDialogError(error)}}
async function saveMigration(event){event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));data.shop_id=state.selectedId;try{await api('migration',{method:'PATCH',body:JSON.stringify(data)});await load();toast('Transfer status updated')}catch(error){showDialogError(error)}}
function showDialogError(error){$('shopDialogError').textContent=error.message;toast(error.message,true);setTimeout(()=>$('shopDialogError').textContent='',4000)}

$('importFile').addEventListener('change',event=>chooseImportFile(event.target.files?.[0]));
$('previewImportButton').addEventListener('click',previewImport);
$('commitImportButton').addEventListener('click',commitImport);
$('confirmImportCheck').addEventListener('change',event=>{$('commitImportButton').disabled=!event.target.checked||!state.importPreview||Number(state.importPreview.ready)<1});
$('importDataType').addEventListener('change',()=>{state.importPreview=null;$('previewEmpty').classList.remove('hidden');$('previewResults').classList.add('hidden');$('confirmImportCheck').checked=false;$('commitImportButton').disabled=true});
for(const eventName of ['dragenter','dragover'])$('fileDrop').addEventListener(eventName,event=>{event.preventDefault();$('fileDrop').classList.add('dragging')});
for(const eventName of ['dragleave','drop'])$('fileDrop').addEventListener(eventName,event=>{event.preventDefault();$('fileDrop').classList.remove('dragging')});
$('fileDrop').addEventListener('drop',event=>chooseImportFile(event.dataTransfer?.files?.[0]));

$('loginForm').addEventListener('submit',login);$('logoutButton').addEventListener('click',logout);$('newShopButton').addEventListener('click',()=>{resetCreateShop();$('createShopDialog').showModal()});$('createShopForm').addEventListener('submit',createShop);$('createShopNext').addEventListener('click',nextCreateStep);$('createShopBack').addEventListener('click',previousCreateStep);
createShopFields().name.addEventListener('input',event=>{const fields=createShopFields();if(!fields.slug.dataset.edited){fields.slug.value=slugify(event.target.value);if(!fields.admin_username.dataset.edited)fields.admin_username.value=fields.slug.value.replaceAll('-','').slice(0,40)}});
createShopFields().slug.addEventListener('input',event=>{event.target.dataset.edited='true';const username=createShopFields().admin_username;if(!username.dataset.edited)username.value=event.target.value.replaceAll('-','').slice(0,40)});
createShopFields().contact_name.addEventListener('input',event=>{const adminName=createShopFields().admin_name;if(!adminName.dataset.edited)adminName.value=event.target.value});createShopFields().admin_name.addEventListener('input',event=>event.target.dataset.edited='true');
createShopFields().contact_email.addEventListener('input',event=>{const fields=createShopFields();for(const name of ['notification_email','admin_email'])if(!fields[name].dataset.edited)fields[name].value=event.target.value});createShopFields().notification_email.addEventListener('input',event=>event.target.dataset.edited='true');createShopFields().admin_email.addEventListener('input',event=>event.target.dataset.edited='true');createShopFields().admin_username.addEventListener('input',event=>event.target.dataset.edited='true');
$('closeShopDialog').addEventListener('click',()=>$('shopDialog').close());$('shopDetailsForm').addEventListener('submit',saveShop);$('addDomainForm').addEventListener('submit',addDomain);$('addAdminForm').addEventListener('submit',addAdmin);$('migrationForm').addEventListener('submit',saveMigration);$('shopSearch').addEventListener('input',renderShops);$('statusFilter').addEventListener('change',renderShops);$('menuButton').addEventListener('click',()=>document.body.classList.toggle('menu-open'));$('menuScrim').addEventListener('click',()=>document.body.classList.remove('menu-open'));document.querySelectorAll('.sidebar nav a').forEach(link=>link.addEventListener('click',()=>document.body.classList.remove('menu-open')));
load().catch(error=>{if(!/session|Unauthorized/i.test(error.message))$('loginError').textContent=error.message;showLogin()});
