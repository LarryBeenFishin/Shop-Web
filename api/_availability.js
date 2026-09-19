const DAYS=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const VALID_INTERVALS=new Set([15,30,45,60]);

function cleanText(value,max=120){return String(value??'').trim().slice(0,max)}
function validDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(String(value||''))}
function validMonth(value){return /^\d{4}-\d{2}$/.test(String(value||''))}
function timeMinutes(value){
  const text=String(value||'').trim();
  let match=text.match(/^(\d{1,2}):(\d{2})$/);
  if(match){const h=Number(match[1]),m=Number(match[2]);return h<24&&m<60?h*60+m:null}
  match=text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if(!match)return null;
  let h=Number(match[1]),m=Number(match[2]);
  if(h<1||h>12||m>59)return null;
  if(match[3].toUpperCase()==='PM'&&h!==12)h+=12;
  if(match[3].toUpperCase()==='AM'&&h===12)h=0;
  return h*60+m;
}
function timeKey(value){const mins=timeMinutes(value);return mins===null?'':`${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`}
function displayTime(value){
  const mins=typeof value==='number'?value:timeMinutes(value);
  if(mins===null)return '';
  const h24=Math.floor(mins/60),m=mins%60,period=h24>=12?'PM':'AM',h=h24%12||12;
  return `${h}:${String(m).padStart(2,'0')} ${period}`;
}
function defaultWeekly(config={}){
  const configured=Array.isArray(config?.appointment?.slots)?config.appointment.slots:[];
  const values=configured.map(timeMinutes).filter(v=>v!==null).sort((a,b)=>a-b);
  const start=displayTime(values.length?values[0]:540);
  const end=displayTime(values.length?values[values.length-1]:900);
  return Object.fromEntries(DAYS.map((day,index)=>[day,{enabled:index>=1&&index<=5,start,end}]));
}
function normalizeClosures(value){
  return (Array.isArray(value)?value:[]).slice(0,100).map((item,index)=>{
    const startDate=cleanText(item?.startDate||item?.start_date,10);
    const endDate=cleanText(item?.endDate||item?.end_date||startDate,10);
    if(!validDate(startDate)||!validDate(endDate)||endDate<startDate)return null;
    return {id:cleanText(item?.id,80)||`closure-${startDate}-${endDate}-${index}`,startDate,endDate,reason:cleanText(item?.reason,160)||'Shop closed'};
  }).filter(Boolean);
}
function normalizeAvailability(value={},config={}){
  const defaults=defaultWeekly(config),rawWeekly=value?.weekly&&typeof value.weekly==='object'?value.weekly:{};
  const weekly={};
  for(const day of DAYS){
    const raw=rawWeekly[day]||{};
    const enabled=raw.enabled===undefined?defaults[day].enabled:Boolean(raw.enabled);
    const start=timeKey(raw.start)||timeKey(defaults[day].start);
    const end=timeKey(raw.end)||timeKey(defaults[day].end);
    if(enabled&&timeMinutes(end)<timeMinutes(start))throw new Error(`${day} appointment hours end before they start`);
    weekly[day]={enabled,start,end};
  }
  const requested=Number(value?.slotMinutes);
  return {slotMinutes:VALID_INTERVALS.has(requested)?requested:30,weekly,closures:normalizeClosures(value?.closures)};
}
function availabilityFromConfig(publicConfig={}){return normalizeAvailability(publicConfig?.appointment?.availability||{},publicConfig)}
function slotsForDay(day,slotMinutes){
  if(!day?.enabled)return [];
  const start=timeMinutes(day.start),end=timeMinutes(day.end);
  if(start===null||end===null||end<start)return [];
  const out=[];
  for(let current=start;current<=end&&out.length<96;current+=slotMinutes)out.push(displayTime(current));
  return out;
}
function todayInTimezone(timezone='America/Chicago'){
  try{
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const byType=Object.fromEntries(parts.map(p=>[p.type,p.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
  }catch(_){return new Date().toISOString().slice(0,10)}
}
function dayNameForDate(date){return DAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]}
function availabilityForDate(settings,date,timezone){
  if(!validDate(date))return {open:false,reason:'Invalid date',slots:[]};
  if(date<=todayInTimezone(timezone))return {open:false,reason:'Same-day booking is not available',slots:[]};
  const closure=settings.closures.find(item=>date>=item.startDate&&date<=item.endDate);
  if(closure)return {open:false,reason:closure.reason||'Shop closed',slots:[]};
  const day=settings.weekly[dayNameForDate(date)];
  if(!day?.enabled)return {open:false,reason:'Appointments are not offered on this day',slots:[]};
  const slots=slotsForDay(day,settings.slotMinutes);
  return {open:slots.length>0,reason:slots.length?'':'No appointment times are configured',slots};
}
function monthBounds(month){
  if(!validMonth(month))return null;
  const [year,monthNumber]=month.split('-').map(Number);
  const days=new Date(Date.UTC(year,monthNumber,0)).getUTCDate();
  return {first:`${month}-01`,last:`${month}-${String(days).padStart(2,'0')}`,days};
}
async function freshPublicConfig(supabase,shop){
  if(!shop?.id)return shop?.public_config||{};
  const {data,error}=await supabase.from('shops').select('public_config').eq('id',shop.id).maybeSingle();
  if(error)throw error;
  return data?.public_config||shop.public_config||{};
}
async function loadAvailability(supabase,shop){const config=await freshPublicConfig(supabase,shop);return {config,settings:availabilityFromConfig(config)}}
async function saveAvailability(supabase,shop,input){
  if(!shop?.id)throw new Error('Multi-shop setup is required before availability can be saved');
  const current=await freshPublicConfig(supabase,shop);
  const settings=normalizeAvailability(input,current);
  const next={...current,appointment:{...(current.appointment||{}),availability:settings}};
  const {error}=await supabase.from('shops').update({public_config:next,updated_at:new Date().toISOString()}).eq('id',shop.id);
  if(error)throw error;
  return settings;
}

module.exports={DAYS,validDate,validMonth,timeKey,normalizeAvailability,availabilityFromConfig,availabilityForDate,monthBounds,loadAvailability,saveAvailability};
