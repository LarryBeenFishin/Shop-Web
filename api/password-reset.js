const crypto=require('crypto');
const {db}=require('./_db');
const {hashPassword}=require('./_auth');

function clean(value,max=200){return String(value??'').trim().slice(0,max)}
function json(res,code,data){return res.status(code).json(data)}

module.exports=async function handler(req,res){
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  const token=clean(req.body?.token,200),password=String(req.body?.password||'');
  if(!token)return json(res,400,{error:'Reset link is missing'});
  if(password.length<8)return json(res,400,{error:'Password must be at least 8 characters'});
  try{
    const supabase=db(),tokenHash=crypto.createHash('sha256').update(token).digest('hex'),now=new Date().toISOString();
    const {data:record,error}=await supabase.from('password_reset_tokens').select('*').eq('token_hash',tokenHash).is('used_at',null).gt('expires_at',now).maybeSingle();
    if(error)throw error;
    if(!record)return json(res,400,{error:'This reset link is invalid or has expired'});
    const table=record.account_role==='technician'?'technician_accounts':'shop_admin_accounts';
    const {data:account,error:accountError}=await supabase.from(table).select('id,active').eq('id',record.account_id).eq('shop_id',record.shop_id).maybeSingle();
    if(accountError)throw accountError;
    if(!account?.active)return json(res,400,{error:'This account is no longer active'});
    const usedAt=new Date().toISOString();
    const {data:claimed,error:claimError}=await supabase.from('password_reset_tokens').update({used_at:usedAt}).eq('id',record.id).is('used_at',null).select('id').maybeSingle();
    if(claimError)throw claimError;
    if(!claimed)return json(res,400,{error:'This reset link has already been used'});
    const {error:updateError}=await supabase.from(table).update({password_hash:hashPassword(password),updated_at:usedAt}).eq('id',account.id).eq('shop_id',record.shop_id);
    if(updateError)throw updateError;
    return json(res,200,{status:'success',role:record.account_role});
  }catch(error){console.error('Password reset failed:',error);return json(res,500,{error:'Could not reset password'})}
};
