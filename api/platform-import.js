const crypto = require('crypto');
const { verifyPlatform } = require('./_auth');
const { db, normalizePhone, missingTable } = require('./_db');

const TYPES = new Set(['customers','appointments','inspections']);
const APPOINTMENT_STATUSES = new Set(['pending','new','confirmed','checked-in','in-progress','waiting-approval','completed','cancelled']);
const INSPECTION_SECTIONS = ['brakes','tires','suspension','fluids','battery','lights','wipers','filters','leaks'];
const MAX_ROWS = 2000;

function json(res,code,data){return res.status(code).json(data)}
function clean(value,max=3000){return String(value??'').trim().slice(0,max)}
function truthy(value){return value===true||['true','yes','y','1','checked'].includes(clean(value,20).toLowerCase())}
function keyName(value){return clean(value,200).toLowerCase().replace(/[^a-z0-9]/g,'')}
function rowMap(row){const out={};for(const [key,value] of Object.entries(row&&typeof row==='object'&&!Array.isArray(row)?row:{}))out[keyName(key)]=value;return out}
function pick(map,...names){for(const name of names){const value=map[keyName(name)];if(value!==undefined&&value!==null&&clean(value)!=='')return value}return ''}
function rawPick(row,...names){const wanted=new Set(names.map(keyName));for(const [key,value] of Object.entries(row||{})){if(wanted.has(keyName(key)))return value}return undefined}
function isoDate(value){
  const text=clean(value,80);if(!text)return '';
  if(/^\d{4}-\d{2}-\d{2}$/.test(text))return text;
  const us=text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if(us){const year=us[3].length===2?`20${us[3]}`:us[3];return `${year}-${String(us[1]).padStart(2,'0')}-${String(us[2]).padStart(2,'0')}`}
  const serial=Number(text);if(Number.isFinite(serial)&&serial>20000&&serial<100000){return new Date(Math.round((serial-25569)*86400000)).toISOString().slice(0,10)}
  const parsed=new Date(text);return Number.isNaN(parsed.getTime())?'':parsed.toISOString().slice(0,10);
}
function isoTimestamp(value){const text=clean(value,120);if(!text)return '';const parsed=new Date(text);return Number.isNaN(parsed.getTime())?'':parsed.toISOString()}
function normalizedTime(value){
  const text=clean(value,40).toUpperCase();if(!text)return {label:'',key:''};
  let match=text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if(match){let hour=Number(match[1]);if(hour<1||hour>12||Number(match[2])>59)return {label:'',key:''};const suffix=match[3];let h24=hour;if(suffix==='PM'&&hour!==12)h24+=12;if(suffix==='AM'&&hour===12)h24=0;return {label:`${hour}:${match[2]} ${suffix}`,key:`${String(h24).padStart(2,'0')}:${match[2]}`}}
  match=text.match(/^(\d{1,2}):(\d{2})$/);
  if(match){const h24=Number(match[1]),minute=Number(match[2]);if(h24>23||minute>59)return {label:'',key:''};const suffix=h24>=12?'PM':'AM',hour=h24%12||12;return {label:`${hour}:${match[2]} ${suffix}`,key:`${String(h24).padStart(2,'0')}:${match[2]}`}}
  return {label:text,key:text};
}
function inspectionStatus(value){const text=clean(value,80).toLowerCase();if(['good','green','pass','passed','ok'].includes(text))return 'Good';if(['needs attention','attention','red','fail','failed','urgent'].includes(text))return 'Needs Attention';return 'Monitor'}
function appointmentStatus(value){const text=clean(value,50).toLowerCase().replace(/\s+/g,'-');return APPOINTMENT_STATUSES.has(text)?text:'pending'}
function vehicleParts(map){return {year:clean(pick(map,'year','vehicle year'),10),make:clean(pick(map,'make','vehicle make'),80),model:clean(pick(map,'model','vehicle model'),100)}}

