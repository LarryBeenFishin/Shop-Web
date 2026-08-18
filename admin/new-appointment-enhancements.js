/* New Appointment: shared vehicle dropdowns + existing customer lookup. */
(function(){
  let lookupTimer=null;
  let lookupResult=null;

  function normalizePhone(v){
    let digits=String(v||'').replace(/\D/g,'');
    if(digits.length===11&&digits[0]==='1')digits=digits.slice(1);
    return digits;
  }
  function escapeHtml(v){
    return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
  }
  function data(){ return window.SHOP_VEHICLE_DATA||{makes:[],models:{},currentYears:()=>[]}; }
  function config(){ return window.SHOP_CONFIG||{}; }
  function byId(id){ return document.getElementById(id); }

  function addStyles(){
    if(document.getElementById('newAppointmentEnhancementStyles'))return;
    const style=document.createElement('style');
    style.id='newAppointmentEnhancementStyles';
    style.textContent=`
      #createModal .modal{max-width:720px}
      .customer-lookup-row{position:relative}
      .customer-lookup-state{margin-top:6px;min-height:18px;font-size:12px;color:#66758b}
      .customer-lookup-state.found{color:#167347;font-weight:800}
      .customer-lookup-state.not-found{color:#7b8797}
      .customer-match-card{grid-column:1/-1;border:1px solid #bfe8d1;background:#f0fbf5;border-radius:13px;padding:12px 14px;display:none}
      .customer-match-card.show{display:block}
      .customer-match-title{font-size:13px;font-weight:900;color:#167347;margin-bottom:3px}
      .customer-match-copy{font-size:12px;color:#526278}
      .vehicle-saved-wrap{grid-column:1/-1;background:#f7f9fc;border:1px solid #e0e7f0;border-radius:14px;padding:12px 14px;display:none}
      .vehicle-saved-wrap.show{display:block}
      .vehicle-saved-wrap label{margin-top:0}
      .vehicle-three{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
      .vehicle-three>div{min-width:0}
      .new-appt-section-label{grid-column:1/-1;margin:4px 0 -2px;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;color:#77849a}
      @media(max-width:620px){.vehicle-three{grid-template-columns:1fr}.customer-match-card,.vehicle-saved-wrap{grid-column:auto}.new-appt-section-label{grid-column:auto}}
    `;
    document.head.appendChild(style);
  }

  function ensureOption(select,value){
    if(!select||!value)return;
    const exists=[...select.options].some(o=>o.value===String(value));
    if(!exists){
      const option=document.createElement('option');
      option.value=String(value);option.textContent=String(value);select.appendChild(option);
    }
  }

  function populateYear(selected=''){
    const el=byId('cYear');if(!el)return;
    const years=data().currentYears();
    el.innerHTML='<option value="">Year</option>'+years.map(y=>`<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join('');
    ensureOption(el,selected);el.value=selected||'';
  }
  function populateMake(selected=''){
    const el=byId('cMake');if(!el)return;
    el.innerHTML='<option value="">Make</option>'+data().makes.map(m=>`<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    ensureOption(el,selected);el.value=selected||'';
    el.disabled=!byId('cYear')?.value;
  }
  function populateModel(make,selected=''){
    const el=byId('cModel');if(!el)return;
    const options=data().models[make]||[];
    el.innerHTML='<option value="">Model</option>'+options.map(m=>`<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    ensureOption(el,selected);el.value=selected||'';
    el.disabled=!make;
  }

  function clearVehicle(){
    populateYear('');populateMake('');populateModel('','');
  }
  function selectVehicle(vehicle){
    if(!vehicle){clearVehicle();return;}
    populateYear(vehicle.year||'');
    populateMake(vehicle.make||'');
    populateModel(vehicle.make||'',vehicle.model||'');
  }
  function vehicleLabel(v){
    const base=[v.year,v.make,v.model].filter(Boolean).join(' ');
    const extras=[];
    if(v.nickname)extras.push(v.nickname);
    if(v.plate)extras.push(`Plate ${v.plate}`);
    return extras.length?`${base} — ${extras.join(' • ')}`:base;
  }

  function renderCustomerMatch(result){
    const state=byId('customerLookupState');
    const card=byId('customerMatchCard');
    const savedWrap=byId('cSavedVehicleWrap');
    const saved=byId('cSavedVehicle');
    if(!state||!card||!savedWrap||!saved)return;

    card.classList.remove('show');
    savedWrap.classList.remove('show');
    saved.innerHTML='';

    if(!result?.found){
      state.textContent='No existing customer found. A new customer profile will be created.';
      state.className='customer-lookup-state not-found';
      lookupResult=null;
      return;
    }

    lookupResult=result;
    const c=result.customer||{};
    byId('cName').value=c.name||'';
    byId('cEmail').value=c.email||'';
    state.textContent='Existing customer found';
    state.className='customer-lookup-state found';
    card.classList.add('show');
    card.innerHTML=`<div class="customer-match-title">Existing customer: ${escapeHtml(c.name||'Customer')}</div><div class="customer-match-copy">Contact information was filled from Customer Profiles.${(result.vehicles||[]).length?` ${result.vehicles.length} saved vehicle${result.vehicles.length===1?'':'s'} found.`:''}</div>`;

    const vehicles=result.vehicles||[];
    if(vehicles.length){
      savedWrap.classList.add('show');
      saved.innerHTML=`<option value="">Choose saved vehicle</option>${vehicles.map((v,i)=>`<option value="${i}">${escapeHtml(vehicleLabel(v))}</option>`).join('')}<option value="__new__">+ Add another vehicle</option>`;
      if(vehicles.length===1){saved.value='0';selectVehicle(vehicles[0]);}
      else clearVehicle();
    }
  }

  async function lookupCustomer(){
    const phone=normalizePhone(byId('cPhone')?.value);
    const state=byId('customerLookupState');
    if(phone.length<10){
      if(state){state.textContent='Enter the customer phone number to search Customer Profiles.';state.className='customer-lookup-state';}
      lookupResult=null;
      byId('customerMatchCard')?.classList.remove('show');
      byId('cSavedVehicleWrap')?.classList.remove('show');
      return;
    }
    if(state){state.textContent='Checking Customer Profiles…';state.className='customer-lookup-state';}
    try{
      const r=await fetch('/api/customer-lookup?phone='+encodeURIComponent(phone),{cache:'no-store'});
      const j=await r.json();
      if(!r.ok)throw new Error(j.error||'Lookup failed');
      renderCustomerMatch(j);
    }catch(err){
      if(state){state.textContent='Could not check Customer Profiles. You can still create the appointment.';state.className='customer-lookup-state';}
      console.error(err);
    }
  }

  function install(){
    if(typeof window.openCreateModal!=='function' || typeof window.createAppointment!=='function' || !window.SHOP_VEHICLE_DATA){
      setTimeout(install,60);return;
    }
    addStyles();

    window.openCreateModal=function(){
      lookupResult=null;
      const cfg=config();
      const serviceOptions=(cfg.services||[]).map(s=>s.title).filter(Boolean);
      const apptSlots=cfg.appointment?.slots||['9:00 AM'];
      const today=new Date();today.setDate(today.getDate()+1);
      const minDate=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

      const modal=document.querySelector('#createModal .modal');
      if(!modal)return;
      modal.innerHTML=`
        <button class="modal-x" onclick="closeModal('createModal')">×</button>
        <h2>New Appointment</h2>
        <div class="form-grid">
          <div class="new-appt-section-label">Customer</div>
          <div><label>Name</label><input id="cName" autocomplete="name"></div>
          <div class="customer-lookup-row"><label>Phone</label><input id="cPhone" type="tel" autocomplete="tel"><div id="customerLookupState" class="customer-lookup-state">Enter the customer phone number to search Customer Profiles.</div></div>
          <div><label>Email</label><input id="cEmail" type="email" autocomplete="email"></div>
          <div></div>
          <div id="customerMatchCard" class="customer-match-card"></div>

          <div class="new-appt-section-label">Vehicle</div>
          <div id="cSavedVehicleWrap" class="vehicle-saved-wrap"><label>Saved Vehicle</label><select id="cSavedVehicle"></select></div>
          <div class="vehicle-three">
            <div><label>Year</label><select id="cYear"></select></div>
            <div><label>Make</label><select id="cMake" disabled></select></div>
            <div><label>Model</label><select id="cModel" disabled></select></div>
          </div>

          <div class="new-appt-section-label">Appointment</div>
          <div><label>Date</label><input id="cDate" type="date" min="${minDate}"></div>
          <div><label>Time</label><select id="cTime">${apptSlots.map(s=>`<option>${escapeHtml(s)}</option>`).join('')}</select></div>
          <div><label>Service</label><select id="cService"><option value="">Select Service</option>${serviceOptions.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}<option value="Other">Other</option></select></div>
          <div></div>
          <div class="full"><label>Customer Message</label><textarea id="cMessage" placeholder="What is the customer bringing the vehicle in for?"></textarea></div>
          <div class="full"><label>Internal Notes</label><textarea id="cNotes" placeholder="Shop-only notes..."></textarea></div>
        </div>
        <div class="modal-actions"><button class="green-btn" id="createAppointmentBtn" onclick="createAppointment()">Create Appointment</button><button class="light-btn" onclick="closeModal('createModal')">Cancel</button></div>
        <div id="createNotice" class="meta"></div>`;

      populateYear('');populateMake('');populateModel('','');
      byId('cPhone').addEventListener('input',()=>{clearTimeout(lookupTimer);lookupTimer=setTimeout(lookupCustomer,450)});
      byId('cPhone').addEventListener('blur',()=>{clearTimeout(lookupTimer);lookupCustomer()});
      byId('cYear').addEventListener('change',()=>{populateMake('');populateModel('','');});
      byId('cMake').addEventListener('change',e=>populateModel(e.target.value,''));
      byId('cSavedVehicle').addEventListener('change',e=>{
        if(e.target.value==='__new__'){clearVehicle();return;}
        if(e.target.value==='')return;
        const vehicle=lookupResult?.vehicles?.[Number(e.target.value)];
        selectVehicle(vehicle);
      });
      byId('createNotice').textContent='';
      byId('createModal').classList.add('open');
      setTimeout(()=>byId('cPhone')?.focus(),30);
    };

    window.createAppointment=async function(){
      const notice=byId('createNotice');
      const button=byId('createAppointmentBtn');
      const required=[['cName','Customer name'],['cPhone','Phone'],['cYear','Year'],['cMake','Make'],['cModel','Model'],['cService','Service'],['cDate','Date'],['cTime','Time']];
      const missing=required.filter(([id])=>!String(byId(id)?.value||'').trim()).map(x=>x[1]);
      if(missing.length){notice.textContent='Please complete: '+missing.join(', ');return;}

      const body={
        action:'appointment',
        name:byId('cName').value,
        phone:byId('cPhone').value,
        email:byId('cEmail').value,
        service:byId('cService').value,
        year:byId('cYear').value,
        make:byId('cMake').value,
        model:byId('cModel').value,
        appointment_date:byId('cDate').value,
        appointment_time:byId('cTime').value,
        message:byId('cMessage').value,
        internal_notes:byId('cNotes').value,
        customer_id:lookupResult?.customer?.id||null,
        vehicle_id:(()=>{const v=byId('cSavedVehicle')?.value;if(v==null||v===''||v==='__new__')return null;return lookupResult?.vehicles?.[Number(v)]?.id||null;})()
      };

      try{
        button.disabled=true;button.textContent='Creating…';notice.textContent='';
        const r=await fetch('/api/admin-data?action=appointment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        const j=await r.json();
        if(!r.ok)throw new Error(j.error||'Could not create appointment');
        notice.textContent='Appointment created.';
        await loadAll();
        setTimeout(()=>closeModal('createModal'),350);
      }catch(err){
        notice.textContent=err.message||'Could not create appointment';
      }finally{
        button.disabled=false;button.textContent='Create Appointment';
      }
    };
  }

  if(document.readyState==='complete')install();
  else window.addEventListener('load',install,{once:true});
})();
