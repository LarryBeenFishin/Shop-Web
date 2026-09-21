const { db, auditEvent } = require('./_db');
const { resolveShop } = require('./_tenant');

function clean(value,max=120){return String(value??'').trim().slice(0,max)}
function json(res,code,data){return res.status(code).json(data)}

module.exports=async function handler(req,res){
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  const role=clean(req.body?.role,30).toLowerCase(),username=clean(req.body?.username,40).toLowerCase();
  if(!['owner','technician'].includes(role))return json(res,400,{error:'Choose an account type'});
  if(!username)return json(res,400,{error:'Username is required'});
  const response={status:'success',message:'If that account exists, a password reset request has been sent.'};
  try{
    const supabase=db(),shop=await resolveShop(req,supabase);
    if(!shop.id)return json(res,200,response);
    if(role==='technician'){
      const {data,error}=await supabase.from('technician_accounts').select('id,name,username').eq('shop_id',shop.id).eq('username',username).eq('active',true).maybeSingle();
      if(error)throw error;
      if(data)await auditEvent(supabase,shop.id,'technician.password_reset.requested','technician',data.id,{name:data.name,username:data.username},'password-reset');
      return json(res,200,response);
    }
    const {data,error}=await supabase.from('shop_admin_accounts').select('id,name,username').eq('shop_id',shop.id).eq('username',username).eq('active',true).maybeSingle();
    if(error)throw error;
    if(data){
      const {error:auditError}=await supabase.from('platform_audit_events').insert({shop_id:shop.id,action:'admin.password_reset.requested',metadata:{name:data.name,username:data.username}});
      if(auditError)throw auditError;
    }
    return json(res,200,response);
  }catch(error){
    console.error('Password reset request failed:',error);
    return json(res,200,response);
  }
};
