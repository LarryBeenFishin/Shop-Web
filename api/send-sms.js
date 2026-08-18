const twilio=require('twilio');
const {verifyForShop}=require('./_auth');
const {db,normalizePhone,auditEvent}=require('./_db');
const {resolveShop,withShopId}=require('./_tenant');

module.exports=async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({success:false,error:'Method not allowed'});
  const supabase=db();
  try{
    const shop=await resolveShop(req,supabase);
    if(!verifyForShop(req,shop)) return res.status(401).json({success:false,error:'Unauthorized'});

    const accountSid=process.env.TWILIO_ACCOUNT_SID;
    const authToken=process.env.TWILIO_AUTH_TOKEN;
    const from=shop.twilio_phone_number||process.env.TWILIO_PHONE_NUMBER;
    if(!accountSid||!authToken||!from) return res.status(503).json({success:false,error:'Twilio is not configured for this shop'});

    const to=String(req.body?.to||'').trim();
    const message=String(req.body?.message||'').trim().slice(0,1600);
    const name=String(req.body?.name||'').trim().slice(0,120);
    if(!to||!message)return res.status(400).json({success:false,error:'Phone and message are required'});

    const client=twilio(accountSid,authToken);
    const result=await client.messages.create({body:message,from,to});
    const row=withShopId({
      direction:'outgoing',
      customer_name:name||null,
      phone:normalizePhone(to)||to,
      message,
      provider_sid:result.sid,
      status:result.status||'sent'
    },shop);
    await supabase.from('sms_messages').insert(row);
    await auditEvent(supabase,shop.id,'sms.sent','sms',result.sid,{to:normalizePhone(to)||to,status:result.status||'sent'});
    return res.status(200).json({success:true,sid:result.sid});
  }catch(err){
    console.error(err);
    return res.status(500).json({success:false,error:err.message});
  }
};
