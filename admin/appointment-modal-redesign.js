/* Shared appointment detail redesign for every shop. */
(function(){
  function install(){
    if(typeof window.openAppointment!=='function' || typeof window.patchAppointment!=='function'){
      setTimeout(install,50);
      return;
    }

    window.openAppointment=function(id){
      activeAppt=appointments.find(a=>a.id===id);
      if(!activeAppt)return;
      const a=activeAppt;
      const vehicle=[a.year,a.make,a.model].filter(Boolean).join(' ')||'Not provided';
      const email=a.email||'Not provided';
      const phone=a.phone||'Not provided';
      const customerMessage=a.message&&String(a.message).trim()?a.message:'No customer message provided.';
      const dateLabel=a.preferred_date_label||a.appointment_date||'';
      $('apptModalBody').innerHTML=`
        <div class="appt-detail-header">
          <div>
            <div class="appt-eyebrow">Appointment</div>
            <h2>${esc(a.name)}</h2>
            <div class="appt-current-time">${esc(dateLabel)} <span>•</span> ${esc(a.appointment_time||'')}</div>
          </div>
        </div>

        <div class="appt-info-grid">
          <div class="appt-info-card">
            <div class="appt-info-label">Phone</div>
            <div class="appt-info-value">${esc(phone)}</div>
          </div>
          <div class="appt-info-card">
            <div class="appt-info-label">Email</div>
            <div class="appt-info-value">${esc(email)}</div>
          </div>
          <div class="appt-info-card">
            <div class="appt-info-label">Vehicle</div>
            <div class="appt-info-value">${esc(vehicle)}</div>
          </div>
          <div class="appt-info-card">
            <div class="appt-info-label">Service</div>
            <div class="appt-info-value">${esc(a.service||'Not provided')}</div>
          </div>
        </div>

        <section class="appt-section appt-reschedule-section">
          <div class="appt-section-heading">
            <div>
              <div class="appt-section-title">Appointment Date & Time</div>
              <div class="appt-section-help">Change the appointment here if the customer needs to be rescheduled.</div>
            </div>
          </div>
          <div class="appt-reschedule-grid">
            <div>
              <label for="eDate">Date</label>
              <input id="eDate" type="date" value="${esc(a.appointment_date||'')}">
            </div>
            <div>
              <label for="eTime">Time</label>
              <select id="eTime">${slots.map(s=>`<option ${s===a.appointment_time?'selected':''}>${esc(s)}</option>`).join('')}</select>
            </div>
          </div>
        </section>

        <section class="appt-section">
          <div class="appt-section-title">Customer Message</div>
          <div class="appt-message-box ${a.message&&String(a.message).trim()?'':'empty-message'}">${esc(customerMessage)}</div>
        </section>

        <section class="appt-section">
          <label class="appt-section-title" for="eNotes">Internal Notes</label>
          <textarea id="eNotes" class="appt-notes" placeholder="Add notes for the shop only...">${esc(a.internal_notes||'')}</textarea>
          <div class="appt-section-help">Only the shop can see these notes.</div>
        </section>

        <section class="appt-inspection-panel">
          <div class="appt-inspection-copy">
            <div class="appt-section-title">Vehicle Inspection</div>
            <div class="appt-section-help">Send this vehicle to the technician inspection queue.</div>
          </div>
          <div class="appt-inspection-actions single">
            <button class="appt-request-inspection-btn" type="button" onclick="requestInspectionFromAppointment()"><span>✓</span>Request Inspection</button>
          </div>
        </section>

        <div class="appt-modal-actions">
          <button class="appt-text-btn" onclick="textAppointment()">Text Customer</button>
          <button class="appt-save-btn" onclick="saveAppointment()">Save Changes</button>
          <button class="appt-delete-btn" onclick="deleteAppointment()">Delete Appointment</button>
        </div>
        <div id="editNotice" class="appt-save-notice"></div>`;

      $('apptModal').classList.add('open');
      if(!a.seen)patchAppointment({id:a.id,seen:true}).catch(()=>{});
    };

    window.requestInspectionFromAppointment=async function(){
      if(!activeAppt)return;
      const button=document.querySelector('#apptModalBody .appt-request-inspection-btn');
      const notice=$('editNotice');
      try{
        if(button){button.disabled=true;button.innerHTML='<span>✓</span>Requesting...';}
        const response=await fetch('/api/admin-data?action=inspection-request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appointment_id:activeAppt.id})});
        const result=await response.json();
        if(response.status===401){location.href='/admin';return;}
        if(!response.ok)throw new Error(result.error||'Could not request inspection');
        if(result.request?.status==='completed'&&result.request?.inspection_id){location.href='/inspection?id='+encodeURIComponent(result.request.inspection_id);return;}
        location.href='/admin/inspection-requests?appointment='+encodeURIComponent(activeAppt.id);
      }catch(error){
        if(notice){notice.textContent=error.message||'Could not request inspection.';notice.className='appt-save-notice error';}
        if(button){button.disabled=false;button.innerHTML='<span>✓</span>Request Inspection';}
      }
    };

    window.saveAppointment=async function(){
      const notice=$('editNotice');
      const saveBtn=document.querySelector('#apptModalBody .appt-save-btn');
      try{
        if(saveBtn){saveBtn.disabled=true;saveBtn.textContent='Saving...';}
        await patchAppointment({
          id:activeAppt.id,
          appointment_date:$('eDate').value,
          preferred_date_label:$('eDate').value,
          appointment_time:$('eTime').value,
          internal_notes:$('eNotes').value
        });
        if(notice){notice.textContent='Changes saved.';notice.className='appt-save-notice success';}
        await loadAll();
        setTimeout(()=>closeModal('apptModal'),450);
      }catch(e){
        if(notice){notice.textContent=e.message||'Could not save changes.';notice.className='appt-save-notice error';}
      }finally{
        if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='Save Changes';}
      }
    };
  }

  if(document.readyState==='complete')install();
  else window.addEventListener('load',install,{once:true});
})();
