/* Core invoice workflow safeguards shared by every shop. */
(function(){
  function boot(){
    if(typeof changeWorkflow!=='function' || typeof updateHeader!=='function' || typeof renderCustomerCard!=='function'){
      setTimeout(boot,60);return;
    }
    if(window.__invoiceCoreInstalled)return;
    window.__invoiceCoreInstalled=true;

    const css=document.createElement('style');
    css.textContent=`
      .workflow-help{font-size:11px;color:#64748b;font-weight:700;line-height:1.25;margin-top:4px}
      .workflow-help.good{color:#167548}.workflow-help.warn{color:#a15c00}
      .vehicle-picker.needs-choice{border-color:#d69e2e;background:#fffaf0;box-shadow:0 0 0 3px rgba(214,158,46,.08)}
    `;
    document.head.appendChild(css);

    const docType=document.getElementById('docType');
    if(docType?.parentElement && !document.getElementById('workflowHelp')){
      const help=document.createElement('div');
      help.id='workflowHelp';help.className='workflow-help';
      docType.parentElement.appendChild(help);
    }

    function currentCustomer(){
      try{return (customers||[]).find(c=>c.id===invoice.customer_id)||null}catch(e){return null}
    }
    function customerVehicles(){return currentCustomer()?.vehicles||[]}
    function hasBillableLine(){
      try{return (invoice.lines||[]).some(l=>Number(l.qty)>0 && Number(l.price)>0 && String(l.description||'').trim())}catch(e){return false}
    }
    function requirements(){
      const hasCustomer=Boolean(invoice?.customer_id);
      const vehicles=customerVehicles();
      const needsVehicle=vehicles.length>0;
      const hasVehicle=!needsVehicle || Boolean(invoice?.vehicle_id);
      const hasLines=hasBillableLine();
      return {hasCustomer,needsVehicle,hasVehicle,hasLines,vehicles};
    }
    function workflowMessage(){
      const r=requirements();
      if(!r.hasCustomer)return 'Choose a customer before converting this draft.';
      if(r.needsVehicle&&!r.hasVehicle)return r.vehicles.length>1?'Choose which customer vehicle this order is for.':'Choose the customer vehicle.';
      if(!r.hasLines)return 'Add at least one labor, part, fee, or discount line with a price.';
      if(invoice.status==='Draft')return 'Ready to convert to an Estimate.';
      if(invoice.status==='Estimate')return 'Estimate ready. Convert to a Repair Order when work is approved.';
      if(invoice.status==='Repair Order')return 'Repair Order active. Convert to Invoice when work is complete.';
      if(invoice.status==='Invoice')return 'Invoice created. Record payment before closing.';
      if(invoice.status==='Closed')return 'Closed invoice — read only.';
      return invoice.status||'Ready';
    }
    function updateWorkflowControls(){
      const r=requirements(),status=invoice?.status||'Draft';
      const ready=r.hasCustomer&&r.hasVehicle&&r.hasLines&&!invoice?.read_only;
      const estimate=document.getElementById('toEstimate'),ro=document.getElementById('toRO'),inv=document.getElementById('toInvoice');
      if(estimate){estimate.disabled=!ready||status!=='Draft';estimate.style.display=status==='Draft'?'':'none'}
      if(ro){ro.disabled=!ready||status!=='Estimate';ro.style.display=['Draft','Estimate'].includes(status)?'':'none'}
      if(inv){inv.disabled=!ready||status!=='Repair Order';inv.style.display=['Draft','Estimate','Repair Order'].includes(status)?'':'none'}
      const help=document.getElementById('workflowHelp');
      if(help){help.textContent=workflowMessage();help.className='workflow-help '+(ready?'good':'warn')}
      const wrap=document.getElementById('vehicleWrap');
      if(wrap)wrap.classList.toggle('needs-choice',r.needsVehicle&&!r.hasVehicle);
    }

    const originalChangeWorkflow=changeWorkflow;
    window.changeWorkflow=async function(next){
      const r=requirements(),status=invoice?.status||'Draft';
      if(!r.hasCustomer){alert('Choose a customer first.');return}
      if(r.needsVehicle&&!r.hasVehicle){alert(r.vehicles.length>1?'This customer has multiple vehicles. Choose the vehicle for this order first.':'Choose the customer vehicle first.');return}
      if(!r.hasLines){alert('Add at least one priced line item before converting this document.');return}
      const allowed={Draft:'Estimate',Estimate:'Repair Order','Repair Order':'Invoice'};
      if(allowed[status]!==next){alert(`This document moves in order: Draft → Estimate → Repair Order → Invoice. Current type: ${status}.`);return}
      await originalChangeWorkflow(next);
      updateWorkflowControls();
    };

    const originalSelectCustomer=selectCustomer;
    window.selectCustomer=function(id){
      originalSelectCustomer(id);
      const c=currentCustomer(),vehicles=c?.vehicles||[],sel=document.getElementById('vehicleSelect');
      if(vehicles.length>1 && sel){
        clearVehicle();
        sel.innerHTML='<option value="">Choose vehicle…</option>'+vehicles.map(v=>`<option value="${v.id}">${[v.year,v.make,v.model].filter(Boolean).join(' ')}${v.plate?' · '+v.plate:''}</option>`).join('');
        sel.value='';
        renderCustomerCard();
        queueSave();
      }
      updateWorkflowControls();
    };

    const originalSelectVehicle=selectVehicle;
    window.selectVehicle=function(id){originalSelectVehicle(id);updateWorkflowControls()};
    const originalRenderLines=renderLines;
    window.renderLines=function(){const out=originalRenderLines();updateWorkflowControls();return out};
    const originalUpdateHeader=updateHeader;
    window.updateHeader=function(){const out=originalUpdateHeader();updateWorkflowControls();return out};
    const originalNewDraft=newDraft;
    window.newDraft=function(){const out=originalNewDraft();setTimeout(updateWorkflowControls,0);return out};
    const originalOpenInvoice=openInvoice;
    window.openInvoice=async function(id){const out=await originalOpenInvoice(id);updateWorkflowControls();return out};

    updateWorkflowControls();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
