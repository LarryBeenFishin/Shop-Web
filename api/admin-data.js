const { verifyForShop } = require('./_auth');
const { db, upsertCustomer, upsertCustomerVehicle, normalizePhone, auditEvent, missingTable } = require('./_db');
const { resolveShop, applyShopScope, withShopId } = require('./_tenant');

const APPT_STATUSES=['pending','new','confirmed','checked-in','in-progress','waiting-approval','completed','cancelled'];
function json(res,code,data){return res.status(code).json(data)}
function s(v,n=3000){return String(v??'').trim().slice(0,n)}
function bool(v){return v===true||String(v).toLowerCase()==='true'||String(v).toLowerCase()==='yes'}
function arr(v){return Array.isArray(v)?v:[]}
function timeKey(v){
  const m=s(v,30).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i); if(!m) return s(v,30);
  let h=Number(m[1]); if(m[3].toUpperCase()==='PM'&&h!==12)h+=12; if(m[3].toUpperCase()==='AM'&&h===12)h=0;
  return `${String(h).padStart(2,'0')}:${m[2]}`;
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
