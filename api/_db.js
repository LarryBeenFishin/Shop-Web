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

function missingTable(error, table){
  const code=String(error?.code||'');
  const msg=String(error?.message||'').toLowerCase();
  return code==='42P01' || code==='PGRST205' || msg.includes(`public.${String(table).toLowerCase()}`) || msg.includes(`relation "public.${String(table).toLowerCase()}" does not exist`);
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

async function upsertCustomerVehicle(supabase,input={},shopId=null,customerId=null){
  const tenantId=shopId||input.shop_id||null;
  const ownerId=customerId||input.customer_id||null;
  const year=String(input.year||'').trim();
  const make=String(input.make||'').trim();
  const model=String(input.model||'').trim();
  if(!ownerId || !year || !make || !model) return null;

  const now=new Date().toISOString();
  const base={
    customer_id:ownerId,
    year:year.slice(0,10),
    make:make.slice(0,80),
    model:model.slice(0,100),
    vin:String(input.vin||'').trim().slice(0,40)||null,
    plate:String(input.plate||'').trim().slice(0,40)||null,
    mileage:String(input.mileage||'').trim().slice(0,50)||null,
    nickname:String(input.nickname||'').trim().slice(0,80)||null,
    last_service:String(input.last_service||input.service||'').trim().slice(0,120)||null,
    last_seen_at:now,
    updated_at:now
  };
  if(tenantId) base.shop_id=tenantId;

  try{
    if(input.vehicle_id){
      let update=supabase.from('customer_vehicles').update({...base,shop_id:undefined,customer_id:undefined}).eq('id',String(input.vehicle_id));
      if(tenantId) update=update.eq('shop_id',tenantId);
      const {data,error}=await update.select('*').maybeSingle();
      if(error) throw error;
      if(data) return data;
    }

    let query=supabase.from('customer_vehicles')
      .select('*')
      .eq('customer_id',ownerId)
      .eq('year',base.year)
      .eq('make',base.make)
      .eq('model',base.model)
      .order('last_seen_at',{ascending:false})
      .limit(1);
    if(tenantId) query=query.eq('shop_id',tenantId);
    const {data:matches,error:findError}=await query;
    if(findError) throw findError;
    const found=(matches||[])[0];
    if(found){
      const patch={last_seen_at:now,updated_at:now};
      for(const key of ['vin','plate','mileage','nickname','last_service']) if(base[key]) patch[key]=base[key];
      let update=supabase.from('customer_vehicles').update(patch).eq('id',found.id);
      if(tenantId) update=update.eq('shop_id',tenantId);
      const {data,error}=await update.select('*').single();
      if(error) throw error;
      return data;
    }

    const {data,error}=await supabase.from('customer_vehicles').insert(base).select('*').single();
    if(error) throw error;
    return data;
  }catch(error){
    if(missingTable(error,'customer_vehicles')) return null;
    throw error;
  }
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
    console.error('Audit log error:',err?.message||err);
  }
}

module.exports={db,normalizePhone,upsertCustomer,upsertCustomerVehicle,auditEvent,missingTable};
