const webpush=require('web-push');
const {verify}=require('./_auth');
const {db}=require('./_db');
module.exports=async function handler(req,res){
  if(!verify(req))return res.status(401).json({success:false,error:'Unauthorized'});
  if(req.method!=='POST')return res.status(405).json({success:false,error:'Method not allowed'});
  if(!process.env.VAPID_SUBJECT||!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY)return res.status(503).json({success:false,error:'Push notifications are not configured'});
  try{
    webpush.setVapidDetails(process.env.VAPID_SUBJECT,process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
    const {data,error}=await db().from('push_subscriptions').select('*');if(error)throw error;
    const payload=JSON.stringify({title:req.body?.title||process.env.SHOP_NAME||'Shop Admin',body:req.body?.body||'New notification',url:req.body?.url||'/admin',tag:req.body?.tag||undefined});
    const results=await Promise.allSettled((data||[]).map(x=>webpush.sendNotification(x.subscription,payload)));
    return res.status(200).json({success:true,sent:results.filter(r=>r.status==='fulfilled').length,failed:results.filter(r=>r.status==='rejected').length});
  }catch(err){console.error(err);return res.status(500).json({success:false,error:err.message});}
};
