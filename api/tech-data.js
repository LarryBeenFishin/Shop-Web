const { verifyTechForShop } = require('./_auth');
const { db, auditEvent } = require('./_db');
const { resolveShop, withShopId } = require('./_tenant');

const ITEM_STATUSES=new Set(['Good','Monitor','Needs Attention']);
function clean(v,n=3000){return String(v??'').trim().slice(0,n)}
function json(res,code,data){return res.status(code).json(data)}
function normalizeItems(value){return(Array.isArray(value)?value:[]).slice(0,50).map((item,index)=>({id:clean(item?.id,80)||`item-${index+1}`,title:clean(item?.title,120),status:ITEM_STATUSES.has(item?.status)?item.status:'Monitor',notes:clean(item?.notes,3000)})).filter(item=>item.title)}

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
      if(!requestId)return json(res,400,{error:'Missing inspection request'});
      if(!items.length)return json(res,400,{error:'Add at least one inspection block'});
      const {data:request,error:requestError}=await supabase.from('inspection_requests').select('*').eq('id',requestId).eq('shop_id',shop.id).eq('technician_id',technician.id).maybeSingle();
      if(requestError)throw requestError;
      if(!request)return json(res,404,{error:'Inspection request not found'});
      if(request.status==='completed')return json(res,409,{error:'This inspection request is already completed'});
      if(request.status==='cancelled')return json(res,409,{error:'This inspection request was cancelled'});
      const mileage=clean(req.body?.mileage,50)||request.mileage||null,overallStatus=ITEM_STATUSES.has(req.body?.overall_status||req.body?.overallStatus)?(req.body.overall_status||req.body.overallStatus):'Monitor';
      const row=withShopId({customer_id:request.customer_id||null,vehicle_id:request.vehicle_id||null,customer_name:request.customer_name,phone:request.phone||null,email:request.email||null,vehicle:request.vehicle,mileage,technician:technician.name,technician_id:technician.id,inspection_request_id:request.id,overall_status:overallStatus,recommendations:clean(req.body?.recommendations,5000)||null,inspection_items:items},shop);
      for(const key of ['brakes','tires','suspension','fluids','battery','lights','wipers','filters','leaks']){const match=items.find(item=>item.title.toLowerCase()===key);row[`${key}_status`]=match?.status||null;row[`${key}_notes`]=match?.notes||null;}
      const {data:inspection,error}=await supabase.from('inspections').insert(row).select('*').single();
      if(error){if(String(error.code)==='23505')return json(res,409,{error:'This request already has an inspection report'});throw error;}
      const now=new Date().toISOString();
      const {error:updateError}=await supabase.from('inspection_requests').update({status:'completed',completed_at:now,updated_at:now,inspection_id:inspection.id,mileage}).eq('id',request.id).eq('shop_id',shop.id);if(updateError)throw updateError;
      if(request.vehicle_id&&mileage)await supabase.from('customer_vehicles').update({mileage,last_seen_at:now,updated_at:now}).eq('id',request.vehicle_id).eq('shop_id',shop.id).then(()=>{}).catch(()=>{});
      await auditEvent(supabase,shop.id,'inspection.completed','inspection',inspection.id,{request_id:request.id,technician_id:technician.id,customer:request.customer_name,vehicle:request.vehicle,block_count:items.length},`technician:${technician.id}`);
      return json(res,201,{status:'success',inspectionId:inspection.id,inspection});
    }

    return json(res,400,{error:'Unsupported action'});
  }catch(error){
    console.error(error);
    return json(res,500,{error:error.message||'Technician operation failed'});
  }
};
