const webpush = require('web-push');

function pushConfigured(){
  return Boolean(process.env.VAPID_SUBJECT && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

async function sendShopPush(supabase, shop, payload={}){
  if(!shop?.id || !pushConfigured()) return {sent:0,failed:0,skipped:true};
  webpush.setVapidDetails(process.env.VAPID_SUBJECT,process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
  const {data,error}=await supabase.from('push_subscriptions').select('id,subscription').eq('shop_id',shop.id);
  if(error) throw error;
  const body=JSON.stringify({
    title:payload.title||shop.name||'Shop Admin',
    body:payload.body||'New notification',
    url:payload.url||'/admin',
    tag:payload.tag||undefined
  });
  const rows=data||[];
  const results=await Promise.allSettled(rows.map(row=>webpush.sendNotification(row.subscription,body)));
  const stale=[];
  results.forEach((result,index)=>{
    if(result.status==='rejected'){
      const code=result.reason?.statusCode;
      if(code===404||code===410) stale.push(rows[index].id);
    }
  });
  if(stale.length) await supabase.from('push_subscriptions').delete().eq('shop_id',shop.id).in('id',stale).catch(()=>{});
  return {
    sent:results.filter(r=>r.status==='fulfilled').length,
    failed:results.filter(r=>r.status==='rejected').length,
    skipped:false
  };
}

module.exports={sendShopPush,pushConfigured};