function normalizeCustomer(row){
  const map=rowMap(row),parts=vehicleParts(map),vehicle=clean(pick(map,'vehicle','vehicle description'),300)||[parts.year,parts.make,parts.model].filter(Boolean).join(' ');
  const value={name:clean(pick(map,'name','customer name','full name'),120),phone:clean(pick(map,'phone','phone number','customer phone','mobile'),40),email:clean(pick(map,'email','email address'),200)||null,vehicle:vehicle||null,vin:clean(pick(map,'vin','vehicle vin'),40)||null,plate:clean(pick(map,'plate','license plate'),40)||null,mileage:clean(pick(map,'mileage','odometer'),50)||null,last_service:clean(pick(map,'last service','service'),120)||null,notes:clean(pick(map,'notes','customer notes'),3000)||null};
  value.normalized_phone=normalizePhone(value.phone)||null;
  const errors=[];if(!value.name)errors.push('Missing customer name');if(!value.phone)errors.push('Missing phone number');if(value.phone&&!value.normalized_phone)errors.push('Phone number is invalid');
  return {value,errors,key:value.normalized_phone||clean(value.email,200).toLowerCase()};
}
function normalizeAppointment(row){
  const map=rowMap(row),parts=vehicleParts(map),time=normalizedTime(pick(map,'appointment time','preferred time','time','appointment_time'));
  const date=isoDate(pick(map,'appointment date','preferred date','preferred date raw','date','appointment_date'));
  const value={name:clean(pick(map,'name','customer name','full name'),120),phone:clean(pick(map,'phone','phone number','customer phone','mobile'),40),email:clean(pick(map,'email','email address'),200)||null,year:parts.year||'N/A',make:parts.make||'N/A',model:parts.model||'N/A',service:clean(pick(map,'service','service needed','reason','concern'),120)||'Other',appointment_date:date,preferred_date_label:date,appointment_time:time.label,appointment_time_key:time.key,drop_off:truthy(pick(map,'drop off','dropoff','drop_off')),message:clean(pick(map,'message','customer message','concern'),3000)||null,marketing_opt_in:truthy(pick(map,'marketing opt in','marketing','marketing_opt_in')),submitted_from:'Platform import',status:appointmentStatus(pick(map,'status')),internal_notes:clean(pick(map,'internal notes','admin notes'),3000)||null,seen:true,updated_at:new Date().toISOString()};
  const errors=[];if(!value.name)errors.push('Missing customer name');if(!value.phone)errors.push('Missing phone number');if(!normalizePhone(value.phone))errors.push('Phone number is invalid');if(!date)errors.push('Missing or invalid appointment date');if(!time.key)errors.push('Missing or invalid appointment time');
  return {value,errors,key:date&&time.key?`${date}|${time.key}`:''};
}
function normalizeInspectionItems(row,map){
  const supplied=rawPick(row,'inspection_items','inspection items','items');
  let parsed=supplied;
  if(typeof supplied==='string'){try{parsed=JSON.parse(supplied)}catch{parsed=null}}
  if(Array.isArray(parsed)){return parsed.slice(0,100).map((item,index)=>({id:clean(item?.id||`item-${index+1}`,100),title:clean(item?.title||item?.name,160),status:inspectionStatus(item?.status),notes:clean(item?.notes,3000)})).filter(item=>item.title)}
  const items=[];
  for(const section of INSPECTION_SECTIONS){const status=pick(map,`${section} status`,`${section}_status`,section),notes=pick(map,`${section} notes`,`${section}_notes`);if(clean(status)||clean(notes))items.push({id:section,title:section[0].toUpperCase()+section.slice(1),status:inspectionStatus(status),notes:clean(notes,3000)})}
  return items;
}
function addLegacyInspectionFields(value,items){for(const section of INSPECTION_SECTIONS){const item=items.find(entry=>keyName(entry.title)===section);value[`${section}_status`]=item?.status||null;value[`${section}_notes`]=item?.notes||null}return value}
function normalizeInspection(row){
  const map=rowMap(row),parts=vehicleParts(map),vehicle=clean(pick(map,'vehicle','vehicle description'),300)||[parts.year,parts.make,parts.model].filter(Boolean).join(' '),items=normalizeInspectionItems(row,map),created=isoTimestamp(pick(map,'created at','created','inspection date','date','timestamp'));
  if(!items.length)items.push({id:'general',title:'General inspection',status:inspectionStatus(pick(map,'overall status','status')),notes:clean(pick(map,'notes','recommendations'),3000)});
  const value=addLegacyInspectionFields({customer_name:clean(pick(map,'customer name','name','full name'),120),phone:clean(pick(map,'phone','phone number','customer phone','mobile'),40)||null,email:clean(pick(map,'email','email address'),200)||null,vehicle:vehicle||'',mileage:clean(pick(map,'mileage','odometer'),50)||null,technician:clean(pick(map,'technician','tech'),120)||null,overall_status:inspectionStatus(pick(map,'overall status','overall_status','status')),recommendations:clean(pick(map,'recommendations','notes'),5000)||null,inspection_items:items},items);
  if(created)value.created_at=created;
  const errors=[];if(!value.customer_name)errors.push('Missing customer name');if(!value.vehicle)errors.push('Missing vehicle');
  const phone=normalizePhone(value.phone),day=created.slice(0,10);return {value,errors,key:phone&&day?`${phone}|${value.vehicle.toLowerCase()}|${day}`:''};
}
function normalizeRow(type,row){if(type==='customers')return normalizeCustomer(row);if(type==='appointments')return normalizeAppointment(row);return normalizeInspection(row)}
function chunks(items,size=100){const output=[];for(let index=0;index<items.length;index+=size)output.push(items.slice(index,index+size));return output}
function setupError(error){const message=clean(error?.message,1000).toLowerCase(),code=clean(error?.code,40);return missingTable(error,'shop_import_batches')||missingTable(error,'shop_import_records')||code==='PGRST204'&&/(shop_import|source_hash|record_table)/.test(message)}

