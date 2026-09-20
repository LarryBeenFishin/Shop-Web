const { makeToken, makeAdminToken, cookieHeader, clearCookie, safeEqual, verifyPassword } = require('./_auth');
const { db } = require('./_db');
const { resolveShop } = require('./_tenant');

function missingAdminTable(error){
  const code=String(error?.code||'');
  const message=String(error?.message||'').toLowerCase();
  return code==='42P01'||code==='PGRST205'||message.includes('shop_admin_accounts');
}

module.exports = async function handler(req,res){
  const mode=String(req.query?.mode||'').toLowerCase();

  if(mode==='logout'){
    res.setHeader('Set-Cookie',clearCookie());
    return res.status(200).json({status:'success'});
  }

  if(mode!=='login') return res.status(400).json({error:'Invalid auth action'});
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  try{
    const supabase=db();
    const shop=await resolveShop(req,supabase);
    const username=String(req.body?.username||'').trim().toLowerCase();
    const password=String(req.body?.password||'');

    if(username&&shop.id){
      const {data:account,error}=await supabase.from('shop_admin_accounts').select('*').eq('shop_id',shop.id).eq('username',username).eq('active',true).maybeSingle();
      if(error&&!missingAdminTable(error))throw error;
      if(account&&verifyPassword(password,account.password_hash)){
        await supabase.from('shop_admin_accounts').update({last_login_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',account.id);
        res.setHeader('Set-Cookie',cookieHeader(makeAdminToken(shop,account)));
        return res.status(200).json({status:'success',shop:{id:shop.id,slug:shop.slug,name:shop.name},admin:{id:account.id,name:account.name,username:account.username}});
      }
      return res.status(401).json({error:'Incorrect username or password'});
    }

    if(!process.env.ADMIN_PASSWORD) return res.status(401).json({error:'Enter your admin username and password'});
    if(!safeEqual(password,process.env.ADMIN_PASSWORD)) return res.status(401).json({error:'Incorrect password'});
    res.setHeader('Set-Cookie',cookieHeader(makeToken(shop)));
    return res.status(200).json({status:'success',shop:{id:shop.id,slug:shop.slug,name:shop.name},legacy:true});
  }catch(err){
    console.error(err);
    return res.status(500).json({error:err.message||'Unable to resolve shop'});
  }
};
