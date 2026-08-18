const twilio=require('twilio');
const {verify}=require('./_auth');
const {db,normalizePhone}=require('./_db');
module.exports=async function handler(req,res){
  if(!verify(req)) return res.status(401).json({success:false,error:'Unauthorized'});
  if(req.method!=='POST') return res.status(405).json({success:false,error:'Method not allowed'});
  try{
    if(!process.env.TWILIO_ACCOUNT_SID||!process.env.TWILIO_AUTH_TOKEN||!process.env.TWILIO_PHONE_NUMBER) return res.status(503).json({success:false,error:'Twilio is not configured'});
    const to=String(req.body?.to||'').trim(),message=String(req.body?.message||'').trim(),name=String(req.body?.name||'').trim();
    if(!to||!message)return res.status(400).json({success:false,error:'Phone and message are required'});
    const client=twilio(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN);
    const result=await client.messages.create({body:message,from:process.env.TWILIO_PHONE_NUMBER,to});
    await db().from('sms_messages').insert({direction:'outgoing',customer_name:name||null,phone:normalizePhone(to)||to,message,provider_sid:result.sid,status:result.status||'sent'});
    return res.status(200).json({success:true,sid:result.sid});
  }catch(err){console.error(err);return res.status(500).json({success:false,error:err.message});}
};
