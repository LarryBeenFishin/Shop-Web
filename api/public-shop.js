const { db } = require('./_db');
const { resolveShop } = require('./_tenant');

module.exports=async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({status:'error',message:'Method not allowed'});
  const supabase=db();
  try{
    const shop=await resolveShop(req,supabase);
    let name=shop.name;
    if(shop.id){
      const {data,error}=await supabase.from('shops').select('name').eq('id',shop.id).maybeSingle();
      if(error)throw error;
      if(data?.name)name=data.name;
    }
    res.setHeader('Cache-Control','no-store');
    return res.status(200).json({status:'success',shop:{name,slug:shop.slug}});
  }catch(error){
    console.error(error);
    return res.status(500).json({status:'error',message:'Unable to load shop'});
  }
};
