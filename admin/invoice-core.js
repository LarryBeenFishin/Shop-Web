/* Shared invoice workflow + deterministic autosave controller. */
(function(){
  function install(){
    if(window.__invoiceCoreInstalled) return;
    const required=['api','normalizeInvoice','renderAll','renderTotals','renderCustomerCard','renderLines','updateHeader','selectCustomer','selectVehicle','newDraft','openInvoice','clearVehicle'];
    if(required.some(name=>typeof window[name]!=='function')){
      setTimeout(install,50);
      return;
    }
    window.__invoiceCoreInstalled=true;

    const state={timer:null,inFlight:null,suppress:0,pending:false,lastSavedFingerprint:''};
    const activeKey=()=> 'shop_invoice_active_'+((window.cfg&&cfg.name)||'shop');

    function editableSnapshot(){
      const x=invoice||{};
      return {
        status:x.status||'Draft',
        customer_id:x.customer_id||null,
        vehicle_id:x.vehicle_id||null,
        customer_name:x.customer_name||'',
        customer_phone:x.customer_phone||'',
        customer_email:x.customer_email||'',
        vehicle:x.vehicle||'',vin:x.vin||'',plate:x.plate||'',mileage:x.mileage||'',
        opened_date:x.opened_date||'',promise_date:x.promise_date||'',advisor:x.advisor||'',
        concern:x.concern||'',recommendations:x.recommendations||'',internal_notes:x.internal_notes||'',
        lines:Array.isArray(x.lines)?x.lines.map(l=>({
          id:l.id||'',type:l.type||'',description:l.description||'',qty:Number(l.qty)||0,
          cost:Number(l.cost)||0,price:Number(l.price)||0,taxable:l.taxable!==false,tech:l.tech||''
        })):[],
        payments:Array.isArray(x.payments)?x.payments.map(p=>({
          id:p.id||'',method:p.method||'',amount:Number(p.amount)||0,note:p.note||''
        })):[]
      };
    }
    function fingerprint(){
      try{return JSON.stringify(editableSnapshot())}catch(e){return String(Date.now())}
    }
    function hasMeaningfulContent(){
      const x=invoice||{};
      if(x.id||x.customer_id||x.vehicle_id)return true;
      if(String(x.customer_name||x.customer_phone||x.customer_email||'').trim())return true;
      if(String(x.concern||x.recommendations||x.internal_notes||x.advisor||'').trim())return true;
      if(Array.isArray(x.lines)&&x.lines.some(l=>String(l.description||'').trim()||Number(l.qty)||Number(l.price)||Number(l.cost)))return true;
      if(Array.isArray(x.payments)&&x.payments.some(p=>Number(p.amount)>0||String(p.note||'').trim()))return true;
      return false;
    }
    function persistLocal(){
      try{localStorage.setItem(activeKey(),JSON.stringify(invoice))}catch(e){console.warn('Invoice local save skipped',e)}
    }
    function setAutosave(text){const el=document.getElementById('autosave');if(el)el.textContent=text}
    function setNotice(text){const el=document.getElementById('saveNotice');if(el)el.textContent=text||''}

    window.syncMeta=function(shouldQueue=true){
      invoice.opened_date=$('openedDate').value;
      invoice.promise_date=$('promiseDate').value||null;
      invoice.advisor=$('advisor').value;
      invoice.concern=$('concern').value;
      invoice.recommendations=$('recommendations').value;
      invoice.internal_notes=$('internalNotes').value;
      if(shouldQueue) queueSave();
    };

    window.invoicePayload=function(){
      syncMeta(false);
      return {
        ...invoice,
        documentNumber:invoice.document_number,
        customerName:invoice.customer_name,
        customerPhone:invoice.customer_phone,
        customerEmail:invoice.customer_email,
        customerId:invoice.customer_id,
        vehicleId:invoice.vehicle_id,
        openedDate:invoice.opened_date,
        promiseDate:invoice.promise_date,
        internalNotes:invoice.internal_notes,
        lines:invoice.lines,
        payments:invoice.payments
      };
    };

    window.saveNow=async function(silent=false){
      clearTimeout(state.timer);state.timer=null;
      if(!hasMeaningfulContent()){
        setAutosave('No changes to save');
        return null;
      }
      if(state.inFlight){state.pending=true;return state.inFlight}
      state.suppress++;
      state.inFlight=(async()=>{
        try{
          setAutosave('Saving…');
          const j=await api('invoice-save',{method:'POST',body:{invoice:invoicePayload()}});
          invoice=normalizeInvoice(j.invoice);
          persistLocal();
          renderAll();
          state.lastSavedFingerprint=fingerprint();
          state.pending=false;
          setAutosave('Saved '+new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}));
          if(!silent)setNotice('Saved.');
          return j;
        }catch(e){
          console.error(e);
          setAutosave('Save failed');
          if(!silent)setNotice(e.message||'Save failed');
          throw e;
        }finally{
          state.suppress=Math.max(0,state.suppress-1);
          state.inFlight=null;
          if(state.pending && fingerprint()!==state.lastSavedFingerprint){
            state.pending=false;
            queueSave();
          }else state.pending=false;
        }
      })();
      return state.inFlight;
    };

    window.queueSave=function(){
      persistLocal();
      renderTotals();
      updateWorkflowControls();
      if(state.suppress>0)return;
      if(!hasMeaningfulContent()){
        clearTimeout(state.timer);state.timer=null;
        setAutosave('Ready');
        return;
      }
      if(fingerprint()===state.lastSavedFingerprint)return;
      if(state.inFlight){state.pending=true;return}
      clearTimeout(state.timer);
      setAutosave('Unsaved changes');
      state.timer=setTimeout(()=>saveNow(true).catch(()=>{}),900);
    };

    const css=document.createElement('style');
    css.textContent='.workflow-help{font-size:11px;color:#64748b;font-weight:700;line-height:1.25;margin-top:4px}.workflow-help.good{color:#167548}.workflow-help.warn{color:#a15c00}.vehicle-picker.needs-choice{border-color:#d69e2e;background:#fffaf0;box-shadow:0 0 0 3px rgba(214,158,46,.08)}';
    document.head.appendChild(css);
    const docType=document.getElementById('docType');
    if(docType?.parentElement&&!document.getElementById('workflowHelp')){
      const help=document.createElement('div');help.id='workflowHelp';help.className='workflow-help';docType.parentElement.appendChild(help);
    }

    function currentCustomer(){try{return (customers||[]).find(c=>c.id===invoice.customer_id)||null}catch(e){return null}}
    function customerVehicles(){return currentCustomer()?.vehicles||[]}
    function hasBillableLine(){try{return (invoice.lines||[]).some(l=>Number(l.qty)>0&&Number(l.price)>0&&String(l.description||'').trim())}catch(e){return false}}
    function requirements(){
      const hasCustomer=Boolean(invoice?.customer_id),vehicles=customerVehicles(),needsVehicle=vehicles.length>0;
      return {hasCustomer,vehicles,needsVehicle,hasVehicle:!needsVehicle||Boolean(invoice?.vehicle_id),hasLines:hasBillableLine()};
    }
    function workflowMessage(){
      const r=requirements();
      if(!r.hasCustomer)return 'Choose a customer before converting this draft.';
      if(r.needsVehicle&&!r.hasVehicle)return r.vehicles.length>1?'Choose which customer vehicle this order is for.':'Choose the customer vehicle.';
      if(!r.hasLines)return 'Add at least one priced labor, part, fee, or discount line.';
      if(invoice.status==='Draft')return 'Ready to convert to an Estimate.';
      if(invoice.status==='Estimate')return 'Estimate ready. Convert to a Repair Order when work is approved.';
      if(invoice.status==='Repair Order')return 'Repair Order active. Convert to Invoice when work is complete.';
      if(invoice.status==='Invoice')return 'Invoice created. Record payment before closing.';
      if(invoice.status==='Closed')return 'Closed invoice — read only.';
      return invoice.status||'Ready';
    }
    function updateWorkflowControls(){
      const r=requirements(),status=invoice?.status||'Draft',ready=r.hasCustomer&&r.hasVehicle&&r.hasLines&&!invoice?.read_only;
      const estimate=$('toEstimate'),ro=$('toRO'),inv=$('toInvoice');
      if(estimate){estimate.disabled=!ready||status!=='Draft';estimate.style.display=status==='Draft'?'':'none'}
      if(ro){ro.disabled=!ready||status!=='Estimate';ro.style.display=status==='Estimate'?'':'none'}
      if(inv){inv.disabled=!ready||status!=='Repair Order';inv.style.display=status==='Repair Order'?'':'none'}
      const help=$('workflowHelp');if(help){help.textContent=workflowMessage();help.className='workflow-help '+(ready?'good':'warn')}
      const wrap=$('vehicleWrap');if(wrap)wrap.classList.toggle('needs-choice',r.needsVehicle&&!r.hasVehicle);
    }
    window.updateInvoiceWorkflowControls=updateWorkflowControls;

    window.changeWorkflow=async function(next){
      if(invoice.read_only)return;
      const r=requirements(),status=invoice.status||'Draft',allowed={Draft:'Estimate',Estimate:'Repair Order','Repair Order':'Invoice'};
      if(!r.hasCustomer){alert('Choose a customer first.');return}
      if(r.needsVehicle&&!r.hasVehicle){alert(r.vehicles.length>1?'This customer has multiple vehicles. Choose the vehicle for this order first.':'Choose the customer vehicle first.');return}
      if(!r.hasLines){alert('Add at least one priced line item before converting this document.');return}
      if(allowed[status]!==next){alert('Documents move in order: Draft → Estimate → Repair Order → Invoice.');return}
      invoice.status=next;
      await saveNow(true);
      updateWorkflowControls();
    };

    const originalSelectCustomer=selectCustomer;
    window.selectCustomer=function(id){
      state.suppress++;
      try{originalSelectCustomer(id)}finally{state.suppress=Math.max(0,state.suppress-1)}
      const c=currentCustomer(),vehicles=c?.vehicles||[],sel=$('vehicleSelect');
      if(vehicles.length>1&&sel){
        clearVehicle();
        sel.innerHTML='<option value="">Choose vehicle…</option>'+vehicles.map(v=>`<option value="${v.id}">${[v.year,v.make,v.model].filter(Boolean).join(' ')}${v.plate?' · '+v.plate:''}</option>`).join('');
        sel.value='';renderCustomerCard();
      }
      queueSave();updateWorkflowControls();
    };

    const originalSelectVehicle=selectVehicle;
    window.selectVehicle=function(id){state.suppress++;try{originalSelectVehicle(id)}finally{state.suppress=Math.max(0,state.suppress-1)}queueSave();updateWorkflowControls()};
    const originalRenderLines=renderLines;
    window.renderLines=function(){const out=originalRenderLines();updateWorkflowControls();return out};
    const originalUpdateHeader=updateHeader;
    window.updateHeader=function(){const out=originalUpdateHeader();updateWorkflowControls();return out};
    const originalNewDraft=newDraft;
    window.newDraft=function(){clearTimeout(state.timer);state.timer=null;state.lastSavedFingerprint='';const out=originalNewDraft();setAutosave('Ready');updateWorkflowControls();return out};
    const originalOpenInvoice=openInvoice;
    window.openInvoice=async function(id){clearTimeout(state.timer);state.timer=null;state.suppress++;try{return await originalOpenInvoice(id)}finally{state.suppress=Math.max(0,state.suppress-1);state.lastSavedFingerprint=fingerprint();setAutosave('Saved');updateWorkflowControls()}};

    state.lastSavedFingerprint=invoice.id?fingerprint():'';
    setAutosave(invoice.id?'Saved':'Ready');
    updateWorkflowControls();
  }

  if(document.readyState==='complete')install();
  else window.addEventListener('load',install,{once:true});
})();
