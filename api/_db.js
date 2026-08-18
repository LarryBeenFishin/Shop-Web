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

async function upsertCustomer(supabase, input={}){
  const name=String(input.name||input.customerName||'').trim();
  const phone=String(input.phone||'').trim();
  if(!name || !phone) return null;
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
  if(normalized_phone){
    const {data:found}=await supabase.from('customers').select('*').eq('normalized_phone',normalized_phone).maybeSingle();
    if(found){
      const merged={...row};
      ['email','vehicle','last_service','mileage','notes'].forEach(k=>{ if(!merged[k]) delete merged[k]; });
      const {data,error}=await supabase.from('customers').update(merged).eq('id',found.id).select('*').single();
      if(error) throw error;
      return data;
    }
  }
  const {data,error}=await supabase.from('customers').insert(row).select('*').single();
  if(error) throw error;
  return data;
}

module.exports={db,normalizePhone,upsertCustomer};