async function requireShop(supabase,shopId){const {data,error}=await supabase.from('shops').select('id,name,slug').eq('id',shopId).maybeSingle();if(error)throw error;return data}
async function existingKeys(supabase,shopId,type){
  if(type==='customers'){
    const {data,error}=await supabase.from('customers').select('phone,normalized_phone,email').eq('shop_id',shopId);if(error)throw error;
    return new Set((data||[]).map(row=>row.normalized_phone||normalizePhone(row.phone)||clean(row.email).toLowerCase()).filter(Boolean));
  }
  if(type==='appointments'){
    const {data,error}=await supabase.from('appointments').select('appointment_date,appointment_time_key,status').eq('shop_id',shopId).neq('status','cancelled');if(error)throw error;
    return new Set((data||[]).map(row=>`${row.appointment_date}|${row.appointment_time_key}`));
  }
  const {data,error}=await supabase.from('inspections').select('phone,vehicle,created_at').eq('shop_id',shopId);if(error)throw error;
  return new Set((data||[]).map(row=>{const phone=normalizePhone(row.phone),day=clean(row.created_at).slice(0,10);return phone&&day?`${phone}|${clean(row.vehicle).toLowerCase()}|${day}`:''}).filter(Boolean));
}
async function analyze(supabase,shopId,type,rows){
  const existing=await existingKeys(supabase,shopId,type),seen=new Set(),results=[];
  for(let index=0;index<rows.length;index++){
    const normalized=normalizeRow(type,rows[index]);let disposition='ready',reason='Ready to import';
    if(normalized.errors.length){disposition='invalid';reason=normalized.errors.join('; ')}
    else if(normalized.key&&existing.has(normalized.key)){disposition='duplicate';reason='Already exists in this shop'}
    else if(normalized.key&&seen.has(normalized.key)){disposition='duplicate';reason='Repeated in this file'}
    if(normalized.key)seen.add(normalized.key);
    results.push({row:index+1,...normalized,disposition,reason});
  }
  const ready=results.filter(item=>item.disposition==='ready'),duplicates=results.filter(item=>item.disposition==='duplicate'),invalid=results.filter(item=>item.disposition==='invalid');
  return {results,ready,duplicates,invalid,summary:{total:rows.length,ready:ready.length,duplicates:duplicates.length,invalid:invalid.length},sample:results.slice(0,12).map(item=>({row:item.row,status:item.disposition,reason:item.reason,name:item.value.name||item.value.customer_name||'',phone:item.value.phone||'',date:item.value.appointment_date||clean(item.value.created_at).slice(0,10),vehicle:item.value.vehicle||[item.value.year,item.value.make,item.value.model].filter(value=>value&&value!=='N/A').join(' ')}))};
}
async function recordCreated(supabase,batchId,shopId,table,rows){
  if(!rows.length)return;
  const records=rows.map(row=>({batch_id:batchId,shop_id:shopId,record_table:table,record_id:row.id}));
  for(const group of chunks(records,200)){const {error}=await supabase.from('shop_import_records').insert(group);if(error)throw error}
}
async function insertRows(supabase,batchId,shopId,table,rows){
  const created=[];
  for(const group of chunks(rows,100)){const {data,error}=await supabase.from(table).insert(group).select('id');if(error)throw error;const inserted=data||[];created.push(...inserted);await recordCreated(supabase,batchId,shopId,table,inserted)}
  return created;
}
async function customersByPhones(supabase,shopId,phones){
  const unique=[...new Set(phones.filter(Boolean))],rows=[];
  for(const group of chunks(unique,150)){if(!group.length)continue;const {data,error}=await supabase.from('customers').select('id,name,phone,normalized_phone').eq('shop_id',shopId).in('normalized_phone',group);if(error)throw error;rows.push(...(data||[]))}
  return new Map(rows.map(row=>[row.normalized_phone||normalizePhone(row.phone),row]));
}
async function prepareInspectionCustomers(supabase,batchId,shopId,ready){
  const phones=ready.map(item=>normalizePhone(item.value.phone)).filter(Boolean),map=await customersByPhones(supabase,shopId,phones),missing=[];
  for(const item of ready){const phone=normalizePhone(item.value.phone);if(!phone||map.has(phone)||missing.some(row=>row.normalized_phone===phone))continue;missing.push({shop_id:shopId,name:item.value.customer_name,phone:item.value.phone,normalized_phone:phone,email:item.value.email||null,vehicle:item.value.vehicle||null,mileage:item.value.mileage||null,updated_at:new Date().toISOString()})}
  if(missing.length){const created=[];for(const group of chunks(missing,100)){const {data,error}=await supabase.from('customers').insert(group).select('id,name,phone,normalized_phone');if(error)throw error;created.push(...(data||[]));await recordCreated(supabase,batchId,shopId,'customers',data||[])}for(const row of created)map.set(row.normalized_phone||normalizePhone(row.phone),row)}
  return map;
}
async function trackAppointmentCustomers(supabase,batchId,shopId,ready,before){
  const phones=ready.map(item=>normalizePhone(item.value.phone)).filter(Boolean),after=await customersByPhones(supabase,shopId,phones),created=[];
  for(const [phone,row] of after){if(!before.has(phone))created.push(row)}
  await recordCreated(supabase,batchId,shopId,'customers',created);
}
async function importReady(supabase,batchId,shopId,type,ready){
  if(type==='customers')return insertRows(supabase,batchId,shopId,'customers',ready.map(item=>({...item.value,shop_id:shopId,updated_at:new Date().toISOString()})));
  if(type==='appointments'){
    const phones=ready.map(item=>normalizePhone(item.value.phone)).filter(Boolean),before=await customersByPhones(supabase,shopId,phones);
    const created=await insertRows(supabase,batchId,shopId,'appointments',ready.map(item=>({...item.value,shop_id:shopId})));
    await trackAppointmentCustomers(supabase,batchId,shopId,ready,before);
    return created;
  }
  const customers=await prepareInspectionCustomers(supabase,batchId,shopId,ready);
  const rows=ready.map(item=>{const phone=normalizePhone(item.value.phone),customer=customers.get(phone);return {...item.value,shop_id:shopId,customer_id:customer?.id||null}});
  return insertRows(supabase,batchId,shopId,'inspections',rows);
}
async function audit(supabase,shopId,action,metadata){try{await supabase.from('platform_audit_events').insert({shop_id:shopId,action,metadata})}catch(error){console.error('Platform import audit error:',error?.message||error)}}
async function deleteIds(supabase,table,shopId,ids){let removed=0;for(const group of chunks(ids,100)){if(!group.length)continue;const {data,error}=await supabase.from(table).delete().eq('shop_id',shopId).in('id',group).select('id');if(error)throw error;removed+=(data||[]).length}return removed}

