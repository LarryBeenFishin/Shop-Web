const { makeToken, cookieHeader, safeEqual } = require('./_auth');
module.exports = async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  if(!process.env.ADMIN_PASSWORD) return res.status(500).json({error:'ADMIN_PASSWORD is not configured'});
  if(!safeEqual(req.body?.password,process.env.ADMIN_PASSWORD)) return res.status(401).json({error:'Incorrect password'});
  res.setHeader('Set-Cookie',cookieHeader(makeToken()));
  return res.status(200).json({status:'success'});
};
