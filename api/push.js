const {verifyForShop}=require('./_auth');
const {db}=require('./_db');
const {resolveShop,withShopId}=require('./_tenant');
const {sendShopPush}=require('./_notifications');

module.exports=async function handler(req,res){
  const action=String(req.query?.action||'').toLowerCase();
  const supabase=db();
  try{
    const shop=await resolveShop(req,supabase);
    if(!verifyForShop(req,shop))return res.status(401).json({success:false,error:'Unauthorized'});

    if(action==='subscribe'){
      if(req.method==='GET') return res.status(200).json({success:true,publicKey:process.env.VAPID_PUBLIC_KEY||''});
      if(req.method!=='POST')return res.status(405).json({success:false,error:'Method not allowed'});
      const subscription=req.body?.subscription;
      if(!subscription?.endpoint)return res.status(400).json({success:false,error:'Missing subscription'});
      const row=withShopId({endpoint:subscription.endpoint,subscription},shop);
      const conflict=shop.id?'shop_id,endpoint':'endpoint';
      const {error}=await supabase.from('push_subscriptions').upsert(row,{onConflict:conflict});
      if(error)throw error;
      return res.status(200).json({success:true});
    }

    if(action==='send'){
      if(req.method!=='POST')return res.status(405).json({success:false,error:'Method not allowed'});
      if(!process.env.VAPID_SUBJECT||!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY)return res.status(503).json({success:false,error:'Push notifications are not configured'});
      const result=await sendShopPush(supabase,shop,{
        title:req.body?.title||shop.name||'Shop Admin',
        body:req.body?.body||'New notification',
        url:req.body?.url||'/admin',
        tag:req.body?.tag||undefined
      });
      return res.status(200).json({success:true,...result});
    }

    return res.status(400).json({success:false,error:'Invalid push action'});
  }catch(err){
    console.error(err);
    return res.status(500).json({success:false,error:err.message});
  }
};
