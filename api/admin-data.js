const { verifyForShop, hashPassword, verifyPassword } = require('./_auth');
const { db, upsertCustomer, upsertCustomerVehicle, normalizePhone, auditEvent, missingTable } = require('./_db');
const { resolveShop, applyShopScope, withShopId, clearShopCache } = require('./_tenant');
const { loadAvailability, saveAvailability } = require('./_availability');

const APPT_STATUSES=['pending','new','confirmed','checked-in','in-progress','waiting-approval','completed','cancelled'];
const INSPECTION_STATUSES=new Set(['Good','Monitor','Needs Attention']);
const DEFAULT_INSPECTION_BLOCKS=['DASHBOARD LIGHTS','BATTERY','LIGHTS','STEERING AND SUSPENSION','BRAKES','TIRES','FLUIDS','FILTERS / BELTS'];
function json(res,code,data){return res.status(code).json(data)}
function s(v,n=3000){return String(v??'').trim().slice(0,n)}
function bool(v){return v===true||String(v).toLowerCase()==='true'||String(v).toLowerCase()==='yes'}
function arr(v){return Array.isArray(v)?v:[]}
function uniqueTextList(value,maxItems=50,maxLength=120){const out=[],seen=new Set();for(const item of arr(value)){const text=s(item,maxLength),key=text.toLowerCase();if(!text||seen.has(key))continue;seen.add(key);out.push(text);if(out.length>=maxItems)break}return out}
function safeTechnician(row){return row?{id:row.id,name:row.name,username:row.username,email:row.email||'',active:row.active!==false}:null}
function validUsername(value){return /^[a-z0-9._-]{3,40}$/.test(value)}
function inspectionItems(value){return arr(value).slice(0,100).map((x,i)=>({id:s(x?.id||`item-${i+1}`,100),title:s(x?.title,160),status:INSPECTION_STATUSES.has(x?.status)?x.status:'Monitor',notes:s(x?.notes,3000)})).filter(x=>x.title)}
function inspectionTemplate(config){const blocks=uniqueTextList(config?.inspectionBlocks,50,120);return blocks.length?blocks:[...DEFAULT_INSPECTION_BLOCKS]}
function derivedInspectionStatus(items){return items.some(item=>item.status==='Needs Attention')?'Needs Attention':items.some(item=>item.status==='Monitor')?'Monitor':'Good'}
function normalizeMessageTemplates(value){return arr(value).slice(0,100).map((item,index)=>({id:(s(item?.id,80).replace(/[^a-zA-Z0-9_-]/g,'')||`template-${index+1}`),name:s(item?.name,100),message:s(item?.message,1600)})).filter(item=>item.name&&item.message)}
function defaultMessageTemplates(shopName){const name=s(shopName,120)||'our shop';return[
  {id:'appointment-confirmed',name:'Appointment Confirmed',message:`Hi, this is ${name}. Your appointment has been confirmed. Reply here if you have any questions.`},
  {id:'inspection-ready',name:'Inspection Ready',message:`Hi, this is ${name}. Your vehicle inspection is ready. Please review it when you have a chance.`},
  {id:'vehicle-ready',name:'Vehicle Ready',message:`Hi, this is ${name}. Your vehicle is ready for pickup. Thank you!`},
  {id:'estimate-follow-up',name:'Estimate Follow-Up',message:`Hi, this is ${name}. Just checking in to see if you had any questions about your estimate.`},
  {id:'review-request',name:'Review Request',message:`Thank you for choosing ${name}. If you had a great experience, we would really appreciate a Google review.`}
]}
function messageTemplates(config,shopName){return Array.isArray(config?.messageTemplates)?normalizeMessageTemplates(config.messageTemplates):defaultMessageTemplates(shopName)}
function addInspectionLegacy(row,items){for(const key of ['brakes','tires','suspension','fluids','battery','lights','wipers','filters','leaks']){const match=items.find(item=>item.title.toLowerCase()===key);row[`${key}_status`]=match?.status||null;row[`${key}_notes`]=match?.notes||null}return row}
async function technicianIdForName(supabase,shopId,name){if(!shopId||!name)return null;const {data,error}=await supabase.from('technician_accounts').select('id').eq('shop_id',shopId).eq('active',true).eq('name',name).limit(1);if(error){if(missingTable(error,'technician_accounts'))return null;throw error}return data?.[0]?.id||null}
function timeKey(v){
  const m=s(v,30).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i); if(!m) return s(v,30);
  let h=Number(m[1]); if(m[3].toUpperCase()==='PM'&&h!==12)h+=12; if(m[3].toUpperCase()==='AM'&&h===12)h=0;
  return `${String(h).padStart(2,'0')}:${m[2]}`;
}

