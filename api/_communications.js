const { Resend } = require('resend');
const twilio = require('twilio');

function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function originFor(req){
  const proto=String(req.headers['x-forwarded-proto']||'https').split(',')[0].trim();
  const host=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim();
  return `${proto}://${host}`;
}
function fromFor(shop){
  const name=shop?.name||process.env.SHOP_NAME||'Shop-Web';
  return shop?.resend_from_email||process.env.RESEND_FROM_EMAIL||`${name} <onboarding@resend.dev>`;
}
async function sendEmail(shop,message){
  if(!process.env.RESEND_API_KEY)throw new Error('Email delivery is not configured');
  const resend=new Resend(process.env.RESEND_API_KEY);
  return resend.emails.send({from:fromFor(shop),...message});
}
async function sendSms(shop,{to,body}){
  const sid=process.env.TWILIO_ACCOUNT_SID,token=process.env.TWILIO_AUTH_TOKEN;
  const from=shop?.twilio_phone_number||process.env.TWILIO_PHONE_NUMBER;
  if(!sid||!token||!from)throw new Error('Text delivery is not configured');
  const digits=String(to||'').replace(/\D/g,'');
  const destination=digits.length===10?`+1${digits}`:digits.length===11&&digits.startsWith('1')?`+${digits}`:String(to||'').trim();
  return twilio(sid,token).messages.create({from,to:destination,body});
}
function resetEmailHtml({name,shopName,url,minutes=20}){
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#172033"><h2>Reset your ${esc(shopName)} password</h2><p>Hi ${esc(name||'there')},</p><p>Use the button below to choose a new password. This link expires in ${minutes} minutes and can only be used once.</p><p style="margin:28px 0"><a href="${esc(url)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:13px 20px;border-radius:10px;font-weight:700">Reset password</a></p><p>If you did not request this, you can ignore this email. Your password will not change.</p><p style="font-size:12px;color:#64748b;word-break:break-all">${esc(url)}</p></div>`;
}

module.exports={esc,originFor,fromFor,sendEmail,sendSms,resetEmailHtml};
