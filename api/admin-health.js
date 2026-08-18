const {verifyForShop}=require('./_auth');
const {db}=require('./_db');
const {resolveShop,applyShopScope}=require('./_tenant');

async function countRows(supabase,table,shop){
  let query=supabase.from(table).select('*',{count:'exact',head:true});
  query=applyShopScope(query,shop);
  const {count,error}=await query;
  if(error)throw error;
  return count||0;
}

module.exports=async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({status:'error',error:'Method not allowed'});
  const supabase=db();
  try{
    const shop=await resolveShop(req,supabase);
    if(!verifyForShop(req,shop))return res.status(401).json({status:'error',error:'Unauthorized'});
    const [appointments,customers,inspections,messages]=await Promise.all([
      countRows(supabase,'appointments',shop),
      countRows(supabase,'customers',shop),
      countRows(supabase,'inspections',shop),
      countRows(supabase,'sms_messages',shop)
    ]);
    return res.status(200).json({
      status:'ok',
      shop:{id:shop.id,slug:shop.slug,name:shop.name,timezone:shop.timezone},
      counts:{appointments,customers,inspections,messages},
      integrations:{
        resend:Boolean(process.env.RESEND_API_KEY && (shop.resend_from_email||process.env.RESEND_FROM_EMAIL)),
        twilio:Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && (shop.twilio_phone_number||process.env.TWILIO_PHONE_NUMBER)),
        push:Boolean(process.env.VAPID_SUBJECT && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
      }
    });
  }catch(err){
    console.error(err);
    return res.status(500).json({status:'error',error:err.message||'Health check failed'});
  }
};
