const { db } = require('./_db');
const { resolveShop, applyShopScope } = require('./_tenant');

module.exports=async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({status:'error',message:'Method not allowed'});
  const id=String(req.query.id||'').trim();
  if(!id)return res.status(400).json({status:'error',message:'Missing inspection id'});
  const supabase=db();
  try{
    const shop=await resolveShop(req,supabase);
    let query=supabase.from('inspections').select('*').eq('id',id);
    query=applyShopScope(query,shop);
    const {data,error}=await query.maybeSingle();
    if(error)throw error;
    if(!data)return res.status(404).json({status:'error',message:'Inspection not found'});
    const out={...data,inspectionId:data.id,createdAt:data.created_at,customerName:data.customer_name,overallStatus:data.overall_status,recommendations:data.recommendations};
    delete out.shop_id;
    for(const key of ['brakes','tires','suspension','fluids','battery','lights','wipers','filters','leaks']){
      out[`${key}Status`]=data[`${key}_status`];
      out[`${key}Notes`]=data[`${key}_notes`];
    }
    return res.status(200).json({status:'success',inspection:out,shop:{name:shop.name,slug:shop.slug}});
  }catch(err){
    console.error(err);
    return res.status(500).json({status:'error',message:'Unable to load inspection'});
  }
};
