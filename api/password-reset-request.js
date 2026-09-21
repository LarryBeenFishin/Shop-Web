const crypto = require('crypto');
const { db, auditEvent } = require('./_db');
const { resolveShop } = require('./_tenant');
const { originFor, sendEmail, resetEmailHtml } = require('./_communications');

function clean(value,max=120){return String(value??'').trim().slice(0,max)}
function json(res,code,data){return res.status(code).json(data)}

module.exports=async function handler(req,res){
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  const role=clean(req.body?.role,30).toLowerCase(),username=clean(req.body?.username,40).toLowerCase();
  if(!['owner','technician'].includes(role))return json(res,400,{error:'Choose an account type'});
  if(!username)return json(res,400,{error:'Username is required'});
  const response={status:'success',message:'If that account has a recovery email, a reset link has been sent.'};
  try{
    const supabase=db(),shop=await resolveShop(req,supabase);
    if(!shop.id)return json(res,200,response);
    const table=role==='technician'?'technician_accounts':'shop_admin_accounts';
    const {data,error}=await supabase.from(table).select('id,name,username,email').eq('shop_id',shop.id).eq('username',username).eq('active',true).maybeSingle();
    if(error)throw error;
    if(!data?.email)return json(res,200,response);
    const rawToken=crypto.randomBytes(32).toString('base64url');
    const tokenHash=crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt=new Date(Date.now()+20*60*1000).toISOString();
    await supabase.from('password_reset_tokens').update({used_at:new Date().toISOString()}).eq('shop_id',shop.id).eq('account_role',role).eq('account_id',data.id).is('used_at',null);
    const {error:tokenError}=await supabase.from('password_reset_tokens').insert({shop_id:shop.id,account_role:role,account_id:data.id,token_hash:tokenHash,expires_at:expiresAt});
    if(tokenError)throw tokenError;
    const url=`${originFor(req)}/reset-password?token=${encodeURIComponent(rawToken)}`;
    await sendEmail(shop,{to:[data.email],subject:`Reset your ${shop.name} password`,html:resetEmailHtml({name:data.name,shopName:shop.name,url})});
    if(role==='technician')await auditEvent(supabase,shop.id,'technician.password_reset.emailed','technician',data.id,{username:data.username},'password-reset');
    else await supabase.from('platform_audit_events').insert({shop_id:shop.id,action:'admin.password_reset.emailed',metadata:{username:data.username}});
    return json(res,200,response);
  }catch(error){
    console.error('Password reset request failed:',error);
    return json(res,200,response);
  }
};
