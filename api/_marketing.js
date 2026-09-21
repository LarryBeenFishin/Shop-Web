const crypto=require('crypto');

function secret(){return process.env.MARKETING_UNSUBSCRIBE_SECRET||process.env.ADMIN_SESSION_SECRET||process.env.PLATFORM_SESSION_SECRET||''}
function signature(shopId,customerId){return crypto.createHmac('sha256',secret()).update(`${shopId}:${customerId}`).digest('hex')}
function unsubscribeToken(shopId,customerId){
  if(!secret())throw new Error('MARKETING_UNSUBSCRIBE_SECRET or ADMIN_SESSION_SECRET is required');
  return Buffer.from(JSON.stringify({s:shopId,c:customerId,h:signature(shopId,customerId)})).toString('base64url');
}
function readUnsubscribeToken(token){
  if(!secret())return null;
  try{
    const data=JSON.parse(Buffer.from(String(token||''),'base64url').toString('utf8'));
    const expected=signature(data.s,data.c),actual=String(data.h||'');
    if(expected.length!==actual.length||!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(actual)))return null;
    return {shopId:data.s,customerId:data.c};
  }catch{return null}
}
module.exports={unsubscribeToken,readUnsubscribeToken};
