const { verifyPlatform, hashPassword } = require('./_auth');
const { db, missingTable } = require('./_db');
const { clearShopCache } = require('./_tenant');

function json(res,code,data){return res.status(code).json(data)}
function s(value,max=3000){return String(value??'').trim().slice(0,max)}
function bool(value){return value===true||String(value).toLowerCase()==='true'}
function validSlug(value){return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)}
function validUsername(value){return /^[a-z0-9._-]{3,40}$/.test(value)}
function safeObject(value){return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}
function normalizeHostname(value){
  let host=s(value,240).toLowerCase();
  if(!host)return '';
  try{if(host.includes('://'))host=new URL(host).hostname.toLowerCase()}catch{}
  return host.split('/')[0].split(':')[0].replace(/^www\./,'').replace(/\.$/,'');
}
function validHostname(value){return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)||/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)}
function publicConfig(input,current={}){
  const prior=safeObject(current);
  const contact={...safeObject(prior.contact)};
  const brand={...safeObject(prior.brand)};
  if(input.contact_name!==undefined)contact.name=s(input.contact_name,120)||null;
  if(input.contact_email!==undefined)contact.email=s(input.contact_email,240)||null;
  if(input.contact_phone!==undefined)contact.phone=s(input.contact_phone,50)||null;
  if(input.logo_url!==undefined)brand.logo_url=s(input.logo_url,1000)||null;
  return {...prior,contact,brand};
}
function safeAdmin(row){return {id:row.id,shop_id:row.shop_id,name:row.name,username:row.username,active:row.active!==false,created_at:row.created_at,last_login_at:row.last_login_at}}
async function platformAudit(supabase,shopId,action,metadata={}){
  try{await supabase.from('platform_audit_events').insert({shop_id:shopId||null,action,metadata:safeObject(metadata)})}catch(error){console.error('Platform audit error:',error?.message||error)}
}
async function countFor(supabase,table,shopId,filters={}){
  let query=supabase.from(table).select('id',{count:'exact',head:true}).eq('shop_id',shopId);
  for(const [column,value] of Object.entries(filters))query=query.eq(column,value);
  const {count,error}=await query;
  if(error){if(missingTable(error,table))return 0;throw error}
  return count||0;
}
async function loadShop(supabase,id){
  const {data,error}=await supabase.from('shops').select('*').eq('id',id).maybeSingle();
  if(error)throw error;
  return data;
}

