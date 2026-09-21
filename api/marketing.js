const {verifyForShop}=require('./_auth');
const {db,auditEvent,normalizePhone}=require('./_db');
const {resolveShop}=require('./_tenant');
const {sendEmail,sendSms,esc,originFor}=require('./_communications');
const {unsubscribeToken}=require('./_marketing');

function s(value,max=3000){return String(value??'').trim().slice(0,max)}
function json(res,code,data){return res.status(code).json(data)}
async function settleLimited(items,limit,worker){
  const results=[];let cursor=0;
  async function run(){while(cursor<items.length){const item=items[cursor++];try{await worker(item);results.push(true)}catch(error){console.error('Campaign delivery failed:',error?.message||error);results.push(false)}}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},run));return results;
}

module.exports=async function handler(req,res){
  try{
    const supabase=db(),shop=await resolveShop(req,supabase),session=verifyForShop(req,shop);
    if(!session)return json(res,401,{error:'Unauthorized'});
    if(req.method==='GET'){
      const [{count:emailCount,error:emailError},{count:smsCount,error:smsError},{data:campaigns,error:campaignError}]=await Promise.all([
        supabase.from('customers').select('id',{count:'exact',head:true}).eq('shop_id',shop.id).eq('email_marketing_opt_in',true).not('email','is',null),
        supabase.from('customers').select('id',{count:'exact',head:true}).eq('shop_id',shop.id).eq('sms_marketing_opt_in',true).not('phone','is',null),
        supabase.from('marketing_campaigns').select('*').eq('shop_id',shop.id).order('created_at',{ascending:false}).limit(30)
      ]);
      if(emailError||smsError||campaignError)throw emailError||smsError||campaignError;
      return json(res,200,{status:'success',audience:{email:emailCount||0,sms:smsCount||0},campaigns:campaigns||[]});
    }
    if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
    const channels=Array.isArray(req.body?.channels)?req.body.channels.filter(x=>['email','sms'].includes(x)):[];
    const subject=s(req.body?.subject,180),message=s(req.body?.message,1500);
    if(!channels.length)return json(res,400,{error:'Choose email, text, or both'});
    if(!message)return json(res,400,{error:'Campaign message is required'});
    if(channels.includes('email')&&!subject)return json(res,400,{error:'Email campaigns need a subject'});
    const {data:customers,error:customerError}=await supabase.from('customers').select('id,name,email,phone,email_marketing_opt_in,sms_marketing_opt_in').eq('shop_id',shop.id).limit(5000);
    if(customerError)throw customerError;
    const emailCustomers=(customers||[]).filter(c=>c.email&&c.email_marketing_opt_in),smsCustomers=(customers||[]).filter(c=>c.phone&&c.sms_marketing_opt_in);
    if((channels.includes('email')&&emailCustomers.length>500)||(channels.includes('sms')&&smsCustomers.length>500))return json(res,400,{error:'Campaigns are currently limited to 500 recipients per channel'});
    const row={shop_id:shop.id,subject:subject||null,message,channels,email_recipients:channels.includes('email')?emailCustomers.length:0,sms_recipients:channels.includes('sms')?smsCustomers.length:0,status:'sending'};
    const {data:campaign,error:campaignError}=await supabase.from('marketing_campaigns').insert(row).select('*').single();if(campaignError)throw campaignError;
    let emailResults=[],smsResults=[];
    if(channels.includes('email'))emailResults=await settleLimited(emailCustomers,5,async customer=>{
      const token=unsubscribeToken(shop.id,customer.id),url=`${originFor(req)}/api/marketing-unsubscribe?token=${encodeURIComponent(token)}`;
      await sendEmail(shop,{to:[customer.email],subject,replyTo:shop.notification_email||undefined,html:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033"><p>Hi ${esc(customer.name||'there')},</p><div style="white-space:pre-wrap;line-height:1.6">${esc(message)}</div><p style="margin-top:28px">— ${esc(shop.name)}</p><hr style="border:0;border-top:1px solid #e2e8f0;margin:28px 0"><p style="font-size:12px;color:#64748b">You received this because you opted in to email offers from ${esc(shop.name)}. <a href="${esc(url)}">Unsubscribe</a>.</p></div>`});
    });
    if(channels.includes('sms'))smsResults=await settleLimited(smsCustomers,4,async customer=>{const body=`${shop.name}: ${message}\nReply STOP to opt out.`,result=await sendSms(shop,{to:normalizePhone(customer.phone),body});await supabase.from('sms_messages').insert({shop_id:shop.id,direction:'outgoing',customer_name:customer.name||null,phone:customer.phone,message:body,provider_sid:result?.sid||null,status:result?.status||'queued'})});
    const emailSent=emailResults.filter(Boolean).length,smsSent=smsResults.filter(Boolean).length,failed=emailResults.filter(x=>!x).length+smsResults.filter(x=>!x).length;
    const status=failed===0?'sent':(emailSent+smsSent?'partial':'failed'),sentAt=new Date().toISOString();
    const {data:updated,error:updateError}=await supabase.from('marketing_campaigns').update({email_sent:emailSent,sms_sent:smsSent,failed,status,sent_at:sentAt}).eq('id',campaign.id).eq('shop_id',shop.id).select('*').single();if(updateError)throw updateError;
    await auditEvent(supabase,shop.id,'marketing.campaign.sent','marketing_campaign',campaign.id,{channels,email_sent:emailSent,sms_sent:smsSent,failed},`admin:${session.adminId||'shop'}`);
    return json(res,201,{status:'success',campaign:updated});
  }catch(error){console.error('Marketing error:',error);return json(res,500,{error:error.message||'Campaign failed'})}
};
