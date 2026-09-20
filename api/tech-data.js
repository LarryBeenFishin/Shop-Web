const { verifyTechForShop } = require('./_auth');
const { db, auditEvent, upsertCustomer, upsertCustomerVehicle, normalizePhone } = require('./_db');
const { resolveShop, withShopId } = require('./_tenant');

const ITEM_STATUSES=new Set(['Good','Monitor','Needs Attention']);
function clean(v,n=3000){return String(v??'').trim().slice(0,n)}
function json(res,code,data){return res.status(code).json(data)}
function normalizeItems(value){return(Array.isArray(value)?value:[]).slice(0,50).map((item,index)=>({id:clean(item?.id,80)||`item-${index+1}`,title:clean(item?.title,120),status:ITEM_STATUSES.has(item?.status)?item.status:'Monitor',notes:clean(item?.notes,3000)})).filter(item=>item.title)}
function status(value){return ITEM_STATUSES.has(value)?value:'Monitor'}
function addLegacyFields(row,items){for(const key of ['brakes','tires','suspension','fluids','battery','lights','wipers','filters','leaks']){const match=items.find(item=>item.title.toLowerCase()===key);row[`${key}_status`]=match?.status||null;row[`${key}_notes`]=match?.notes||null;}return row}

module.exports=async function handler(req,res){
  const supabase=db();
  try{
    const shop=await resolveShop(req,supabase),session=verifyTechForShop(req,shop);
    if(!session)return json(res,401,{error:'Unauthorized'});
    const {data:technician,error:techError}=await supabase.from('technician_accounts').select('id,name,username,active').eq('shop_id',shop.id).eq('id',session.technicianId).maybeSingle();
    if(techError)throw techError;
    if(!technician?.active)return json(res,401,{error:'This technician account is inactive'});
    const action=clean(req.query.action||req.body?.action,80);

    if(req.method==='GET'&&(action==='session'||action==='requests')){
      let query=supabase.from('inspection_requests').select('*').eq('shop_id',shop.id).eq('technician_id',technician.id).order('created_at',{ascending:false}).limit(200);
      if(action==='requests'&&req.query.status)query=query.eq('status',clean(req.query.status,30));
      const {data,error}=await query;if(error)throw error;
      return json(res,200,{status:'success',shop:{name:shop.name},technician,requests:data||[]});
    }

    if(req.method==='GET'&&action==='inspections'){
      const {data,error}=await supabase.from('inspections').select('*').eq('shop_id',shop.id).order('created_at',{ascending:false}).limit(1000);
      if(error)throw error;
      return json(res,200,{status:'success',shop:{name:shop.name},technician,inspections:(data||[]).map(item=>({...item,can_edit:item.technician_id===technician.id||(!item.technician_id&&clean(item.technician,120).toLowerCase()===technician.name.toLowerCase())}))});
    }

    if(req.method==='GET'&&action==='customer-lookup'){
      const phone=normalizePhone(req.query.phone);
      if(phone.length<7)return json(res,200,{status:'success',found:false,customer:null,vehicles:[]});
      const {data:customer,error}=await supabase.from('customers').select('*').eq('shop_id',shop.id).eq('normalized_phone',phone).maybeSingle();
      if(error)throw error;if(!customer)return json(res,200,{status:'success',found:false,customer:null,vehicles:[]});
      const {data:vehicles,error:vehicleError}=await supabase.from('customer_vehicles').select('*').eq('shop_id',shop.id).eq('customer_id',customer.id).order('last_seen_at',{ascending:false});
      if(vehicleError)throw vehicleError;
      return json(res,200,{status:'success',found:true,customer:{id:customer.id,name:customer.name,phone:customer.phone,email:customer.email},vehicles:vehicles||[]});
    }

    if(req.method==='POST'&&action==='start'){
      const id=clean(req.body?.id,80);if(!id)return json(res,400,{error:'Missing request id'});
      const {data,error}=await supabase.from('inspection_requests').update({status:'in_progress',started_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',id).eq('shop_id',shop.id).eq('technician_id',technician.id).eq('status','requested').select('*').maybeSingle();
      if(error)throw error;
      if(data)return json(res,200,{status:'success',request:data});
      const {data:existing,error:existingError}=await supabase.from('inspection_requests').select('*').eq('id',id).eq('shop_id',shop.id).eq('technician_id',technician.id).maybeSingle();if(existingError)throw existingError;
      if(!existing)return json(res,404,{error:'Inspection request not found'});
      if(existing.status==='cancelled')return json(res,409,{error:'This inspection request was cancelled'});
      if(existing.status==='completed')return json(res,409,{error:'This inspection request is already completed'});
      return json(res,200,{status:'success',request:existing});
    }

    if(req.method==='POST'&&action==='inspection'){
      const requestId=clean(req.body?.request_id,80),items=normalizeItems(req.body?.inspection_items||req.body?.inspectionItems);
      if(!items.length)return json(res,400,{error:'Add at least one inspection block'});
      let request=null,customer=null,vehicle=null;
      if(requestId){
        const {data,error}=await supabase.from('inspection_requests').select('*').eq('id',requestId).eq('shop_id',shop.id).eq('technician_id',technician.id).maybeSingle();
        if(error)throw error;request=data;
        if(!request)return json(res,404,{error:'Inspection request not found'});
        if(request.status==='completed')return json(res,409,{error:'This inspection request is already completed'});
        if(request.status==='cancelled')return json(res,409,{error:'This inspection request was cancelled'});
      }else{
        const name=clean(req.body?.customer_name||req.body?.customerName,120),phone=clean(req.body?.phone,40),year=clean(req.body?.year,10),make=clean(req.body?.make,80),model=clean(req.body?.model,100);
        if(!name||!phone||!year||!make||!model)return json(res,400,{error:'Customer name, phone, year, make, and model are required'});
        customer=await upsertCustomer(supabase,{name,phone,email:req.body?.email,vehicle:[year,make,model].join(' '),mileage:req.body?.mileage},shop.id);
        vehicle=await upsertCustomerVehicle(supabase,{year,make,model,mileage:req.body?.mileage,vehicle_id:req.body?.vehicle_id},shop.id,customer.id);
      }
      const vehicleText=request?.vehicle||[clean(req.body?.year,10),clean(req.body?.make,80),clean(req.body?.model,100)].filter(Boolean).join(' '),mileage=clean(req.body?.mileage,50)||request?.mileage||vehicle?.mileage||null;
      const row=addLegacyFields(withShopId({customer_id:request?.customer_id||customer?.id||null,vehicle_id:request?.vehicle_id||vehicle?.id||clean(req.body?.vehicle_id,80)||null,customer_name:request?.customer_name||clean(req.body?.customer_name||req.body?.customerName,120),phone:request?.phone||clean(req.body?.phone,40)||null,email:request?.email||clean(req.body?.email,200)||null,vehicle:vehicleText,mileage,technician:technician.name,technician_id:technician.id,inspection_request_id:request?.id||null,overall_status:status(req.body?.overall_status||req.body?.overallStatus),recommendations:clean(req.body?.recommendations,5000)||null,inspection_items:items},shop),items);
      const {data:inspection,error}=await supabase.from('inspections').insert(row).select('*').single();
      if(error){if(String(error.code)==='23505')return json(res,409,{error:'This request already has an inspection report'});throw error;}
      const now=new Date().toISOString();
      if(request){const {error:updateError}=await supabase.from('inspection_requests').update({status:'completed',completed_at:now,updated_at:now,inspection_id:inspection.id,mileage}).eq('id',request.id).eq('shop_id',shop.id);if(updateError)throw updateError;}
      if(row.vehicle_id&&mileage)await supabase.from('customer_vehicles').update({mileage,last_seen_at:now,updated_at:now}).eq('id',row.vehicle_id).eq('shop_id',shop.id).then(()=>{}).catch(()=>{});
      await auditEvent(supabase,shop.id,'inspection.completed','inspection',inspection.id,{request_id:request?.id||null,technician_id:technician.id,customer:row.customer_name,vehicle:row.vehicle,block_count:items.length},`technician:${technician.id}`);
      return json(res,201,{status:'success',inspectionId:inspection.id,inspection});
    }

    if(req.method==='PATCH'&&action==='inspection'){
      const id=clean(req.body?.id,80),items=normalizeItems(req.body?.inspection_items||req.body?.inspectionItems);
      if(!id)return json(res,400,{error:'Missing inspection id'});if(!items.length)return json(res,400,{error:'Add at least one inspection block'});
      const {data:existing,error:findError}=await supabase.from('inspections').select('id,technician_id,technician,vehicle_id').eq('id',id).eq('shop_id',shop.id).maybeSingle();
      if(findError)throw findError;if(!existing)return json(res,404,{error:'Inspection not found'});
      const ownsInspection=existing.technician_id===technician.id||(!existing.technician_id&&clean(existing.technician,120).toLowerCase()===technician.name.toLowerCase());
      if(!ownsInspection)return json(res,403,{error:'You can only edit inspections assigned to your technician account'});
      const patch=addLegacyFields({customer_name:clean(req.body?.customer_name||req.body?.customerName,120),phone:clean(req.body?.phone,40)||null,email:clean(req.body?.email,200)||null,vehicle:clean(req.body?.vehicle,300),mileage:clean(req.body?.mileage,50)||null,technician:technician.name,overall_status:status(req.body?.overall_status||req.body?.overallStatus),recommendations:clean(req.body?.recommendations,5000)||null,inspection_items:items},items);
      if(!patch.customer_name||!patch.vehicle)return json(res,400,{error:'Customer and vehicle are required'});
      let update=supabase.from('inspections').update({...patch,technician_id:technician.id}).eq('id',id).eq('shop_id',shop.id);if(existing.technician_id)update=update.eq('technician_id',technician.id);else update=update.is('technician_id',null);
      const {data,error}=await update.select('*').single();if(error)throw error;
      if(existing.vehicle_id&&patch.mileage)await supabase.from('customer_vehicles').update({mileage:patch.mileage,updated_at:new Date().toISOString()}).eq('id',existing.vehicle_id).eq('shop_id',shop.id).then(()=>{}).catch(()=>{});
      await auditEvent(supabase,shop.id,'inspection.updated','inspection',data.id,{technician_id:technician.id,block_count:items.length},`technician:${technician.id}`);
      return json(res,200,{status:'success',inspection:data,inspectionId:data.id});
    }

    return json(res,400,{error:'Unsupported action'});
  }catch(error){
    console.error(error);
    return json(res,500,{error:error.message||'Technician operation failed'});
  }
};
