const { verifyForShop } = require('./_auth');
const { db, upsertCustomer, upsertCustomerVehicle, auditEvent } = require('./_db');
const { resolveShop, withShopId } = require('./_tenant');

function clean(v,n=3000){return String(v??'').trim().slice(0,n)}
function json(res,code,data){return res.status(code).json(data)}
const ITEM_STATUSES=new Set(['Good','Monitor','Needs Attention']);
function derivedStatus(items){return items.some(item=>item.status==='Needs Attention')?'Needs Attention':items.some(item=>item.status==='Monitor')?'Monitor':'Good'}

function normalizeItems(value){
  if(!Array.isArray(value))return [];
  return value.slice(0,50).map((item,index)=>({
    id:clean(item?.id,80)||`item-${index+1}`,
    title:clean(item?.title,120),
    status:ITEM_STATUSES.has(item?.status)?item.status:'Monitor',
    notes:clean(item?.notes,3000)
  })).filter(item=>item.title);
}

module.exports=async function handler(req,res){
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  const supabase=db();
  try{
    const shop=await resolveShop(req,supabase);
    if(!verifyForShop(req,shop))return json(res,401,{error:'Unauthorized'});

    const b=req.body||{};
    const suppliedCustomerName=clean(b.customerName||b.customer_name,120);
    const customerName=suppliedCustomerName||'Customer not provided';
    const phone=clean(b.phone,40);
    const email=clean(b.email,200)||null;
    const year=clean(b.year,10);
    const make=clean(b.make,80);
    const model=clean(b.model,100);
    const mileage=clean(b.mileage,50)||null;
    const technician=clean(b.technician,120)||null;
    const recommendations=clean(b.recommendations,5000)||null;
    const items=normalizeItems(b.inspectionItems||b.inspection_items);

    if(!items.length)return json(res,400,{error:'Add at least one inspection block'});

    const vehicleText=[year,make,model].filter(Boolean).join(' ')||'Vehicle not provided';
    const customer=suppliedCustomerName&&phone?await upsertCustomer(supabase,{
      name:suppliedCustomerName,phone,email,vehicle:vehicleText==='Vehicle not provided'?null:vehicleText,mileage
    },shop.id):null;

    const savedVehicle=customer?.id&&year&&make&&model?await upsertCustomerVehicle(supabase,{
      vehicle_id:clean(b.vehicle_id,80)||null,
      year,make,model,mileage
    },shop.id,customer.id):null;

    const row=withShopId({
      customer_id:customer?.id||null,
      vehicle_id:savedVehicle?.id||null,
      customer_name:customerName,
      phone,
      email,
      vehicle:vehicleText,
      mileage,
      technician,
      overall_status:derivedStatus(items),
      recommendations,
      inspection_items:items
    },shop);

    // Keep legacy columns populated when a matching custom block exists so old
    // admin/history code remains compatible while the app transitions to JSON blocks.
    const legacy=['brakes','tires','suspension','fluids','battery','lights','wipers','filters','leaks'];
    for(const key of legacy){
      const match=items.find(item=>item.title.toLowerCase()===key);
      row[`${key}_status`]=match?.status||null;
      row[`${key}_notes`]=match?.notes||null;
    }

    const {data,error}=await supabase.from('inspections').insert(row).select('*').single();
    if(error)throw error;

    await auditEvent(supabase,shop.id,'inspection.created','inspection',data.id,{
      customer_id:customer?.id||null,
      vehicle_id:savedVehicle?.id||null,
      customer:customerName,
      vehicle:vehicleText,
      block_count:items.length
    });

    return json(res,201,{status:'success',inspectionId:data.id,inspection:data});
  }catch(err){
    console.error(err);
    return json(res,500,{error:err.message||'Could not create inspection'});
  }
};
