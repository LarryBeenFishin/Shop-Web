const {verify}=require('./_auth');
const {db}=require('./_db');
module.exports=async function handler(req,res){
  if(!verify(req))return res.status(401).json({success:false,error:'Unauthorized'});
  if(req.method==='GET') return res.status(200).json({success:true,publicKey:process.env.VAPID_PUBLIC_KEY||''});
  if(req.method!=='POST')return res.status(405).json({success:false,error:'Method not allowed'});
  const subscription=req.body?.subscription;if(!subscription?.endpoint)return res.status(400).json({success:false,error:'Missing subscription'});
  try{const {error}=await db().from('push_subscriptions').upsert({endpoint:subscription.endpoint,subscription},{onConflict:'endpoint'});if(error)throw error;return res.status(200).json({success:true});}
  catch(err){console.error(err);return res.status(500).json({success:false,error:err.message});}
};
