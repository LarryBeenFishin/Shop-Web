const { createClient } = require('@supabase/supabase-js');

function db(){
  if(!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY){
    throw new Error('Supabase environment variables are not configured');
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth:{persistSession:false, autoRefreshToken:false}
  });
}

function normalizePhone(v){
  const digits=String(v||'').replace(/\D/g,'');
  if(digits.length===11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

async function upsertCustomer(supabase, input={}, shopId=null){
  const name=String(input.name||input.customerName||input.customer_name||'').trim();
  const phone=String(input.phone||'').trim();
  if(!name || !phone) return null;
  const tenantId=shopId || input.shop_id || null;
  const normalized_phone=normalizePhone(phone);
  const row={
    name,
    phone,
    normalized_phone: normalized_phone || null,
    email:String(input.email||'').trim() || null,
    vehicle:String(input.vehicle||'').trim() || null,
    last_service:String(input.last_service||input.service||'').trim() || null,
    mileage:String(input.mileage||'').trim() || null,
    notes:String(input.notes||'').trim() || null,
    updated_at:new Date().toISOString()
  };
  if(tenantId) row.shop_id=tenantId;

  if(normalized_phone){
    let query=supabase.from('customers').select('*').eq('normalized_phone',normalized_phone);
    if(tenantId) query=query.eq('shop_id',tenantId);
    const {data:found,error:findError}=await query.maybeSingle();
    if(findError) throw findError;
    if(found){
      const merged={...row};
      delete merged.shop_id;
      ['email','vehicle','last_service','mileage','notes'].forEach(k=>{ if(!merged[k]) delete merged[k]; });
      let update=supabase.from('customers').update(merged).eq('id',found.id);
      if(tenantId) update=update.eq('shop_id',tenantId);
      const {data,error}=await update.select('*').single();
      if(error) throw error;
      return data;
    }
  }

  const {data,error}=await supabase.from('customers').insert(row).select('*').single();
  if(error) throw error;
  return data;
}

async function auditEvent(supabase, shopId, action, entityType, entityId, metadata={}, actor='admin'){
  if(!shopId) return;
  try{
    await supabase.from('audit_events').insert({
      shop_id:shopId,
      actor:String(actor||'system').slice(0,80),
      action:String(action||'').slice(0,120),
      entity_type:entityType ? String(entityType).slice(0,80) : null,
      entity_id:entityId ? String(entityId).slice(0,160) : null,
      metadata:metadata && typeof metadata==='object' ? metadata : {}
    });
  }catch(err){
    // Audit logging should never break an appointment/customer operation.
    console.error('Audit log error:',err?.message||err);
  }
}

module.exports={db,normalizePhone,upsertCustomer,auditEvent};
