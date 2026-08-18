const { verifyForShop } = require('./_auth');
const { db, upsertCustomer, upsertCustomerVehicle, normalizePhone, auditEvent, missingTable } = require('./_db');
const { resolveShop, applyShopScope, withShopId } = require('./_tenant');

const APPT_STATUSES=['pending','new','confirmed','checked-in','in-progress','waiting-approval','completed','cancelled'];
const INVOICE_STATUSES=['Draft','Estimate','Repair Order','Invoice','Revision','Closed','Cancelled'];
const PRESET_TYPES=['Canned Job','Fee','Discount'];
function json(res,code,data){return res.status(code).json(data)}
function s(v,n=3000){return String(v??'').trim().slice(0,n)}
function bool(v){return v===true||String(v).toLowerCase()==='true'||String(v).toLowerCase()==='yes'}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0}
function round(v){return Math.round((num(v)+Number.EPSILON)*100)/100}
function arr(v){return Array.isArray(v)?v:[]}
function timeKey(v){
  const m=s(v,30).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i); if(!m) return s(v,30);
  let h=Number(m[1]); if(m[3].toUpperCase()==='PM'&&h!==12)h+=12; if(m[3].toUpperCase()==='AM'&&h===12)h=0;
  return `${String(h).padStart(2,'0')}:${m[2]}`;
}
function normalizeInvoiceLines(input){
  return arr(input).slice(0,500).map((line,i)=>{
    const type=['Labor','Part','Fee','Discount'].includes(line?.type)?line.type:'Labor';
    return {
      id:s(line?.id||`line-${i+1}`,100),
      type,
      description:s(line?.description,1000),
      qty:round(line?.qty),
      cost:type==='Part'?round(line?.cost):0,
      price:Math.max(0,round(line?.price)),
      taxable:type==='Part' ? line?.taxable!==false : false,
      tech:s(line?.tech,120)||''
    };
  });
}
function normalizePayments(input){
  return arr(input).slice(0,50).map((p,i)=>({
    id:s(p?.id||`payment-${i+1}`,100),
    method:s(p?.method||'Other',50),
    amount:Math.max(0,round(p?.amount)),
    note:s(p?.note,300)||''
  })).filter(p=>p.amount>0);
}
function invoiceTotals(lines,payments,settings={}){
  let labor=0,parts=0,fees=0,discounts=0,taxableParts=0;
  for(const l of lines){
    const total=round(num(l.qty)*num(l.price));
    if(l.type==='Labor')labor+=total;
    else if(l.type==='Part'){parts+=total;if(l.taxable)taxableParts+=total;}
    else if(l.type==='Discount')discounts+=Math.abs(total);
    else fees+=total;
  }
  const shopSupplies=round(labor*num(settings.shop_supplies_percent)/100);
  const tax=round(taxableParts*num(settings.parts_tax_rate)/100);
  labor=round(labor);parts=round(parts);fees=round(fees);discounts=round(discounts);
  const subtotal=round(labor+parts+fees+shopSupplies-discounts);
  const total=Math.max(0,round(subtotal+tax));
  const paid=round(payments.reduce((sum,p)=>sum+num(p.amount),0));
  const balance=Math.max(0,round(total-paid));
  const paymentStatus=total>0&&balance<=0.009?'Paid':paid>0?'Partial':'Unpaid';
  return {labor,parts,fees,discounts,shopSupplies,tax,subtotal,total,paid,balance,paymentStatus};
}
async function getInvoiceSettings(supabase,shop){
  const defaults={shop_id:shop.id,labor_rate:150,parts_tax_rate:0,parts_markup_percent:50,shop_supplies_percent:0,document_prefix:'RO',footer_message:''};
  if(!shop.id)return defaults;
  const {data,error}=await supabase.from('invoice_settings').select('*').eq('shop_id',shop.id).maybeSingle();
  if(error){if(missingTable(error,'invoice_settings'))return defaults;throw error;}
  return {...defaults,...(data||{})};
}
async function invoiceCustomerVehicle(supabase,b,shop){
  const name=s(b.customer_name||b.customerName,120),phone=s(b.customer_phone||b.customerPhone||b.phone,40),email=s(b.customer_email||b.customerEmail||b.email,200)||null;
  let customer=null,vehicle=null;
  if(name&&phone){
    customer=await upsertCustomer(supabase,{name,phone,email,vehicle:s(b.vehicle,300),mileage:s(b.mileage,50)},shop.id).catch(()=>null);
  }
  const requestedVehicleId=s(b.vehicle_id||b.vehicleId,80);
  if(requestedVehicleId){
    let q=supabase.from('customer_vehicles').select('*').eq('id',requestedVehicleId);
    q=applyShopScope(q,shop);
    if(customer?.id)q=q.eq('customer_id',customer.id);
    const {data,error}=await q.maybeSingle();
    if(!error&&data)vehicle=data;
  }
  if(!vehicle&&customer?.id&&s(b.year,10)&&s(b.make,80)&&s(b.model,100)){
    vehicle=await upsertCustomerVehicle(supabase,{year:b.year,make:b.make,model:b.model,vin:b.vin,plate:b.plate,mileage:b.mileage,vehicle_id:requestedVehicleId||null},shop.id,customer.id).catch(()=>null);
  }
  return {customer,vehicle};
}

