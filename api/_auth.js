const crypto = require('crypto');
const COOKIE = 'shop_admin';
const TECH_COOKIE = 'shop_tech';
const PLATFORM_COOKIE = 'platform_owner';
const MAX_AGE_SECONDS = 60 * 60 * 8;

function secret(){
  if(!process.env.ADMIN_SESSION_SECRET) throw new Error('ADMIN_SESSION_SECRET is not configured');
  return process.env.ADMIN_SESSION_SECRET;
}
function sign(value){ return crypto.createHmac('sha256',secret()).update(value).digest('base64url'); }
function parseCookies(req){
  return String(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(Boolean).reduce((a,v)=>{
    const i=v.indexOf('='); if(i>0)a[v.slice(0,i)]=decodeURIComponent(v.slice(i+1)); return a;
  },{});
}
function makeToken(shop={}){
  const payload=Buffer.from(JSON.stringify({
    v:2,
    exp:Date.now()+MAX_AGE_SECONDS*1000,
    shopId:shop.id||null,
    shopSlug:shop.slug||null
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function makeAdminToken(shop={},admin={}){
  const payload=Buffer.from(JSON.stringify({
    v:3,
    role:'admin',
    exp:Date.now()+MAX_AGE_SECONDS*1000,
    shopId:shop.id||null,
    shopSlug:shop.slug||null,
    adminId:admin.id||null,
    adminName:admin.name||null,
    adminUsername:admin.username||null
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function makeTechToken(shop={},technician={}){
  const payload=Buffer.from(JSON.stringify({
    v:1,
    role:'technician',
    exp:Date.now()+MAX_AGE_SECONDS*1000,
    shopId:shop.id||null,
    shopSlug:shop.slug||null,
    technicianId:technician.id,
    technicianName:technician.name
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function verifyCookie(req,cookieName){
  try{
    const token=parseCookies(req)[cookieName]; if(!token)return null;
    const [payload,sig]=token.split('.'); if(!payload||!sig)return null;
    const expected=sign(payload);
    if(sig.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null;
    const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    if(Number(data.exp)<=Date.now())return null;
    return data;
  }catch{return null;}
}
function verify(req){
  return verifyCookie(req,COOKIE);
}
function verifyForShop(req,shop){
  const session=verify(req); if(!session)return null;
  if(shop?.id){
    // v1 cookies had no shop binding. Force a fresh login after the tenant upgrade.
    if(!session.shopId || session.shopId!==shop.id)return null;
  }
  return session;
}
function verifyTechForShop(req,shop){
  const session=verifyCookie(req,TECH_COOKIE);if(!session||session.role!=='technician'||!session.technicianId)return null;
  if(shop?.id&&session.shopId!==shop.id)return null;
  return session;
}
function platformSecret(){
  if(!process.env.PLATFORM_SESSION_SECRET) throw new Error('PLATFORM_SESSION_SECRET is not configured');
  return process.env.PLATFORM_SESSION_SECRET;
}
function platformSign(value){return crypto.createHmac('sha256',platformSecret()).update(value).digest('base64url');}
function makePlatformToken(){
  const payload=Buffer.from(JSON.stringify({v:1,role:'platform_owner',exp:Date.now()+MAX_AGE_SECONDS*1000})).toString('base64url');
  return `${payload}.${platformSign(payload)}`;
}
function verifyPlatform(req){
  try{
    const token=parseCookies(req)[PLATFORM_COOKIE];if(!token)return null;
    const [payload,sig]=token.split('.');if(!payload||!sig)return null;
    const expected=platformSign(payload);
    if(sig.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null;
    const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    if(data.role!=='platform_owner'||Number(data.exp)<=Date.now())return null;
    return data;
  }catch{return null;}
}
function cookieHeader(token){ return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SECONDS}`; }
function clearCookie(){ return `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`; }
function techCookieHeader(token){return `${TECH_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SECONDS}`;}
function clearTechCookie(){return `${TECH_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;}
function platformCookieHeader(token){return `${PLATFORM_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${MAX_AGE_SECONDS}`;}
function clearPlatformCookie(){return `${PLATFORM_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;}
function safeEqual(a,b){
  const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));
  return x.length===y.length && crypto.timingSafeEqual(x,y);
}
function hashPassword(value){const salt=crypto.randomBytes(16).toString('hex'),hash=crypto.scryptSync(String(value||''),salt,64).toString('hex');return `scrypt$${salt}$${hash}`;}
function verifyPassword(value,stored){try{const [kind,salt,expected]=String(stored||'').split('$');if(kind!=='scrypt'||!salt||!expected)return false;const actual=crypto.scryptSync(String(value||''),salt,64).toString('hex');return safeEqual(actual,expected)}catch{return false}}
module.exports={makeToken,makeAdminToken,makeTechToken,makePlatformToken,verify,verifyForShop,verifyTechForShop,verifyPlatform,cookieHeader,clearCookie,techCookieHeader,clearTechCookie,platformCookieHeader,clearPlatformCookie,safeEqual,hashPassword,verifyPassword};
