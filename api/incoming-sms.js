const {db,normalizePhone}=require('./_db');
module.exports=async function handler(req,res){
  if(req.method!=='POST') return res.status(405).send('Method not allowed');
  try{
    const body=req.body||{};
    const phone=normalizePhone(body.From||body.from)||String(body.From||body.from||'').trim();
    const message=String(body.Body||body.body||'').trim();
    if(phone&&message){await db().from('sms_messages').insert({direction:'incoming',phone,message,provider_sid:String(body.MessageSid||body.SmsSid||'')||null,status:String(body.SmsStatus||'received')});}
    res.setHeader('Content-Type','text/xml');
    return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }catch(err){console.error(err);return res.status(500).send('');}
};