module.exports=async function handler(req,res){
  if(!verifyPlatform(req))return json(res,401,{error:'Unauthorized'});
  const supabase=db(),action=clean(req.query?.action||req.body?.action,40),shopId=clean(req.body?.shop_id||req.query?.shop_id,80);
  try{
    const shop=await requireShop(supabase,shopId);if(!shop)return json(res,404,{error:'Shop not found'});

    if(req.method==='POST'&&(action==='preview'||action==='import')){
      const type=clean(req.body?.data_type,30),rows=Array.isArray(req.body?.rows)?req.body.rows:[];
      if(!TYPES.has(type))return json(res,400,{error:'Choose customers, appointments, or inspections'});
      if(!rows.length)return json(res,400,{error:'The selected file has no data rows'});
      if(rows.length>MAX_ROWS)return json(res,413,{error:`Import files are limited to ${MAX_ROWS} rows at a time`});
      const analysis=await analyze(supabase,shopId,type,rows);
      if(action==='preview')return json(res,200,{status:'success',data_type:type,...analysis.summary,sample:analysis.sample});
      if(!analysis.ready.length)return json(res,400,{error:'There are no new valid rows to import'});

      const filename=clean(req.body?.filename,240)||`${type}.json`,sourceHash=crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
      const batchRow={shop_id:shopId,data_type:type,filename,source_hash:sourceHash,status:'in_progress',total_rows:analysis.summary.total,skipped_rows:analysis.summary.duplicates,invalid_rows:analysis.summary.invalid,summary:{preview:analysis.summary}};
      const {data:batch,error:batchError}=await supabase.from('shop_import_batches').insert(batchRow).select('*').single();
      if(batchError){if(setupError(batchError))return json(res,503,{error:'Run the updated supabase/platform_owner_portal.sql before using data imports'});throw batchError}
      let created=[];
      try{
        created=await importReady(supabase,batch.id,shopId,type,analysis.ready);
        const completedAt=new Date().toISOString(),status=created.length===analysis.ready.length?'completed':'partial',summary={preview:analysis.summary,created:created.length};
        const {error:updateError}=await supabase.from('shop_import_batches').update({status,completed_at:completedAt,imported_rows:created.length,summary}).eq('id',batch.id);if(updateError)throw updateError;
        await supabase.from('shop_migrations').upsert({shop_id:shopId,status:'review',source:'Portal file import',notes:`Imported ${created.length} ${type} from ${filename}. Review the shop before marking the transfer complete.`,updated_at:completedAt},{onConflict:'shop_id'});
        await audit(supabase,shopId,'migration.batch.imported',{batch_id:batch.id,data_type:type,filename,imported:created.length,duplicates:analysis.summary.duplicates,invalid:analysis.summary.invalid});
        return json(res,201,{status:'success',batch_id:batch.id,imported:created.length,duplicates:analysis.summary.duplicates,invalid:analysis.summary.invalid});
      }catch(error){
        const {count}=await supabase.from('shop_import_records').select('id',{count:'exact',head:true}).eq('batch_id',batch.id).eq('record_table',type);
        await supabase.from('shop_import_batches').update({status:(count||0)>0?'partial':'failed',completed_at:new Date().toISOString(),imported_rows:count||0,summary:{preview:analysis.summary,error:clean(error.message,1000)}}).eq('id',batch.id);
        throw error;
      }
    }

    if(req.method==='POST'&&action==='rollback'){
      const batchId=clean(req.body?.batch_id,80);
      const {data:batch,error:batchError}=await supabase.from('shop_import_batches').select('*').eq('id',batchId).eq('shop_id',shopId).maybeSingle();
      if(batchError){if(setupError(batchError))return json(res,503,{error:'Run the updated platform SQL before using rollback'});throw batchError}
      if(!batch)return json(res,404,{error:'Import batch not found'});if(batch.status==='rolled_back')return json(res,409,{error:'This import was already rolled back'});if(batch.status==='in_progress')return json(res,409,{error:'An import in progress cannot be rolled back'});
      const {data:records,error:recordError}=await supabase.from('shop_import_records').select('record_table,record_id').eq('batch_id',batchId).eq('shop_id',shopId);if(recordError)throw recordError;
      const grouped={customers:[],appointments:[],inspections:[]};for(const record of records||[]){if(grouped[record.record_table])grouped[record.record_table].push(record.record_id)}
      const removed={inspections:await deleteIds(supabase,'inspections',shopId,grouped.inspections),appointments:await deleteIds(supabase,'appointments',shopId,grouped.appointments),customers:0,retained_customers:0};
      for(const customerId of grouped.customers){
        const [{count:appointments,error:appointmentError},{count:inspections,error:inspectionError}]=await Promise.all([supabase.from('appointments').select('id',{count:'exact',head:true}).eq('shop_id',shopId).eq('customer_id',customerId),supabase.from('inspections').select('id',{count:'exact',head:true}).eq('shop_id',shopId).eq('customer_id',customerId)]);if(appointmentError)throw appointmentError;if(inspectionError)throw inspectionError;
        if((appointments||0)+(inspections||0)>0){removed.retained_customers++;continue}
        removed.customers+=await deleteIds(supabase,'customers',shopId,[customerId]);
      }
      const rolledBackAt=new Date().toISOString();await supabase.from('shop_import_batches').update({status:'rolled_back',rolled_back_at:rolledBackAt,summary:{...(batch.summary||{}),rollback:removed}}).eq('id',batch.id);
      await supabase.from('shop_migrations').upsert({shop_id:shopId,status:'ready',source:'Portal file import',notes:`Rolled back ${batch.filename||batch.data_type}. A new preview can be run safely.`,updated_at:rolledBackAt},{onConflict:'shop_id'});
      await audit(supabase,shopId,'migration.batch.rolled_back',{batch_id:batch.id,data_type:batch.data_type,...removed});
      return json(res,200,{status:'success',removed});
    }

    return json(res,400,{error:'Unsupported import action'});
  }catch(error){console.error(error);if(setupError(error))return json(res,503,{error:'Run the updated supabase/platform_owner_portal.sql before using data imports'});return json(res,500,{error:error.message||'Platform import failed'})}
};