module.exports=async function handler(req,res){
  if(!verifyPlatform(req))return json(res,401,{error:'Unauthorized'});
  const action=s(req.query?.action||req.body?.action||'overview',80);
  const supabase=db();

  try{
    if(req.method==='GET'&&action==='overview'){
      const [{data:shops,error:shopError},{data:domains,error:domainError},{data:admins,error:adminError},{data:migrations,error:migrationError},{data:events,error:eventError}]=await Promise.all([
        supabase.from('shops').select('*').order('created_at',{ascending:true}),
        supabase.from('shop_domains').select('*').order('is_primary',{ascending:false}).order('created_at',{ascending:true}),
        supabase.from('shop_admin_accounts').select('id,shop_id,name,username,active,created_at,last_login_at').order('created_at',{ascending:true}),
        supabase.from('shop_migrations').select('*'),
        supabase.from('platform_audit_events').select('*').order('created_at',{ascending:false}).limit(30)
      ]);
      if(shopError)throw shopError;if(domainError)throw domainError;
      if(adminError||migrationError||eventError){
        const error=adminError||migrationError||eventError;
        if(missingTable(error,'shop_admin_accounts')||missingTable(error,'shop_migrations')||missingTable(error,'platform_audit_events')){
          return json(res,503,{error:'Run supabase/platform_owner_portal.sql in Supabase before opening the portal'});
        }
        throw error;
      }
      const domainMap=new Map(),adminMap=new Map(),migrationMap=new Map((migrations||[]).map(item=>[item.shop_id,item]));
      for(const domain of domains||[]){if(!domainMap.has(domain.shop_id))domainMap.set(domain.shop_id,[]);domainMap.get(domain.shop_id).push(domain)}
      for(const admin of admins||[]){if(!adminMap.has(admin.shop_id))adminMap.set(admin.shop_id,[]);adminMap.get(admin.shop_id).push(safeAdmin(admin))}
      let importBatches=[],importSetupRequired=false;
      const {data:batchData,error:batchError}=await supabase.from('shop_import_batches').select('*').order('created_at',{ascending:false}).limit(200);
      if(batchError){if(missingTable(batchError,'shop_import_batches'))importSetupRequired=true;else throw batchError}else importBatches=batchData||[];
      const batchMap=new Map();for(const batch of importBatches){if(!batchMap.has(batch.shop_id))batchMap.set(batch.shop_id,[]);batchMap.get(batch.shop_id).push(batch)}
      const result=await Promise.all((shops||[]).map(async shop=>{
        const [appointments,customers,inspections,technicians,requests]=await Promise.all([
          countFor(supabase,'appointments',shop.id),countFor(supabase,'customers',shop.id),countFor(supabase,'inspections',shop.id),countFor(supabase,'technician_accounts',shop.id,{active:true}),countFor(supabase,'inspection_requests',shop.id)
        ]);
        return {...shop,domains:domainMap.get(shop.id)||[],admins:adminMap.get(shop.id)||[],migration:migrationMap.get(shop.id)||null,import_batches:batchMap.get(shop.id)||[],counts:{appointments,customers,inspections,technicians,requests}};
      }));
      return json(res,200,{status:'success',shops:result,events:events||[],import_setup_required:importSetupRequired});
    }

    if(req.method==='POST'&&action==='shop'){
      const name=s(req.body?.name,120),slug=s(req.body?.slug,80).toLowerCase(),timezone=s(req.body?.timezone,80)||'America/Chicago';
      const status=['active','paused','archived'].includes(req.body?.status)?req.body.status:'active';
      if(!name)return json(res,400,{error:'Shop name is required'});
      if(!validSlug(slug))return json(res,400,{error:'Use lowercase letters, numbers, and dashes for the shop slug'});
      const hostname=normalizeHostname(req.body?.primary_domain);
      if(hostname&&!validHostname(hostname))return json(res,400,{error:'Enter a valid domain name'});
      const adminUsername=s(req.body?.admin_username,40).toLowerCase(),adminPassword=String(req.body?.admin_password||''),adminName=s(req.body?.admin_name,120);
      if(adminUsername&&!validUsername(adminUsername))return json(res,400,{error:'Admin username must be 3–40 characters using letters, numbers, periods, dashes, or underscores'});
      if(adminUsername&&adminPassword.length<8)return json(res,400,{error:'Admin password must be at least 8 characters'});
      const row={name,slug,timezone,status,notification_email:s(req.body?.notification_email,240)||null,public_config:publicConfig(req.body)};
      const {data:shop,error}=await supabase.from('shops').insert(row).select('*').single();
      if(error){if(error.code==='23505')return json(res,409,{error:'That shop slug is already in use'});throw error}
      try{
        if(hostname){const {error:domainError}=await supabase.from('shop_domains').insert({shop_id:shop.id,hostname,is_primary:true});if(domainError)throw domainError}
        if(adminUsername){const {error:adminError}=await supabase.from('shop_admin_accounts').insert({shop_id:shop.id,name:adminName||'Shop Administrator',username:adminUsername,password_hash:hashPassword(adminPassword)});if(adminError)throw adminError}
        const {error:migrationError}=await supabase.from('shop_migrations').insert({shop_id:shop.id,source:s(req.body?.migration_source,160)||null,status:'not_started'});if(migrationError)throw migrationError;
      }catch(setupError){
        await supabase.from('shops').delete().eq('id',shop.id);
        if(setupError.code==='23505')return json(res,409,{error:'That domain or admin username is already in use'});
        throw setupError;
      }
      await platformAudit(supabase,shop.id,'shop.created',{name,slug,hostname:hostname||null});
      return json(res,201,{status:'success',shop});
    }

    if(req.method==='PATCH'&&action==='shop'){
      const id=s(req.body?.id,80),current=await loadShop(supabase,id);
      if(!current)return json(res,404,{error:'Shop not found'});
      const patch={updated_at:new Date().toISOString()};
      if(req.body?.name!==undefined){patch.name=s(req.body.name,120);if(!patch.name)return json(res,400,{error:'Shop name is required'})}
      if(req.body?.slug!==undefined){patch.slug=s(req.body.slug,80).toLowerCase();if(!validSlug(patch.slug))return json(res,400,{error:'Use lowercase letters, numbers, and dashes for the shop slug'})}
      if(req.body?.timezone!==undefined)patch.timezone=s(req.body.timezone,80)||'America/Chicago';
      if(req.body?.status!==undefined){if(!['active','paused','archived'].includes(req.body.status))return json(res,400,{error:'Invalid shop status'});patch.status=req.body.status}
      if(req.body?.notification_email!==undefined)patch.notification_email=s(req.body.notification_email,240)||null;
      if(['contact_name','contact_email','contact_phone','logo_url'].some(key=>req.body?.[key]!==undefined))patch.public_config=publicConfig(req.body,current.public_config);
      const {data,error}=await supabase.from('shops').update(patch).eq('id',id).select('*').single();
      if(error){if(error.code==='23505')return json(res,409,{error:'That shop slug is already in use'});throw error}
      clearShopCache(current);clearShopCache(data);
      await platformAudit(supabase,id,'shop.updated',{fields:Object.keys(patch)});
      return json(res,200,{status:'success',shop:data});
    }

    if(req.method==='POST'&&action==='domain'){
      const shopId=s(req.body?.shop_id,80),hostname=normalizeHostname(req.body?.hostname),primary=bool(req.body?.is_primary);
      if(!await loadShop(supabase,shopId))return json(res,404,{error:'Shop not found'});
      if(!hostname||!validHostname(hostname))return json(res,400,{error:'Enter a valid domain name'});
      if(primary)await supabase.from('shop_domains').update({is_primary:false}).eq('shop_id',shopId);
      const {data,error}=await supabase.from('shop_domains').insert({shop_id:shopId,hostname,is_primary:primary}).select('*').single();
      if(error){if(error.code==='23505')return json(res,409,{error:'That domain is already assigned'});throw error}
      clearShopCache({id:shopId});await platformAudit(supabase,shopId,'domain.added',{hostname,primary});
      return json(res,201,{status:'success',domain:data});
    }

    if(req.method==='PATCH'&&action==='domain'){
      const id=s(req.body?.id,80),shopId=s(req.body?.shop_id,80);
      const {data:current,error:findError}=await supabase.from('shop_domains').select('*').eq('id',id).eq('shop_id',shopId).maybeSingle();
      if(findError)throw findError;if(!current)return json(res,404,{error:'Domain not found'});
      if(bool(req.body?.is_primary))await supabase.from('shop_domains').update({is_primary:false}).eq('shop_id',shopId);
      const {data,error}=await supabase.from('shop_domains').update({is_primary:bool(req.body?.is_primary)}).eq('id',id).eq('shop_id',shopId).select('*').single();
      if(error)throw error;clearShopCache({id:shopId});await platformAudit(supabase,shopId,'domain.updated',{hostname:data.hostname,primary:data.is_primary});
      return json(res,200,{status:'success',domain:data});
    }

    if(req.method==='DELETE'&&action==='domain'){
      const id=s(req.query?.id||req.body?.id,80),shopId=s(req.query?.shop_id||req.body?.shop_id,80);
      const {data,error}=await supabase.from('shop_domains').delete().eq('id',id).eq('shop_id',shopId).select('*').maybeSingle();
      if(error)throw error;if(!data)return json(res,404,{error:'Domain not found'});
      clearShopCache({id:shopId});await platformAudit(supabase,shopId,'domain.removed',{hostname:data.hostname});
      return json(res,200,{status:'success'});
    }

    if(req.method==='POST'&&action==='admin'){
      const shopId=s(req.body?.shop_id,80),name=s(req.body?.name,120),username=s(req.body?.username,40).toLowerCase(),password=String(req.body?.password||'');
      if(!await loadShop(supabase,shopId))return json(res,404,{error:'Shop not found'});
      if(!name)return json(res,400,{error:'Admin name is required'});if(!validUsername(username))return json(res,400,{error:'Enter a valid admin username'});if(password.length<8)return json(res,400,{error:'Password must be at least 8 characters'});
      const {data,error}=await supabase.from('shop_admin_accounts').insert({shop_id:shopId,name,username,password_hash:hashPassword(password),active:true}).select('*').single();
      if(error){if(error.code==='23505')return json(res,409,{error:'That username already exists for this shop'});throw error}
      await platformAudit(supabase,shopId,'admin.created',{name,username});return json(res,201,{status:'success',admin:safeAdmin(data)});
    }

    if(req.method==='PATCH'&&action==='admin'){
      const id=s(req.body?.id,80),shopId=s(req.body?.shop_id,80),patch={updated_at:new Date().toISOString()};
      if(req.body?.name!==undefined){patch.name=s(req.body.name,120);if(!patch.name)return json(res,400,{error:'Admin name is required'})}
      if(req.body?.username!==undefined){patch.username=s(req.body.username,40).toLowerCase();if(!validUsername(patch.username))return json(res,400,{error:'Enter a valid admin username'})}
      if(req.body?.active!==undefined)patch.active=bool(req.body.active);
      if(req.body?.password!==undefined){const password=String(req.body.password||'');if(password.length<8)return json(res,400,{error:'Password must be at least 8 characters'});patch.password_hash=hashPassword(password)}
      const {data,error}=await supabase.from('shop_admin_accounts').update(patch).eq('id',id).eq('shop_id',shopId).select('*').maybeSingle();
      if(error){if(error.code==='23505')return json(res,409,{error:'That username already exists for this shop'});throw error}if(!data)return json(res,404,{error:'Admin account not found'});
      await platformAudit(supabase,shopId,'admin.updated',{username:data.username,fields:Object.keys(patch)});return json(res,200,{status:'success',admin:safeAdmin(data)});
    }

    if(req.method==='PATCH'&&action==='migration'){
      const shopId=s(req.body?.shop_id,80),status=s(req.body?.status,30);
      if(!['not_started','ready','in_progress','review','completed'].includes(status))return json(res,400,{error:'Invalid migration status'});
      const row={shop_id:shopId,status,source:s(req.body?.source,160)||null,notes:s(req.body?.notes,5000)||null,updated_at:new Date().toISOString()};
      const {data,error}=await supabase.from('shop_migrations').upsert(row,{onConflict:'shop_id'}).select('*').single();if(error)throw error;
      await platformAudit(supabase,shopId,'migration.updated',{status});return json(res,200,{status:'success',migration:data});
    }

    return json(res,400,{error:'Unsupported platform action'});
  }catch(error){
    console.error(error);
    return json(res,500,{error:error.message||'Platform operation failed'});
  }
};
