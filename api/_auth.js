const crypto = require('crypto');
const COOKIE = 'shop_admin';
const MAX_AGE_SECONDS = 60 * 60 * 8;
function secret(){ if(!process.env.ADMIN_SESSION_SECRET) throw new Error('ADMIN_SESSION_SECRET is not configured'); return process.env.ADMIN_SESSION_SECRET; }
function sign(value){ return crypto.createHmac('sha256',secret()).update(value).digest('base64url'); }
function makeToken(){ const payload=Buffer.from(JSON.stringify({exp:Date.now()+MAX_AGE_SECONDS*1000})).toString('base64url'); return `${payload}.${sign(payload)}`; }
function parseCookies(req){ return String(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(Boolean).reduce((a,v)=>{const i=v.indexOf('=');if(i>0)a[v.slice(0,i)]=decodeURIComponent(v.slice(i+1));return a},{}); }
function verify(req){ try{const token=parseCookies(req)[COOKIE];if(!token)return false;const [payload,sig]=token.split('.');if(!payload||!sig)return false;const expected=sign(payload);if(sig.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return false;const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));return Number(data.exp)>Date.now()}catch{return false} }
function cookieHeader(token){ return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SECONDS}`; }
function clearCookie(){ return `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`; }
function safeEqual(a,b){ const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||'')); return x.length===y.length && crypto.timingSafeEqual(x,y); }
module.exports={makeToken,verify,cookieHeader,clearCookie,safeEqual};
