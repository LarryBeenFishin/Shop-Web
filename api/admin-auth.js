const { makeToken, cookieHeader, clearCookie, safeEqual } = require('./_auth');
const { db } = require('./_db');
const { resolveShop } = require('./_tenant');

module.exports = async function handler(req,res){
  const mode=String(req.query?.mode||'').toLowerCase();

  if(mode==='logout'){
    res.setHeader('Set-Cookie',clearCookie());
    return res.status(200).json({status:'success'});
  }

  if(mode!=='login') return res.status(400).json({error:'Invalid auth action'});
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  if(!process.env.ADMIN_PASSWORD) return res.status(500).json({error:'ADMIN_PASSWORD is not configured'});

  try{
    const supabase=db();
    const shop=await resolveShop(req,supabase);
    if(!safeEqual(req.body?.password,process.env.ADMIN_PASSWORD)) return res.status(401).json({error:'Incorrect password'});
    res.setHeader('Set-Cookie',cookieHeader(makeToken(shop)));
    return res.status(200).json({status:'success',shop:{id:shop.id,slug:shop.slug,name:shop.name}});
  }catch(err){
    console.error(err);
    return res.status(500).json({error:err.message||'Unable to resolve shop'});
  }
};
