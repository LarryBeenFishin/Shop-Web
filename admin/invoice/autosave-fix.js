/* Prevent invoice saves from scheduling another save while building the save payload. */
(function(){
  function install(){
    if(typeof syncMeta!=='function' || typeof invoicePayload!=='function') return;

    syncMeta=function(shouldQueue=true){
      invoice.opened_date=$('openedDate').value;
      invoice.promise_date=$('promiseDate').value||null;
      invoice.advisor=$('advisor').value;
      invoice.concern=$('concern').value;
      invoice.recommendations=$('recommendations').value;
      invoice.internal_notes=$('internalNotes').value;
      if(shouldQueue) queueSave();
    };

    invoicePayload=function(){
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
  }

  if(document.readyState==='complete') install();
  else window.addEventListener('load',install,{once:true});
})();
