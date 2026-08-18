const {verifyForShop}=require('./_auth');
const {db}=require('./_db');
const {resolveShop}=require('./_tenant');
const {sendShopPush}=require('./_notifications');

module.exports=async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({success:false,error:'Method not allowed'});
  const supabase=db();
  try{
    const shop=await resolveShop(req,supabase);
    if(!verifyForShop(req,shop))return res.status(401).json({success:false,error:'Unauthorized'});
    if(!process.env.VAPID_SUBJECT||!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY)return res.status(503).json({success:false,error:'Push notifications are not configured'});
    const result=await sendShopPush(supabase,shop,{
      title:req.body?.title||shop.name||'Shop Admin',
      body:req.body?.body||'New notification',
      url:req.body?.url||'/admin',
      tag:req.body?.tag||undefined
    });
    return res.status(200).json({success:true,...result});
  }catch(err){
    console.error(err);
    return res.status(500).json({success:false,error:err.message});
  }
};
