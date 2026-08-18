const twilio=require('twilio');
const {db,normalizePhone,auditEvent}=require('./_db');
const {resolveShopForIncomingSms,applyShopScope,withShopId}=require('./_tenant');
const {sendShopPush}=require('./_notifications');

function requestUrl(req){
  const proto=String(req.headers['x-forwarded-proto']||'https').split(',')[0].trim();
  const host=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim();
  return `${proto}://${host}${req.url}`;
}

module.exports=async function handler(req,res){
  if(req.method!=='POST') return res.status(405).send('Method not allowed');
  const supabase=db();
  try{
    const body=req.body||{};

    if(process.env.TWILIO_VALIDATE_WEBHOOKS==='true' && process.env.TWILIO_AUTH_TOKEN){
      const signature=String(req.headers['x-twilio-signature']||'');
      const valid=signature && twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN,signature,requestUrl(req),body);
      if(!valid) return res.status(403).send('Invalid Twilio signature');
    }

    const shop=await resolveShopForIncomingSms(req,body.To||body.to,supabase);
    const phone=normalizePhone(body.From||body.from)||String(body.From||body.from||'').trim();
    const message=String(body.Body||body.body||'').trim().slice(0,1600);
    if(phone&&message){
      let customerQuery=supabase.from('customers').select('name').eq('normalized_phone',normalizePhone(phone)).limit(1);
      customerQuery=applyShopScope(customerQuery,shop);
      const {data:customers}=await customerQuery;
      const customerName=customers?.[0]?.name||null;
      const row=withShopId({
        direction:'incoming',
        customer_name:customerName,
        phone,
        message,
        provider_sid:String(body.MessageSid||body.SmsSid||'')||null,
        status:String(body.SmsStatus||'received')
      },shop);
      await supabase.from('sms_messages').insert(row);
      await auditEvent(supabase,shop.id,'sms.received','sms',row.provider_sid,{from:phone});
      await sendShopPush(supabase,shop,{
        title:`New text — ${shop.name}`,
        body:`${customerName||phone}: ${message.slice(0,120)}`,
        url:'/admin',
        tag:`sms-${row.provider_sid||Date.now()}`
      }).catch(()=>{});
    }
    res.setHeader('Content-Type','text/xml');
    return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }catch(err){
    console.error(err);
    return res.status(500).send('');
  }
};
