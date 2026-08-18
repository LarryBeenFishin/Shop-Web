const { db, normalizePhone, missingTable } = require('./_db');
const { resolveShop, applyShopScope } = require('./_tenant');
const { verifyForShop } = require('./_auth');

function json(res,code,data){ return res.status(code).json(data); }
function clean(v,n=200){ return String(v??'').trim().slice(0,n); }

module.exports=async function handler(req,res){
  if(req.method!=='GET') return json(res,405,{error:'Method not allowed'});

  const supabase=db();
  try{
    const shop=await resolveShop(req,supabase);
    if(!verifyForShop(req,shop)) return json(res,401,{error:'Unauthorized'});

    const normalized=normalizePhone(req.query.phone);
    if(normalized.length<7) return json(res,200,{status:'success',found:false,customer:null,vehicles:[]});

    let customerQuery=supabase.from('customers').select('*').eq('normalized_phone',normalized);
    customerQuery=applyShopScope(customerQuery,shop);
    const {data:customer,error:customerError}=await customerQuery.maybeSingle();
    if(customerError) throw customerError;
    if(!customer) return json(res,200,{status:'success',found:false,customer:null,vehicles:[]});

    let vehicles=[];
    try{
      let vehicleQuery=supabase
        .from('customer_vehicles')
        .select('*')
        .eq('customer_id',customer.id)
        .order('last_seen_at',{ascending:false});
      vehicleQuery=applyShopScope(vehicleQuery,shop);
      const {data,error}=await vehicleQuery;
      if(error) throw error;
      vehicles=data||[];
    }catch(error){
      if(!missingTable(error,'customer_vehicles')) throw error;
    }

    // Historical appointment fallback also handles customers created before the
    // customer_vehicles migration was installed.
    let appointmentQuery=supabase
      .from('appointments')
      .select('vehicle_id,year,make,model,service,appointment_date,created_at')
      .eq('customer_id',customer.id)
      .order('appointment_date',{ascending:false})
      .limit(200);
    appointmentQuery=applyShopScope(appointmentQuery,shop);
    const {data:appointments,error:appointmentError}=await appointmentQuery;
    if(appointmentError) throw appointmentError;

    const key=v=>`${clean(v.year,10)}|${clean(v.make,80).toLowerCase()}|${clean(v.model,100).toLowerCase()}`;
    const seen=new Set(vehicles.map(key));
    for(const a of appointments||[]){
      const year=clean(a.year,10),make=clean(a.make,80),model=clean(a.model,100);
      if(!year||!make||!model||[year,make,model].some(x=>x.toUpperCase()==='N/A')) continue;
      const item={
        id:a.vehicle_id||null,
        year,make,model,
        vin:null,plate:null,mileage:null,nickname:null,
        last_service:a.service||null,
        historical:true
      };
      const k=key(item);
      if(seen.has(k)) continue;
      seen.add(k);
      vehicles.push(item);
    }

    return json(res,200,{
      status:'success',
      found:true,
      customer:{
        id:customer.id,
        name:customer.name,
        phone:customer.phone,
        email:customer.email,
        notes:customer.notes||null,
        last_service:customer.last_service||null
      },
      vehicles
    });
  }catch(err){
    console.error(err);
    return json(res,500,{error:err.message||'Customer lookup failed'});
  }
};
