const { verifyForShop } = require('./_auth');
const { db, auditEvent } = require('./_db');
const { resolveShop, applyShopScope } = require('./_tenant');

module.exports = async function handler(req,res){
  const supabase=db();
  try{
    const shop=await resolveShop(req,supabase);
    if(!verifyForShop(req,shop)) return res.status(401).json({error:'Unauthorized'});

    if(req.method==='GET'){
      const limit=Math.min(Number(req.query.limit)||200,500);
      let query=supabase.from('appointments').select('*').order('appointment_date',{ascending:true}).order('appointment_time_key',{ascending:true}).limit(limit);
      query=applyShopScope(query,shop);
      if(req.query.from) query=query.gte('appointment_date',req.query.from);
      const {data,error}=await query;
      if(error) throw error;
      return res.status(200).json({appointments:data||[]});
    }

    if(req.method==='PATCH'){
      const id=String(req.body?.id||'');
      const status=String(req.body?.status||'');
      const allowed=['pending','new','confirmed','checked-in','in-progress','waiting-approval','completed','cancelled'];
      if(!id||!allowed.includes(status)) return res.status(400).json({error:'Invalid update'});
      let query=supabase.from('appointments').update({status,updated_at:new Date().toISOString()}).eq('id',id);
      query=applyShopScope(query,shop);
      const {data,error}=await query.select('*').maybeSingle();
      if(error) throw error;
      if(!data) return res.status(404).json({error:'Appointment not found'});
      await auditEvent(supabase,shop.id,'appointment.status_changed','appointment',id,{status});
      return res.status(200).json({appointment:data});
    }

    return res.status(405).json({error:'Method not allowed'});
  }catch(err){
    console.error(err);
    return res.status(500).json({error:'Unable to load appointments'});
  }
};
