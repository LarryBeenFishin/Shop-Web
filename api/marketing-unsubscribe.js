const {db}=require('./_db');
const {readUnsubscribeToken}=require('./_marketing');

module.exports=async function handler(req,res){
  const parsed=readUnsubscribeToken(req.query?.token);
  res.setHeader('Content-Type','text/html; charset=utf-8');
  if(!parsed)return res.status(400).send('<h1>Invalid unsubscribe link</h1><p>This link is incomplete or no longer valid.</p>');
  try{
    const supabase=db();
    const {error}=await supabase.from('customers').update({email_marketing_opt_in:false,email_unsubscribed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',parsed.customerId).eq('shop_id',parsed.shopId);
    if(error)throw error;
    return res.status(200).send('<main style="font-family:Arial,sans-serif;max-width:560px;margin:80px auto;padding:24px"><h1>You’re unsubscribed</h1><p>You will no longer receive promotional emails from this shop. Appointment and service messages are not affected.</p></main>');
  }catch(error){console.error(error);return res.status(500).send('<h1>Could not unsubscribe</h1><p>Please try again later.</p>')}
};