module.exports=async function handler(req,res){
  const supabase=db();
  let shop;
  try{shop=await resolveShop(req,supabase);}catch(err){console.error(err);return json(res,500,{error:err.message||'Unable to resolve shop'});}
  const session=verifyForShop(req,shop);
  if(!session) return json(res,401,{error:'Unauthorized'});
  const action=s(req.query.action||req.body?.action,80);

  try{
    if(req.method==='PUT' && action==='owner-password'){
      if(!shop.id||!session.adminId)return json(res,400,{error:'Sign in with a shop owner account to change its password'});
      const currentPassword=String(req.body?.currentPassword||''),newPassword=String(req.body?.newPassword||'');
      if(!currentPassword||!newPassword)return json(res,400,{error:'Current password and new password are required'});
      if(newPassword.length<8)return json(res,400,{error:'New password must be at least 8 characters'});
      const {data:account,error:findError}=await supabase.from('shop_admin_accounts').select('id,password_hash,active').eq('id',session.adminId).eq('shop_id',shop.id).maybeSingle();
      if(findError)throw findError;
      if(!account?.active)return json(res,401,{error:'Owner account not found or inactive'});
      if(!verifyPassword(currentPassword,account.password_hash))return json(res,401,{error:'Current password is incorrect'});
      const {error}=await supabase.from('shop_admin_accounts').update({password_hash:hashPassword(newPassword),updated_at:new Date().toISOString()}).eq('id',account.id).eq('shop_id',shop.id);
      if(error)throw error;
      await auditEvent(supabase,shop.id,'owner.password.updated','shop_admin_account',account.id,{},`admin:${account.id}`);
      return json(res,200,{status:'success'});
    }

    if(req.method==='GET' && action==='shop-settings'){
      if(!shop.id)return json(res,200,{status:'success',shop:{name:shop.name,technicians:[],inspectionBlocks:[...DEFAULT_INSPECTION_BLOCKS]}});
      const {data,error}=await supabase.from('shops').select('name,notification_email,public_config').eq('id',shop.id).maybeSingle();
      if(error)throw error;
      const config=data?.public_config||shop.public_config||{};
      let technicians=[];
      const {data:accounts,error:accountError}=await supabase.from('technician_accounts').select('id,name,username,email,active').eq('shop_id',shop.id).eq('active',true).order('name');
      if(accountError){
        if(!missingTable(accountError,'technician_accounts'))throw accountError;
        technicians=uniqueTextList(config?.staff?.technicians).map(name=>({id:null,name,username:'',active:true,legacy:true}));
      }else technicians=(accounts||[]).map(safeTechnician);
      return json(res,200,{status:'success',shop:{name:data?.name||shop.name,notificationEmail:data?.notification_email||'',technicians,inspectionBlocks:inspectionTemplate(config)}});
    }

    if(req.method==='PUT' && action==='shop-settings'){
      if(!shop.id)return json(res,400,{error:'Multi-shop setup is required before shop settings can be saved'});
      const name=s(req.body?.name,120),notificationEmail=s(req.body?.notificationEmail,240).toLowerCase();
      if(!name)return json(res,400,{error:'Business name is required'});
      if(notificationEmail&&!/^\S+@\S+\.\S+$/.test(notificationEmail))return json(res,400,{error:'Enter a valid notification email'});
      const {data,error}=await supabase.from('shops').update({name,notification_email:notificationEmail||null,updated_at:new Date().toISOString()}).eq('id',shop.id).select('name,notification_email').single();
      if(error)throw error;
      clearShopCache(shop);
      await auditEvent(supabase,shop.id,'shop.settings.updated','shop',shop.id,{name,notification_email:notificationEmail||null});
      return json(res,200,{status:'success',shop:{name:data.name,notificationEmail:data.notification_email||''}});
    }

    if(req.method==='PUT' && action==='inspection-template'){
      if(!shop.id)return json(res,400,{error:'Multi-shop setup is required before inspection blocks can be saved'});
      const inspectionBlocks=uniqueTextList(req.body?.inspectionBlocks,50,120);
      if(!inspectionBlocks.length)return json(res,400,{error:'Keep at least one inspection block'});
      const {data:current,error:findError}=await supabase.from('shops').select('public_config').eq('id',shop.id).maybeSingle();
      if(findError)throw findError;
      const publicConfig={...(current?.public_config||shop.public_config||{}),inspectionBlocks};
      const {error}=await supabase.from('shops').update({public_config:publicConfig,updated_at:new Date().toISOString()}).eq('id',shop.id);
      if(error)throw error;
      clearShopCache(shop);
      await auditEvent(supabase,shop.id,'inspection.template.updated','shop',shop.id,{inspection_blocks:inspectionBlocks});
      return json(res,200,{status:'success',inspectionBlocks});
    }

    if(req.method==='GET' && action==='message-templates'){
      if(!shop.id)return json(res,200,{status:'success',templates:defaultMessageTemplates(shop.name)});
      const {data,error}=await supabase.from('shops').select('name,public_config').eq('id',shop.id).maybeSingle();
      if(error)throw error;
      return json(res,200,{status:'success',templates:messageTemplates(data?.public_config||shop.public_config,data?.name||shop.name)});
    }

    if(req.method==='PUT' && action==='message-templates'){
      if(!shop.id)return json(res,400,{error:'Multi-shop setup is required before text templates can be saved'});
      const templates=normalizeMessageTemplates(req.body?.templates);
      if(arr(req.body?.templates).length!==templates.length)return json(res,400,{error:'Every template needs a name and message'});
      const {data:current,error:findError}=await supabase.from('shops').select('public_config').eq('id',shop.id).maybeSingle();
      if(findError)throw findError;
      const publicConfig={...(current?.public_config||shop.public_config||{}),messageTemplates:templates};
      const {error}=await supabase.from('shops').update({public_config:publicConfig,updated_at:new Date().toISOString()}).eq('id',shop.id);
      if(error)throw error;
      clearShopCache(shop);
      await auditEvent(supabase,shop.id,'sms.templates.updated','shop',shop.id,{template_count:templates.length});
      return json(res,200,{status:'success',templates});
    }

    if(req.method==='POST' && action==='technician'){
      if(!shop.id)return json(res,400,{error:'Multi-shop setup is required before technician accounts can be created'});
      const name=s(req.body?.name,120),username=s(req.body?.username,40).toLowerCase(),email=s(req.body?.email,240).toLowerCase(),password=String(req.body?.password||'');
      if(!name)return json(res,400,{error:'Technician name is required'});
      if(!validUsername(username))return json(res,400,{error:'Username must be 3–40 characters using letters, numbers, periods, dashes, or underscores'});
      if(!/^\S+@\S+\.\S+$/.test(email))return json(res,400,{error:'Enter a valid recovery email'});
      if(password.length<8)return json(res,400,{error:'Temporary password must be at least 8 characters'});
      const row={shop_id:shop.id,name,username,email,password_hash:hashPassword(password),active:true,updated_at:new Date().toISOString()};
      const {data,error}=await supabase.from('technician_accounts').insert(row).select('id,name,username,email,active').single();
      if(!error){
        await auditEvent(supabase,shop.id,'technician.created','technician',data.id,{name:data.name,username:data.username});
        return json(res,201,{status:'success',technician:safeTechnician(data)});
      }
      if(error.code!=='23505')throw error;
      const {data:matches,error:matchError}=await supabase.from('technician_accounts').select('id,name,username,email,active').eq('shop_id',shop.id).limit(1000);
      if(matchError)throw matchError;
      const inactive=(matches||[]).find(account=>account.active===false&&String(account.username||'').toLowerCase()===username);
      if(!inactive)return json(res,409,{error:'That username is already in use'});
      const {data:reactivated,error:reactivateError}=await supabase.from('technician_accounts').update({name,username,email,password_hash:row.password_hash,active:true,updated_at:row.updated_at}).eq('id',inactive.id).eq('shop_id',shop.id).eq('active',false).select('id,name,username,email,active').maybeSingle();
      if(reactivateError){if(reactivateError.code==='23505')return json(res,409,{error:'That username is already in use'});throw reactivateError;}
      if(!reactivated)return json(res,409,{error:'That username is already in use'});
      await auditEvent(supabase,shop.id,'technician.reactivated','technician',reactivated.id,{previous_name:inactive.name,name:reactivated.name,username:reactivated.username});
      return json(res,200,{status:'success',technician:safeTechnician(reactivated),reactivated:true});
    }

    if(req.method==='PATCH' && action==='technician'){
      const id=s(req.body?.id,80);if(!id)return json(res,400,{error:'Missing technician id'});
      const patch={updated_at:new Date().toISOString()};
      if(req.body?.name!==undefined){patch.name=s(req.body.name,120);if(!patch.name)return json(res,400,{error:'Technician name is required'});}
      if(req.body?.username!==undefined){patch.username=s(req.body.username,40).toLowerCase();if(!validUsername(patch.username))return json(res,400,{error:'Username must be 3–40 characters using letters, numbers, periods, dashes, or underscores'});}
      if(req.body?.email!==undefined){patch.email=s(req.body.email,240).toLowerCase();if(!/^\S+@\S+\.\S+$/.test(patch.email))return json(res,400,{error:'Enter a valid recovery email'});}
      if(req.body?.active!==undefined)patch.active=bool(req.body.active);
      if(req.body?.password!==undefined){const password=String(req.body.password||'');if(password.length<8)return json(res,400,{error:'Password must be at least 8 characters'});patch.password_hash=hashPassword(password);}
      let update=supabase.from('technician_accounts').update(patch).eq('id',id).eq('shop_id',shop.id);
      const {data,error}=await update.select('id,name,username,email,active').maybeSingle();
      if(error){if(error.code==='23505')return json(res,409,{error:'That username is already in use'});throw error;}
      if(!data)return json(res,404,{error:'Technician account not found'});
      await auditEvent(supabase,shop.id,'technician.updated','technician',data.id,{fields:Object.keys(patch)});
      return json(res,200,{status:'success',technician:safeTechnician(data)});
    }

    if(req.method==='DELETE' && action==='technician'){
      const id=s(req.query.id||req.body?.id,80);if(!id)return json(res,400,{error:'Missing technician id'});
      const {data:existing,error:findError}=await supabase.from('technician_accounts').select('id,name,username').eq('id',id).eq('shop_id',shop.id).maybeSingle();
      if(findError)throw findError;if(!existing)return json(res,404,{error:'Technician account not found'});
      const deletedUsername=`deleted-${existing.id.replace(/-/g,'').slice(0,8)}-${existing.username}`.slice(0,40);
      const {data,error}=await supabase.from('technician_accounts').update({active:false,username:deletedUsername,updated_at:new Date().toISOString()}).eq('id',id).eq('shop_id',shop.id).select('id,name,username,active').maybeSingle();
      if(error)throw error;if(!data)return json(res,404,{error:'Technician account not found'});
      await auditEvent(supabase,shop.id,'technician.deleted','technician',data.id,{name:data.name,username:existing.username});
      return json(res,200,{status:'success',technician:safeTechnician(data)});
    }

    if(req.method==='GET' && action==='inspection-requests'){
      let q=supabase.from('inspection_requests').select('*').eq('shop_id',shop.id).order('created_at',{ascending:false}).limit(500);
      if(req.query.status)q=q.eq('status',s(req.query.status,30));
      const [{data:requests,error},{data:technicians,error:techError}]=await Promise.all([q,supabase.from('technician_accounts').select('id,name,username,active').eq('shop_id',shop.id)]);
      if(error)throw error;if(techError)throw techError;
      const names=new Map((technicians||[]).map(item=>[item.id,item.name]));
      return json(res,200,{status:'success',requests:(requests||[]).map(item=>({...item,technician_name:names.get(item.technician_id)||'Unassigned'}))});
    }

    if(req.method==='POST' && action==='inspection-request'){
      const appointmentId=s(req.body?.appointment_id,80);
      if(appointmentId){
        const {data:existing,error:existingError}=await supabase.from('inspection_requests').select('*').eq('shop_id',shop.id).eq('appointment_id',appointmentId).maybeSingle();
        if(existingError)throw existingError;
        if(existing){
          if(existing.status==='cancelled'){
            const {data:reopened,error:reopenError}=await supabase.from('inspection_requests').update({status:'requested',technician_id:null,started_at:null,completed_at:null,updated_at:new Date().toISOString()}).eq('id',existing.id).eq('shop_id',shop.id).select('*').single();
            if(reopenError)throw reopenError;
            await auditEvent(supabase,shop.id,'inspection.requested','inspection_request',reopened.id,{source:'appointment',appointment_id:appointmentId,reopened:true});
            return json(res,200,{status:'success',request:reopened,reused:true});
          }
          return json(res,200,{status:'success',request:existing,reused:true});
        }
        let appointmentQuery=supabase.from('appointments').select('*').eq('id',appointmentId);appointmentQuery=applyShopScope(appointmentQuery,shop);
        const {data:appointment,error:appointmentError}=await appointmentQuery.maybeSingle();
        if(appointmentError)throw appointmentError;if(!appointment)return json(res,404,{error:'Appointment not found'});
        const vehicleText=[appointment.year,appointment.make,appointment.model].filter(Boolean).join(' ')||'Vehicle';
        const customer=await upsertCustomer(supabase,{name:appointment.name,phone:appointment.phone,email:appointment.email,vehicle:vehicleText,service:appointment.service},shop.id);
        const vehicle=customer?.id?await upsertCustomerVehicle(supabase,{year:appointment.year,make:appointment.make,model:appointment.model,vehicle_id:appointment.vehicle_id,service:appointment.service},shop.id,customer.id):null;
        const requestNotes=[appointment.service?`Service: ${appointment.service}`:'',appointment.message?`Customer concern: ${appointment.message}`:''].filter(Boolean).join('\n')||null;
        const row={shop_id:shop.id,appointment_id:appointment.id,technician_id:null,customer_id:customer?.id||appointment.customer_id||null,vehicle_id:vehicle?.id||appointment.vehicle_id||null,customer_name:appointment.name,phone:appointment.phone||null,email:appointment.email||null,vehicle:vehicleText,mileage:vehicle?.mileage||null,request_notes:requestNotes,status:'requested',updated_at:new Date().toISOString()};
        const {data,error}=await supabase.from('inspection_requests').insert(row).select('*').single();
        if(error){if(error.code==='23505')return json(res,409,{error:'An inspection has already been requested for this appointment'});throw error;}
        await auditEvent(supabase,shop.id,'inspection.requested','inspection_request',data.id,{source:'appointment',appointment_id:appointment.id,customer:appointment.name,vehicle:vehicleText});
        return json(res,201,{status:'success',request:data});
      }
      const technicianId=s(req.body?.technician_id,80),customerId=s(req.body?.customer_id,80),vehicleId=s(req.body?.vehicle_id,80);
      if(!technicianId||!customerId||!vehicleId)return json(res,400,{error:'Customer, vehicle, and technician are required'});
      const [{data:technician,error:techError},{data:customer,error:customerError},{data:vehicle,error:vehicleError}]=await Promise.all([
        supabase.from('technician_accounts').select('id,name').eq('id',technicianId).eq('shop_id',shop.id).eq('active',true).maybeSingle(),
        supabase.from('customers').select('id,name,phone,email').eq('id',customerId).eq('shop_id',shop.id).maybeSingle(),
        supabase.from('customer_vehicles').select('*').eq('id',vehicleId).eq('customer_id',customerId).eq('shop_id',shop.id).maybeSingle()
      ]);
      if(techError)throw techError;if(customerError)throw customerError;if(vehicleError)throw vehicleError;
      if(!technician)return json(res,400,{error:'Choose an active technician account'});
      if(!customer)return json(res,404,{error:'Customer not found'});
      if(!vehicle)return json(res,404,{error:'Vehicle not found'});
      const vehicleText=[vehicle.year,vehicle.make,vehicle.model].filter(Boolean).join(' ')||s(vehicle.nickname,300)||'Vehicle';
      const row={shop_id:shop.id,technician_id:technician.id,customer_id:customer.id,vehicle_id:vehicle.id,customer_name:customer.name,phone:customer.phone||null,email:customer.email||null,vehicle:vehicleText,mileage:vehicle.mileage||null,request_notes:s(req.body?.request_notes||req.body?.notes,3000)||null,status:'requested',updated_at:new Date().toISOString()};
      const {data,error}=await supabase.from('inspection_requests').insert(row).select('*').single();if(error)throw error;
      await auditEvent(supabase,shop.id,'inspection.requested','inspection_request',data.id,{technician_id:technician.id,customer:customer.name,vehicle:vehicleText});
      return json(res,201,{status:'success',request:{...data,technician_name:technician.name}});
    }

    if(req.method==='PATCH' && action==='inspection-request'){
      const id=s(req.body?.id,80);if(!id)return json(res,400,{error:'Missing inspection request id'});
      const {data:existing,error:loadError}=await supabase.from('inspection_requests').select('*').eq('id',id).eq('shop_id',shop.id).maybeSingle();
      if(loadError)throw loadError;if(!existing)return json(res,404,{error:'Inspection request not found'});
      const changingTechnician=req.body?.technician_id!==undefined;
      if(existing.status==='completed'&&!changingTechnician)return json(res,409,{error:'A completed inspection request cannot be changed'});
      const patch={updated_at:new Date().toISOString()};
      if(req.body?.status!==undefined){const status=s(req.body.status,30);if(!['requested','in_progress','cancelled'].includes(status))return json(res,400,{error:'Invalid request status'});patch.status=status;}
      let assignedTechnician=null;
      if(changingTechnician){const technicianId=s(req.body.technician_id,80);if(!technicianId){if(existing.status==='completed')return json(res,400,{error:'A completed inspection must have an assigned technician'});patch.technician_id=null;}else{const {data:technician,error}=await supabase.from('technician_accounts').select('id,name').eq('id',technicianId).eq('shop_id',shop.id).eq('active',true).maybeSingle();if(error)throw error;if(!technician)return json(res,400,{error:'Choose an active technician account'});assignedTechnician=technician;patch.technician_id=technician.id;}if(existing.status==='in_progress'&&technicianId!==existing.technician_id){patch.status='requested';patch.started_at=null;}}
      const {data,error}=await supabase.from('inspection_requests').update(patch).eq('id',id).eq('shop_id',shop.id).select('*').single();if(error)throw error;
      if(existing.status==='completed'&&existing.inspection_id&&assignedTechnician){const {error:inspectionError}=await supabase.from('inspections').update({technician_id:assignedTechnician.id,technician:assignedTechnician.name}).eq('id',existing.inspection_id).eq('shop_id',shop.id);if(inspectionError)throw inspectionError;}
      await auditEvent(supabase,shop.id,'inspection.request.updated','inspection_request',data.id,{fields:Object.keys(patch),status:data.status});
      return json(res,200,{status:'success',request:data});
    }

    if(req.method==='GET' && action==='availability'){
      const {settings}=await loadAvailability(supabase,shop);
      return json(res,200,{status:'success',timezone:shop.timezone||'America/Chicago',availability:settings});
    }

    if(req.method==='PUT' && action==='availability'){
      const settings=await saveAvailability(supabase,shop,req.body?.availability||req.body||{});
      await auditEvent(supabase,shop.id,'appointment.availability.updated','shop',shop.id,{weekly:settings.weekly,closure_count:settings.closures.length,slot_minutes:settings.slotMinutes});
      return json(res,200,{status:'success',timezone:shop.timezone||'America/Chicago',availability:settings});
    }

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

    if(req.method==='GET' && action==='live-updates'){
      if(!shop.id)return json(res,200,{status:'success',events:[],cursor:new Date().toISOString()});
      const rawSince=s(req.query.since,80),since=rawSince&&!Number.isNaN(Date.parse(rawSince))?rawSince:'';
      let q=supabase.from('audit_events').select('id,actor,action,entity_type,entity_id,metadata,created_at').eq('shop_id',shop.id);
      if(since)q=q.gte('created_at',since).order('created_at',{ascending:true}).limit(100);
      else q=q.order('created_at',{ascending:false}).limit(1);
      const {data,error}=await q;if(error)throw error;
      const events=data||[],latest=events.reduce((value,event)=>String(event.created_at||'')>value?String(event.created_at):value,'');
      return json(res,200,{status:'success',events,cursor:latest||new Date().toISOString()});
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
      const suppliedName=s(b.customer_name||b.customerName,120),phone=s(b.phone,40),year=s(b.year,10),make=s(b.make,80),model=s(b.model,100),name=suppliedName||'Customer not provided';
      const vehicleText=s(b.vehicle,300)||[year,make,model].filter(Boolean).join(' ')||'Vehicle not provided';
      const customer=suppliedName&&phone?await upsertCustomer(supabase,{name:suppliedName,phone,email:b.email,vehicle:vehicleText==='Vehicle not provided'?null:vehicleText,mileage:b.mileage},shop.id).catch(()=>null):null;
      const vehicle=customer?.id&&year&&make&&model?await upsertCustomerVehicle(supabase,{year,make,model,mileage:b.mileage,vehicle_id:b.vehicle_id},shop.id,customer.id).catch(()=>null):null;
      const items=inspectionItems(b.inspection_items||b.inspectionItems),technicianName=s(b.technician,120),technicianId=await technicianIdForName(supabase,shop.id,technicianName);
      if(!items.length)return json(res,400,{error:'Add at least one inspection block'});
      const row=addInspectionLegacy(withShopId({
        customer_id:customer?.id||null,vehicle_id:vehicle?.id||s(b.vehicle_id,80)||null,customer_name:name,phone:phone||null,email:s(b.email,200)||null,vehicle:vehicleText,
        mileage:s(b.mileage,50)||null,technician:technicianName||null,technician_id:technicianId,overall_status:derivedInspectionStatus(items),recommendations:s(b.recommendations,5000)||null,inspection_items:items
      },shop),items);
      const {data,error}=await supabase.from('inspections').insert(row).select('*').single();if(error)throw error;
      await auditEvent(supabase,shop.id,'inspection.created','inspection',data.id,{customer:data.customer_name,vehicle:data.vehicle,status:data.overall_status});
      return json(res,201,{status:'success',inspection:data,inspectionId:data.id});
    }

    if(req.method==='PATCH' && action==='inspection'){
      const b=req.body||{},id=s(b.id,80),suppliedName=s(b.customer_name||b.customerName,120),name=suppliedName||'Customer not provided',phone=s(b.phone,40),year=s(b.year,10),make=s(b.make,80),model=s(b.model,100),vehicleText=s(b.vehicle,300)||[year,make,model].filter(Boolean).join(' ')||'Vehicle not provided',items=inspectionItems(b.inspection_items||b.inspectionItems);
      if(!id)return json(res,400,{error:'Missing inspection id'});if(!items.length)return json(res,400,{error:'Add at least one inspection block'});
      const customer=suppliedName&&phone?await upsertCustomer(supabase,{name:suppliedName,phone,email:b.email,vehicle:vehicleText==='Vehicle not provided'?null:vehicleText,mileage:b.mileage},shop.id).catch(()=>null):null;
      const vehicle=customer?.id&&year&&make&&model?await upsertCustomerVehicle(supabase,{year,make,model,mileage:b.mileage,vehicle_id:b.vehicle_id},shop.id,customer.id).catch(()=>null):null;
      const technicianName=s(b.technician,120),technicianId=await technicianIdForName(supabase,shop.id,technicianName);
      const patch=addInspectionLegacy({customer_id:customer?.id||null,vehicle_id:vehicle?.id||s(b.vehicle_id,80)||null,customer_name:name,phone:phone||null,email:s(b.email,200)||null,vehicle:vehicleText,mileage:s(b.mileage,50)||null,technician:technicianName||null,technician_id:technicianId,overall_status:derivedInspectionStatus(items),recommendations:s(b.recommendations,5000)||null,inspection_items:items},items);
      let update=supabase.from('inspections').update(patch).eq('id',id);update=applyShopScope(update,shop);
      const {data,error}=await update.select('*').maybeSingle();if(error)throw error;if(!data)return json(res,404,{error:'Inspection not found'});
      await auditEvent(supabase,shop.id,'inspection.updated','inspection',data.id,{customer:data.customer_name,vehicle:data.vehicle,status:data.overall_status,block_count:items.length});
      return json(res,200,{status:'success',inspection:data,inspectionId:data.id});
    }

    if(req.method==='DELETE' && action==='inspection'){
      const id=s(req.query.id||req.body?.id,80);if(!id)return json(res,400,{error:'Missing inspection id'});
      let find=supabase.from('inspections').select('id,inspection_request_id,customer_name,vehicle').eq('id',id);find=applyShopScope(find,shop);
      const {data:existing,error:findError}=await find.maybeSingle();if(findError)throw findError;if(!existing)return json(res,404,{error:'Inspection not found'});
      let del=supabase.from('inspections').delete().eq('id',id);del=applyShopScope(del,shop);
      const {error}=await del;if(error)throw error;
      if(existing.inspection_request_id){const {error:requestError}=await supabase.from('inspection_requests').update({status:'requested',inspection_id:null,completed_at:null,started_at:null,updated_at:new Date().toISOString()}).eq('id',existing.inspection_request_id).eq('shop_id',shop.id);if(requestError)throw requestError;}
      await auditEvent(supabase,shop.id,'inspection.deleted','inspection',id,{customer:existing.customer_name,vehicle:existing.vehicle,reopened_request_id:existing.inspection_request_id||null});
      return json(res,200,{status:'success'});
    }

    return json(res,400,{error:'Unsupported action'});
  }catch(err){
    console.error(err);
    return json(res,500,{error:err.message||'Admin operation failed'});
  }
};
