const { makePlatformToken, verifyPlatform, platformCookieHeader, clearPlatformCookie, safeEqual } = require('./_auth');

module.exports=async function handler(req,res){
  const mode=String(req.query?.mode||'').toLowerCase();

  if(mode==='logout'){
    res.setHeader('Set-Cookie',clearPlatformCookie());
    return res.status(200).json({status:'success'});
  }

  if(mode==='session'){
    return verifyPlatform(req)
      ? res.status(200).json({status:'success',authenticated:true})
      : res.status(401).json({error:'Unauthorized'});
  }

  if(mode!=='login'||req.method!=='POST')return res.status(400).json({error:'Invalid auth action'});
  if(!process.env.PLATFORM_OWNER_PASSWORD||!process.env.PLATFORM_SESSION_SECRET){
    return res.status(503).json({error:'Platform owner access has not been configured'});
  }

  const expectedUsername=String(process.env.PLATFORM_OWNER_USERNAME||'owner').trim().toLowerCase();
  const username=String(req.body?.username||'').trim().toLowerCase();
  if(!safeEqual(username,expectedUsername)||!safeEqual(req.body?.password,process.env.PLATFORM_OWNER_PASSWORD)){
    return res.status(401).json({error:'Incorrect username or password'});
  }

  res.setHeader('Set-Cookie',platformCookieHeader(makePlatformToken()));
  return res.status(200).json({status:'success'});
};