module.exports=async function handler(req,res){
  const supabase=db();
  let shop;
  try{shop=await resolveShop(req,supabase);}catch(err){console.error(err);return json(res,500,{error:err.message||'Unable to resolve shop'});}
  if(!verifyForShop(req,shop)) return json(res,401,{error:'Unauthorized'});
  const action=s(req.query.action||req.body?.action,80);

  try{
    if(req.method==='GET' && action==='appointments'){
      let q=supabase.from('appointments').select('*').order('appointment_date',{ascending:true}).order('appointment_time_key',{ascending:true}).limit(1000);
      q=applyShopScope(q,shop);
      if(req.query.from) q=q.gte('appointment_date',s(req.query.from,10));
      if(req.query.to) q=q.lte('appointment_date',s(req.query.to,10));
      const {data,error}=await q;if(error)throw error;
      return json(res,200,{status:'success',shop:{id:shop.id,slug:shop.slug,name:shop.name},appointments:data||[]});
    }

    if(req.method==='GET' && action==='customers'){
      let cq=supabase.from('customers').select('*').order('updated_at',{ascending:false}).limit(1000);
      cq=applyShopScope(cq,shop);
      const {data:customers,error}=await cq;if(error)throw error;

      let aq=supabase.from('appointments').select('name,phone,email,year,make,model,service,appointment_date,appointment_time,status');
      aq=applyShopScope(aq,shop);
      const {data:appointments,error:apptError}=await aq;if(apptError)throw apptError;

      let iq=supabase.from('inspections').select('id,customer_id,customer_name,phone,created_at,vehicle');
      iq=applyShopScope(iq,shop);
      const {data:inspections,error:inspError}=await iq;if(inspError)throw inspError;

      let vehicles=[];
      try{
        let vq=supabase.from('customer_vehicles').select('*').order('last_seen_at',{ascending:false});
        vq=applyShopScope(vq,shop);
        const {data,error}=await vq;if(error)throw error;vehicles=data||[];
      }catch(error){if(!missingTable(error,'customer_vehicles'))throw error;}

      const appts=appointments||[], ins=inspections||[];
      const out=(customers||[]).map(c=>{
        const p=normalizePhone(c.phone);
        const ca=appts.filter(a=>normalizePhone(a.phone)===p);
        const ci=ins.filter(i=>i.customer_id===c.id||normalizePhone(i.phone)===p);
        const lastA=[...ca].sort((a,b)=>`${b.appointment_date} ${b.appointment_time}`.localeCompare(`${a.appointment_date} ${a.appointment_time}`))[0];
        const lastI=[...ci].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0];
        return {...c,vehicles:vehicles.filter(v=>v.customer_id===c.id),totalAppointments:ca.length,lastAppointmentDate:lastA?.appointment_date||'',lastAppointmentTime:lastA?.appointment_time||'',lastInspectionId:lastI?.id||'',lastUpdated:c.updated_at};
      });
      return json(res,200,{status:'success',customers:out});
    }

    if(req.method==='GET' && action==='inspections'){
      let q=supabase.from('inspections').select('*').order('created_at',{ascending:false}).limit(1000);
      q=applyShopScope(q,shop);
      const {data,error}=await q;if(error)throw error;
      return json(res,200,{status:'success',inspections:data||[]});
    }

    if(req.method==='GET' && action==='messages'){
      let q=supabase.from('sms_messages').select('*').order('created_at',{ascending:true}).limit(2000);
      q=applyShopScope(q,shop);
      const {data,error}=await q;if(error)throw error;
      return json(res,200,{status:'success',messages:data||[]});
    }

    if(req.method==='GET' && action==='audit'){
      if(!shop.id) return json(res,200,{status:'success',events:[]});
      const {data,error}=await supabase.from('audit_events').select('*').eq('shop_id',shop.id).order('created_at',{ascending:false}).limit(Math.min(Number(req.query.limit)||200,500));
      if(error)throw error;
      return json(res,200,{status:'success',events:data||[]});
    }

    // ----- Invoicing -----
    if(req.method==='GET' && action==='invoice-bootstrap'){
      const settings=await getInvoiceSettings(supabase,shop);
      let pq=supabase.from('invoice_presets').select('*').order('updated_at',{ascending:false}).limit(500);pq=applyShopScope(pq,shop);
      const {data:presets,error:presetError}=await pq;if(presetError&&!missingTable(presetError,'invoice_presets'))throw presetError;
      return json(res,200,{status:'success',shop:{id:shop.id,slug:shop.slug,name:shop.name},settings,presets:presets||[]});
    }

    if(req.method==='GET' && action==='invoices'){
      let q=supabase.from('invoice_documents').select('*').order('updated_at',{ascending:false}).limit(Math.min(Number(req.query.limit)||500,1000));
      q=applyShopScope(q,shop);
      if(req.query.id)q=q.eq('id',s(req.query.id,80));
      if(req.query.customer_id)q=q.eq('customer_id',s(req.query.customer_id,80));
      if(req.query.vehicle_id)q=q.eq('vehicle_id',s(req.query.vehicle_id,80));
      if(req.query.status)q=q.eq('status',s(req.query.status,30));
      const {data,error}=await q;if(error)throw error;
      if(req.query.id)return json(res,200,{status:'success',invoice:(data||[])[0]||null});
      return json(res,200,{status:'success',invoices:data||[]});
    }

    if(req.method==='POST' && action==='invoice-save'){
      const b=req.body?.invoice||req.body||{};
      const settings=await getInvoiceSettings(supabase,shop);
      const lines=normalizeInvoiceLines(b.lines),payments=normalizePayments(b.payments),totals=invoiceTotals(lines,payments,settings);
      const status=INVOICE_STATUSES.includes(b.status)?b.status:'Draft';
      const cv=await invoiceCustomerVehicle(supabase,b,shop);
      let documentNumber=s(b.document_number||b.documentNumber||b.docNumber,80)||null;
      if(status!=='Draft'&&!documentNumber){
        const {data,error}=await supabase.rpc('next_invoice_document_number',{p_shop_id:shop.id,p_prefix:s(settings.document_prefix,12)||'RO'});
        if(error)throw error;documentNumber=data;
      }
      const vehicleText=s(b.vehicle,300)||[b.year,b.make,b.model].map(x=>s(x,100)).filter(Boolean).join(' ')||([cv.vehicle?.year,cv.vehicle?.make,cv.vehicle?.model].filter(Boolean).join(' '))||null;
      const row=withShopId({
        parent_invoice_id:s(b.parent_invoice_id||b.parentInvoiceId,80)||null,
        customer_id:cv.customer?.id||s(b.customer_id||b.customerId,80)||null,
        vehicle_id:cv.vehicle?.id||s(b.vehicle_id||b.vehicleId,80)||null,
        document_number:documentNumber,status,payment_status:totals.paymentStatus,
        customer_name:s(b.customer_name||b.customerName,120)||cv.customer?.name||null,
        customer_phone:s(b.customer_phone||b.customerPhone||b.phone,40)||cv.customer?.phone||null,
        customer_email:s(b.customer_email||b.customerEmail||b.email,200)||cv.customer?.email||null,
        vehicle:vehicleText,vin:s(b.vin,40)||cv.vehicle?.vin||null,plate:s(b.plate,40)||cv.vehicle?.plate||null,mileage:s(b.mileage,50)||cv.vehicle?.mileage||null,
        opened_date:s(b.opened_date||b.openedDate,10)||null,promise_date:s(b.promise_date||b.promiseDate,10)||null,advisor:s(b.advisor,120)||null,
        concern:s(b.concern,5000)||null,recommendations:s(b.recommendations,5000)||null,internal_notes:s(b.internal_notes||b.internalNotes,10000)||null,
        lines,payments,totals,
        labor_total:totals.labor,parts_total:totals.parts,fees_total:totals.fees,discount_total:totals.discounts,shop_supplies_total:totals.shopSupplies,tax_total:totals.tax,
        subtotal:totals.subtotal,total:totals.total,paid:totals.paid,balance:totals.balance,
        read_only:status==='Closed'||bool(b.read_only||b.readOnly),closed_at:status==='Closed'?(s(b.closed_at||b.closedAt,40)||new Date().toISOString()):null,updated_at:new Date().toISOString()
      },shop);
      const id=s(b.id||b.invoiceId,80);
      let data,error;
      if(id){
        let q=supabase.from('invoice_documents').update(row).eq('id',id);q=applyShopScope(q,shop);
        ({data,error}=await q.select('*').maybeSingle());
        if(!data&&!error)return json(res,404,{error:'Invoice not found'});
      }else{
        ({data,error}=await supabase.from('invoice_documents').insert(row).select('*').single());
      }
      if(error)throw error;
      await auditEvent(supabase,shop.id,id?'invoice.updated':'invoice.created','invoice',data.id,{document_number:data.document_number,status:data.status,total:data.total,balance:data.balance});
      return json(res,id?200:201,{status:'success',invoice:data,invoiceId:data.id,documentNumber:data.document_number});
    }

    if(req.method==='POST' && action==='invoice-close'){
      const id=s(req.body?.id||req.body?.invoiceId,80);if(!id)return json(res,400,{error:'Missing invoice id'});
      let get=supabase.from('invoice_documents').select('*').eq('id',id);get=applyShopScope(get,shop);
      const {data:existing,error:getError}=await get.maybeSingle();if(getError)throw getError;if(!existing)return json(res,404,{error:'Invoice not found'});
      if(num(existing.total)<=0)return json(res,400,{error:'Add invoice lines before closing'});
      if(num(existing.balance)>0.009)return json(res,400,{error:'Invoice must be paid before closing'});
      let update=supabase.from('invoice_documents').update({status:'Closed',payment_status:'Paid',read_only:true,closed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',id);update=applyShopScope(update,shop);
      const {data,error}=await update.select('*').single();if(error)throw error;
      await auditEvent(supabase,shop.id,'invoice.closed','invoice',data.id,{document_number:data.document_number,total:data.total});
      return json(res,200,{status:'success',invoice:data});
    }

    if(req.method==='DELETE' && action==='invoice'){
      const id=s(req.query.id||req.body?.id,80);if(!id)return json(res,400,{error:'Missing invoice id'});
      let del=supabase.from('invoice_documents').delete().eq('id',id);del=applyShopScope(del,shop);
      const {error}=await del;if(error)throw error;
      await auditEvent(supabase,shop.id,'invoice.deleted','invoice',id,{});
      return json(res,200,{status:'success'});
    }

    if(req.method==='POST' && action==='invoice-settings'){
      const b=req.body?.settings||req.body||{};
      const row={shop_id:shop.id,labor_rate:Math.max(0,round(b.labor_rate??b.laborRate??150)),parts_tax_rate:Math.max(0,num(b.parts_tax_rate??b.taxRate)),parts_markup_percent:Math.max(0,num(b.parts_markup_percent??b.partsMarkupPercent??50)),shop_supplies_percent:Math.max(0,num(b.shop_supplies_percent??b.shopSuppliesPercent)),document_prefix:s(b.document_prefix||b.prefix||'RO',12)||'RO',footer_message:s(b.footer_message||b.footer,5000)||null,updated_at:new Date().toISOString()};
      const {data,error}=await supabase.from('invoice_settings').upsert(row,{onConflict:'shop_id'}).select('*').single();if(error)throw error;
      await supabase.from('invoice_counters').upsert({shop_id:shop.id,prefix:row.document_prefix,updated_at:new Date().toISOString()},{onConflict:'shop_id'}).catch(()=>{});
      await auditEvent(supabase,shop.id,'invoice.settings.updated','invoice_settings',shop.id,{prefix:data.document_prefix,tax_rate:data.parts_tax_rate});
      return json(res,200,{status:'success',settings:data});
    }

    if(req.method==='POST' && action==='invoice-preset'){
      const b=req.body?.preset||req.body||{};const type=PRESET_TYPES.includes(b.preset_type||b.presetType||b.type)?(b.preset_type||b.presetType||b.type):null;
      if(!type)return json(res,400,{error:'Invalid preset type'});const name=s(b.name||b.title||b.description,160);if(!name)return json(res,400,{error:'Preset name is required'});
      const payload=(b.payload&&typeof b.payload==='object')?b.payload:{};const id=s(b.id,80);
      let data,error;
      if(id){let q=supabase.from('invoice_presets').update({preset_type:type,name,payload,updated_at:new Date().toISOString()}).eq('id',id);q=applyShopScope(q,shop);({data,error}=await q.select('*').maybeSingle());}
      else ({data,error}=await supabase.from('invoice_presets').insert(withShopId({preset_type:type,name,payload},shop)).select('*').single());
      if(error)throw error;if(!data)return json(res,404,{error:'Preset not found'});
      return json(res,200,{status:'success',preset:data});
    }

    if(req.method==='DELETE' && action==='invoice-preset'){
      const id=s(req.query.id||req.body?.id,80);let q=supabase.from('invoice_presets').delete().eq('id',id);q=applyShopScope(q,shop);const {error}=await q;if(error)throw error;return json(res,200,{status:'success'});
    }

    // ----- Existing appointment/customer/inspection actions -----
    if(req.method==='POST' && action==='appointment'){
      const body=req.body||{};
      const name=s(body.name,120),phone=s(body.phone,40),date=s(body.appointment_date||body.preferred_date_raw,10),time=s(body.appointment_time||body.preferred_time,30);
      if(!name||!phone||!date||!time) return json(res,400,{error:'Name, phone, date and time are required'});
      const row=withShopId({
        name,phone,email:s(body.email,200)||null,year:s(body.year,10)||'N/A',make:s(body.make,80)||'N/A',model:s(body.model,100)||'N/A',service:s(body.service,120)||'Other',
        appointment_date:date,preferred_date_label:s(body.preferred_date_label||date,100),appointment_time:time,appointment_time_key:timeKey(time),drop_off:bool(body.drop_off),
        message:s(body.message,3000)||null,marketing_opt_in:bool(body.marketing_opt_in),submitted_from:'Admin Dashboard',status:APPT_STATUSES.includes(body.status)?body.status:'confirmed',
        internal_notes:s(body.internal_notes,3000)||null,seen:true,updated_at:new Date().toISOString()
      },shop);
      if(body.vehicle_id)row.vehicle_id=s(body.vehicle_id,80);
      const {data,error}=await supabase.from('appointments').insert(row).select('*').single();
      if(error){if(error.code==='23505')return json(res,409,{error:'That time is already booked'});throw error;}
      await upsertCustomer(supabase,{name,phone,email:row.email,vehicle:`${row.year} ${row.make} ${row.model}`,service:row.service},shop.id).catch(()=>{});
      await auditEvent(supabase,shop.id,'appointment.created','appointment',data.id,{source:'admin',service:data.service,date:data.appointment_date,time:data.appointment_time});
      return json(res,201,{status:'success',appointment:data});
    }

    if(req.method==='PATCH' && action==='appointment'){
      const id=s(req.body?.id,80); if(!id)return json(res,400,{error:'Missing appointment id'});
      const body=req.body||{}; const patch={updated_at:new Date().toISOString()};
      ['name','phone','email','year','make','model','service','appointment_date','appointment_time','message','internal_notes'].forEach(k=>{if(body[k]!==undefined)patch[k]=s(body[k],k==='message'||k==='internal_notes'?3000:200)||null});
      if(body.status!==undefined){if(!APPT_STATUSES.includes(body.status))return json(res,400,{error:'Invalid status'});patch.status=body.status;}
      if(body.seen!==undefined)patch.seen=bool(body.seen);
      if(body.drop_off!==undefined)patch.drop_off=bool(body.drop_off);
      if(body.appointment_time!==undefined)patch.appointment_time_key=timeKey(body.appointment_time);
      if(body.appointment_date!==undefined)patch.preferred_date_label=s(body.preferred_date_label||body.appointment_date,100);
      let update=supabase.from('appointments').update(patch).eq('id',id);
      update=applyShopScope(update,shop);
      const {data,error}=await update.select('*').maybeSingle();
      if(error){if(error.code==='23505')return json(res,409,{error:'That time is already booked'});throw error;}
      if(!data)return json(res,404,{error:'Appointment not found'});
      await upsertCustomer(supabase,{name:data.name,phone:data.phone,email:data.email,vehicle:`${data.year} ${data.make} ${data.model}`,service:data.service},shop.id).catch(()=>{});
      await auditEvent(supabase,shop.id,'appointment.updated','appointment',data.id,{fields:Object.keys(patch),status:data.status,date:data.appointment_date,time:data.appointment_time});
      return json(res,200,{status:'success',appointment:data});
    }

    if(req.method==='DELETE' && action==='appointment'){
      const id=s(req.query.id||req.body?.id,80);
      let del=supabase.from('appointments').delete().eq('id',id); del=applyShopScope(del,shop);
      const {error}=await del;if(error)throw error;
      await auditEvent(supabase,shop.id,'appointment.deleted','appointment',id,{});
      return json(res,200,{status:'success'});
    }

    if(req.method==='POST' && action==='customer'){
      const b=req.body||{}; const customer=await upsertCustomer(supabase,b,shop.id);
      if(!customer)return json(res,400,{error:'Name and phone are required'});
      let vehicle=null;if(b.year&&b.make&&b.model)vehicle=await upsertCustomerVehicle(supabase,b,shop.id,customer.id).catch(()=>null);
      await auditEvent(supabase,shop.id,'customer.saved','customer',customer.id,{phone:normalizePhone(customer.phone)});
      return json(res,200,{status:'success',customer,vehicle});
    }

    if(req.method==='PATCH' && action==='customer'){
      const id=s(req.body?.id,80); if(!id)return json(res,400,{error:'Missing customer id'});
      const b=req.body||{}; const patch={updated_at:new Date().toISOString()};
      ['name','phone','email','vehicle','vin','plate','mileage','last_service','notes'].forEach(k=>{if(b[k]!==undefined)patch[k]=s(b[k],k==='notes'?3000:300)||null});
      if(b.phone!==undefined)patch.normalized_phone=normalizePhone(b.phone)||null;
      let update=supabase.from('customers').update(patch).eq('id',id); update=applyShopScope(update,shop);
      const {data,error}=await update.select('*').maybeSingle();if(error)throw error;
      if(!data)return json(res,404,{error:'Customer not found'});
      await auditEvent(supabase,shop.id,'customer.updated','customer',data.id,{fields:Object.keys(patch)});
      return json(res,200,{status:'success',customer:data});
    }

    if(req.method==='DELETE' && action==='customer'){
      const id=s(req.query.id||req.body?.id,80);
      let del=supabase.from('customers').delete().eq('id',id); del=applyShopScope(del,shop);
      const {error}=await del;if(error)throw error;
      await auditEvent(supabase,shop.id,'customer.deleted','customer',id,{});
      return json(res,200,{status:'success'});
    }

    if(req.method==='POST' && action==='inspection'){
      const b=req.body||{};
      const name=s(b.customer_name||b.customerName,120),phone=s(b.phone,40),year=s(b.year,10),make=s(b.make,80),model=s(b.model,100);
      const vehicleText=s(b.vehicle,300)||[year,make,model].filter(Boolean).join(' ');
      if(!name||!phone||!vehicleText)return json(res,400,{error:'Customer name, phone and vehicle are required'});
      const customer=await upsertCustomer(supabase,{name,phone,email:b.email,vehicle:vehicleText,mileage:b.mileage},shop.id).catch(()=>null);
      const vehicle=customer?.id&&year&&make&&model?await upsertCustomerVehicle(supabase,{year,make,model,mileage:b.mileage,vehicle_id:b.vehicle_id},shop.id,customer.id).catch(()=>null):null;
      const row=withShopId({
        customer_id:customer?.id||null,vehicle_id:vehicle?.id||s(b.vehicle_id,80)||null,customer_name:name,phone,email:s(b.email,200)||null,vehicle:vehicleText,
        mileage:s(b.mileage,50)||null,technician:s(b.technician,120)||null,overall_status:s(b.overall_status||b.overallStatus,50)||'Monitor',recommendations:s(b.recommendations,5000)||null,
        inspection_items:arr(b.inspection_items||b.inspectionItems).slice(0,100).map((x,i)=>({id:s(x?.id||`item-${i+1}`,100),title:s(x?.title,160),status:s(x?.status,50)||'Monitor',notes:s(x?.notes,3000)})).filter(x=>x.title)
      },shop);
      for(const key of ['brakes','tires','suspension','fluids','battery','lights','wipers','filters','leaks']){
        if(b[`${key}_status`]!==undefined||b[`${key}Status`]!==undefined)row[`${key}_status`]=s(b[`${key}_status`]??b[`${key}Status`],50)||null;
        if(b[`${key}_notes`]!==undefined||b[`${key}Notes`]!==undefined)row[`${key}_notes`]=s(b[`${key}_notes`]??b[`${key}Notes`],2000)||null;
      }
      const {data,error}=await supabase.from('inspections').insert(row).select('*').single();if(error)throw error;
      await auditEvent(supabase,shop.id,'inspection.created','inspection',data.id,{customer:data.customer_name,vehicle:data.vehicle,status:data.overall_status});
      return json(res,201,{status:'success',inspection:data,inspectionId:data.id});
    }

    return json(res,400,{error:'Unsupported action'});
  }catch(err){
    console.error(err);
    return json(res,500,{error:err.message||'Admin operation failed'});
  }
};
