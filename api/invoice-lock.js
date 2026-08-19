const { verifyForShop } = require('./_auth');
const { db, missingTable } = require('./_db');
const { resolveShop, applyShopScope } = require('./_tenant');

function json(res,code,data){return res.status(code).json(data)}
function s(v,n=300){return String(v??'').trim().slice(0,n)}
function isLockSetupMissing(error){
  if(!error)return false;
  const code=String(error.code||'');
  const msg=String(error.message||error.details||'').toLowerCase();
  return missingTable(error,'invoice_edit_locks') || code==='PGRST202' || code==='42883' || msg.includes('acquire_invoice_edit_lock') || msg.includes('invoice_edit_locks');
}

module.exports=async function handler(req,res){
  const supabase=db();let shop;
  try{shop=await resolveShop(req,supabase)}catch(err){console.error(err);return json(res,500,{error:err.message||'Unable to resolve shop'})}
  if(!verifyForShop(req,shop))return json(res,401,{error:'Unauthorized'});
  if(!shop.id)return json(res,200,{status:'disabled',locking:false});

  const body=req.body||{},invoiceId=s(body.invoiceId||body.invoice_id,80),token=s(body.token,160),clientId=s(body.clientId||body.client_id,160),lockedBy=s(body.lockedBy||body.locked_by,160)||'Another admin session';
  if(!invoiceId)return json(res,400,{error:'Missing invoice id'});

  try{
    let iq=supabase.from('invoice_documents').select('id,status').eq('id',invoiceId);iq=applyShopScope(iq,shop);
    const {data:invoice,error:invoiceError}=await iq.maybeSingle();
    if(invoiceError)throw invoiceError;if(!invoice)return json(res,404,{error:'Invoice not found'});

    if(req.method==='POST'){
      const action=s(body.action||'acquire',30);
      if(!token)return json(res,400,{error:'Missing lock token'});
      if(action==='acquire'){
        const {data,error}=await supabase.rpc('acquire_invoice_edit_lock',{p_shop_id:shop.id,p_invoice_id:invoiceId,p_lock_token:token,p_client_id:clientId||null,p_locked_by:lockedBy,p_ttl_seconds:90});
        if(error){if(isLockSetupMissing(error))return json(res,200,{status:'disabled',locking:false});throw error}
        const row=Array.isArray(data)?data[0]:data;
        if(row)return json(res,200,{status:'success',locking:true,acquired:true,lock:row});
        const {data:current,error:currentError}=await supabase.from('invoice_edit_locks').select('*').eq('shop_id',shop.id).eq('invoice_id',invoiceId).maybeSingle();
        if(currentError){if(isLockSetupMissing(currentError))return json(res,200,{status:'disabled',locking:false});throw currentError}
        return json(res,409,{status:'locked',locking:true,locked:true,lockedBy:current?.locked_by||'Another admin session',expiresAt:current?.expires_at||null});
      }
      if(action==='heartbeat'){
        const expiresAt=new Date(Date.now()+90000).toISOString();
        const {data,error}=await supabase.from('invoice_edit_locks').update({expires_at:expiresAt,updated_at:new Date().toISOString(),client_id:clientId||null}).eq('shop_id',shop.id).eq('invoice_id',invoiceId).eq('lock_token',token).select('*').maybeSingle();
        if(error){if(isLockSetupMissing(error))return json(res,200,{status:'disabled',locking:false});throw error}
        if(!data){
          const {data:current}=await supabase.from('invoice_edit_locks').select('locked_by,expires_at').eq('shop_id',shop.id).eq('invoice_id',invoiceId).maybeSingle();
          return json(res,409,{status:'lost',locking:true,locked:true,lockedBy:current?.locked_by||'Another admin session',expiresAt:current?.expires_at||null});
        }
        return json(res,200,{status:'success',locking:true,lock:data});
      }
      return json(res,400,{error:'Unknown lock action'});
    }

    if(req.method==='DELETE'){
      if(!token)return json(res,400,{error:'Missing lock token'});
      const {error}=await supabase.from('invoice_edit_locks').delete().eq('shop_id',shop.id).eq('invoice_id',invoiceId).eq('lock_token',token);
      if(error){if(isLockSetupMissing(error))return json(res,200,{status:'disabled',locking:false});throw error}
      return json(res,200,{status:'success',locking:true,released:true});
    }

    if(req.method==='GET'){
      const {data,error}=await supabase.from('invoice_edit_locks').select('*').eq('shop_id',shop.id).eq('invoice_id',invoiceId).maybeSingle();
      if(error){if(isLockSetupMissing(error))return json(res,200,{status:'disabled',locking:false});throw error}
      if(!data||new Date(data.expires_at).getTime()<=Date.now())return json(res,200,{status:'success',locking:true,locked:false});
      return json(res,200,{status:'success',locking:true,locked:true,lockedBy:data.locked_by,expiresAt:data.expires_at});
    }

    return json(res,405,{error:'Method not allowed'});
  }catch(err){console.error('[invoice-lock]',err);return json(res,500,{error:err.message||'Invoice lock failed'})}
};
