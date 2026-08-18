const { verify } = require('./_auth');
const { db, upsertCustomer, normalizePhone } = require('./_db');

const APPT_STATUSES=['pending','new','confirmed','checked-in','in-progress','waiting-approval','completed','cancelled'];
function json(res,code,data){return res.status(code).json(data)}
function s(v,n=3000){return String(v??'').trim().slice(0,n)}
function bool(v){return v===true||String(v).toLowerCase()==='true'||String(v).toLowerCase()==='yes'}
function timeKey(v){
  const m=s(v,30).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i); if(!m) return s(v,30);
  let h=Number(m[1]); if(m[3].toUpperCase()==='PM'&&h!==12)h+=12; if(m[3].toUpperCase()==='AM'&&h===12)h=0;
  return `${String(h).padStart(2,'0')}:${m[2]}`;
}

module.exports=async function handler(req,res){
  if(!verify(req)) return json(res,401,{error:'Unauthorized'});
  const supabase=db();
  const action=s(req.query.action||req.body?.action,80);
  try{
    if(req.method==='GET' && action==='appointments'){
      let q=supabase.from('appointments').select('*').order('appointment_date',{ascending:true}).order('appointment_time_key',{ascending:true}).limit(1000);
      if(req.query.from) q=q.gte('appointment_date',s(req.query.from,10));
      if(req.query.to) q=q.lte('appointment_date',s(req.query.to,10));
      const {data,error}=await q;if(error)throw error;return json(res,200,{status:'success',appointments:data||[]});
    }
    if(req.method==='GET' && action==='customers'){
      const {data:customers,error}=await supabase.from('customers').select('*').order('updated_at',{ascending:false}).limit(1000); if(error)throw error;
      const {data:appointments}=await supabase.from('appointments').select('name,phone,email,year,make,model,service,appointment_date,appointment_time,status');
      const {data:inspections}=await supabase.from('inspections').select('id,customer_id,customer_name,phone,created_at,vehicle');
      const appts=appointments||[], ins=inspections||[];
      const out=(customers||[]).map(c=>{
        const p=normalizePhone(c.phone); const ca=appts.filter(a=>normalizePhone(a.phone)===p); const ci=ins.filter(i=>i.customer_id===c.id||normalizePhone(i.phone)===p);
        const lastA=ca.sort((a,b)=>`${b.appointment_date} ${b.appointment_time}`.localeCompare(`${a.appointment_date} ${a.appointment_time}`))[0];
        const lastI=ci.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0];
        return {...c,totalAppointments:ca.length,lastAppointmentDate:lastA?.appointment_date||'',lastAppointmentTime:lastA?.appointment_time||'',lastInspectionId:lastI?.id||'',lastUpdated:c.updated_at};
      });
      return json(res,200,{status:'success',customers:out});
    }
    if(req.method==='GET' && action==='inspections'){
      const {data,error}=await supabase.from('inspections').select('*').order('created_at',{ascending:false}).limit(1000);if(error)throw error;return json(res,200,{status:'success',inspections:data||[]});
    }
    if(req.method==='GET' && action==='messages'){
      const {data,error}=await supabase.from('sms_messages').select('*').order('created_at',{ascending:true}).limit(1000);if(error)throw error;return json(res,200,{status:'success',messages:data||[]});
    }

    if(req.method==='POST' && action==='appointment'){
      const body=req.body||{}; const name=s(body.name,120),phone=s(body.phone,40),date=s(body.appointment_date||body.preferred_date_raw,10),time=s(body.appointment_time||body.preferred_time,30);
      if(!name||!phone||!date||!time) return json(res,400,{error:'Name, phone, date and time are required'});
      const row={name,phone,email:s(body.email,200)||null,year:s(body.year,10)||'N/A',make:s(body.make,80)||'N/A',model:s(body.model,100)||'N/A',service:s(body.service,120)||'Other',appointment_date:date,preferred_date_label:s(body.preferred_date_label||date,100),appointment_time:time,appointment_time_key:timeKey(time),drop_off:bool(body.drop_off),message:s(body.message,3000)||null,marketing_opt_in:bool(body.marketing_opt_in),submitted_from:'Admin Dashboard',status:APPT_STATUSES.includes(body.status)?body.status:'confirmed',internal_notes:s(body.internal_notes,3000)||null,seen:true,updated_at:new Date().toISOString()};
      const {data,error}=await supabase.from('appointments').insert(row).select('*').single();if(error){if(error.code==='23505')return json(res,409,{error:'That time is already booked'});throw error;}
      await upsertCustomer(supabase,{name,phone,email:row.email,vehicle:`${row.year} ${row.make} ${row.model}`,service:row.service}).catch(()=>{});
      return json(res,201,{status:'success',appointment:data});
    }
    if(req.method==='PATCH' && action==='appointment'){
      const id=s(req.body?.id,80); if(!id)return json(res,400,{error:'Missing appointment id'});
      const body=req.body||{}; const patch={updated_at:new Date().toISOString()};
      ['name','phone','email','year','make','model','service','appointment_date','appointment_time','message','internal_notes'].forEach(k=>{if(body[k]!==undefined)patch[k]=s(body[k],k==='message'||k==='internal_notes'?3000:200)||null});
      if(body.status!==undefined){if(!APPT_STATUSES.includes(body.status))return json(res,400,{error:'Invalid status'});patch.status=body.status;}
      if(body.seen!==undefined)patch.seen=bool(body.seen); if(body.drop_off!==undefined)patch.drop_off=bool(body.drop_off);
      if(body.appointment_time!==undefined)patch.appointment_time_key=timeKey(body.appointment_time);
      if(body.appointment_date!==undefined)patch.preferred_date_label=s(body.preferred_date_label||body.appointment_date,100);
      const {data,error}=await supabase.from('appointments').update(patch).eq('id',id).select('*').single();if(error){if(error.code==='23505')return json(res,409,{error:'That time is already booked'});throw error;}
      if(data) await upsertCustomer(supabase,{name:data.name,phone:data.phone,email:data.email,vehicle:`${data.year} ${data.make} ${data.model}`,service:data.service}).catch(()=>{});
      return json(res,200,{status:'success',appointment:data});
    }
    if(req.method==='DELETE' && action==='appointment'){
      const id=s(req.query.id||req.body?.id,80); const {error}=await supabase.from('appointments').delete().eq('id',id);if(error)throw error;return json(res,200,{status:'success'});
    }

    if(req.method==='POST' && action==='customer'){
      const b=req.body||{}; const customer=await upsertCustomer(supabase,b); return json(res,200,{status:'success',customer});
    }
    if(req.method==='PATCH' && action==='customer'){
      const id=s(req.body?.id,80); if(!id)return json(res,400,{error:'Missing customer id'}); const b=req.body||{}; const patch={updated_at:new Date().toISOString()};
      ['name','phone','email','vehicle','vin','plate','mileage','last_service','notes'].forEach(k=>{if(b[k]!==undefined)patch[k]=s(b[k],k==='notes'?3000:300)||null}); if(b.phone!==undefined)patch.normalized_phone=normalizePhone(b.phone)||null;
      const {data,error}=await supabase.from('customers').update(patch).eq('id',id).select('*').single();if(error)throw error;return json(res,200,{status:'success',customer:data});
    }
    if(req.method==='DELETE' && action==='customer'){
      const id=s(req.query.id||req.body?.id,80); const {error}=await supabase.from('customers').delete().eq('id',id);if(error)throw error;return json(res,200,{status:'success'});
    }

    if(req.method==='POST' && action==='inspection'){
      const b=req.body||{}; if(!s(b.customer_name||b.customerName,120)||!s(b.vehicle,300))return json(res,400,{error:'Customer name and vehicle are required'});
      const customer=await upsertCustomer(supabase,{name:b.customer_name||b.customerName,phone:b.phone||'No phone',email:b.email,vehicle:b.vehicle,mileage:b.mileage}).catch(()=>null);
      const row={customer_id:customer?.id||null,customer_name:s(b.customer_name||b.customerName,120),phone:s(b.phone,40)||null,email:s(b.email,200)||null,vehicle:s(b.vehicle,300),mileage:s(b.mileage,50)||null,technician:s(b.technician,120)||null,overall_status:s(b.overall_status||b.overallStatus,50)||'Monitor',recommendations:s(b.recommendations,5000)||null};
      for(const key of ['brakes','tires','suspension','fluids','battery','lights','wipers','filters','leaks']){row[`${key}_status`]=s(b[`${key}_status`]??b[`${key}Status`],50)||'Monitor';row[`${key}_notes`]=s(b[`${key}_notes`]??b[`${key}Notes`],2000)||null;}
      const {data,error}=await supabase.from('inspections').insert(row).select('*').single();if(error)throw error;return json(res,201,{status:'success',inspection:data,inspectionId:data.id});
    }

    return json(res,400,{error:'Unsupported action'});
  }catch(err){console.error(err);return json(res,500,{error:err.message||'Admin operation failed'});}
};
