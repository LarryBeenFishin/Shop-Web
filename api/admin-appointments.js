const { createClient } = require('@supabase/supabase-js');
const { verify } = require('./_auth');
function db(){return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})}
module.exports = async function handler(req,res){
  if(!verify(req)) return res.status(401).json({error:'Unauthorized'});
  const supabase=db();
  try{
    if(req.method==='GET'){
      const limit=Math.min(Number(req.query.limit)||200,500);
      let query=supabase.from('appointments').select('*').order('appointment_date',{ascending:true}).order('appointment_time_key',{ascending:true}).limit(limit);
      if(req.query.from) query=query.gte('appointment_date',req.query.from);
      const {data,error}=await query; if(error) throw error; return res.status(200).json({appointments:data||[]});
    }
    if(req.method==='PATCH'){
      const id=String(req.body?.id||''); const status=String(req.body?.status||''); const allowed=['pending','confirmed','completed','cancelled'];
      if(!id||!allowed.includes(status)) return res.status(400).json({error:'Invalid update'});
      const {data,error}=await supabase.from('appointments').update({status}).eq('id',id).select('*').single(); if(error) throw error; return res.status(200).json({appointment:data});
    }
    return res.status(405).json({error:'Method not allowed'});
  }catch(err){console.error(err);return res.status(500).json({error:'Unable to load appointments'});}
};
