const { makeTechToken, techCookieHeader, clearTechCookie, verifyPassword } = require('./_auth');
const { db } = require('./_db');
const { resolveShop } = require('./_tenant');

module.exports=async function handler(req,res){
  const mode=String(req.query?.mode||'').toLowerCase();
  if(mode==='logout'){
    res.setHeader('Set-Cookie',clearTechCookie());
    return res.status(200).json({status:'success'});
  }
  if(mode!=='login')return res.status(400).json({error:'Invalid auth action'});
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const username=String(req.body?.username||'').trim().toLowerCase(),password=String(req.body?.password||'');
  if(!username||!password)return res.status(400).json({error:'Username and password are required'});
  try{
    const supabase=db(),shop=await resolveShop(req,supabase);
    if(!shop.id)return res.status(400).json({error:'Technician accounts require the multi-shop database setup'});
    const {data,error}=await supabase.from('technician_accounts').select('id,name,username,password_hash,active').eq('shop_id',shop.id).eq('username',username).maybeSingle();
    if(error)throw error;
    if(!data?.active||!verifyPassword(password,data.password_hash))return res.status(401).json({error:'Incorrect username or password'});
    res.setHeader('Set-Cookie',techCookieHeader(makeTechToken(shop,data)));
    return res.status(200).json({status:'success',shop:{name:shop.name},technician:{id:data.id,name:data.name,username:data.username}});
  }catch(error){
    console.error(error);
    return res.status(500).json({error:error.message||'Unable to sign in'});
  }
};
