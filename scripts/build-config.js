const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createClient } = require('@supabase/supabase-js');

const CONFIG_PATH = path.join(process.cwd(), 'config.js');
const ADMIN_ASSET_LOADER = `
(function loadSharedAdminAssets(){
  const path=typeof location==='undefined'?'':String(location.pathname||'');
  if(typeof document==='undefined' || !path.startsWith('/admin')) return;
  function js(key,src){
    if(document.querySelector('script['+key+']'))return;
    const x=document.createElement('script');x.src=src;x.setAttribute(key,'true');document.head.appendChild(x);
  }
  function css(key,src){
    if(document.querySelector('link['+key+']'))return;
    const x=document.createElement('link');x.rel='stylesheet';x.href=src;x.setAttribute(key,'true');document.head.appendChild(x);
  }
  if(path.startsWith('/admin/invoice')){
    js('data-shop-invoice-core','/admin/invoice-core.js?v=3');
    js('data-shop-invoice-suite','/admin/invoice-suite.js?v=1');
    return;
  }
  if(window.SKIP_SHARED_ADMIN_ASSETS) return;
  css('data-shop-admin-skin','/admin/admin-redesign.css?v=3');
  css('data-shop-status-skin','/admin/status-hidden.css?v=1');
  js('data-shop-shared-header','/admin/shared-header.js?v=2');
  js('data-shop-vehicle-data','/assets/vehicle-data.js?v=1');
  js('data-shop-appt-modal','/admin/appointment-modal-redesign.js?v=1');
  js('data-shop-new-appt','/admin/new-appointment-enhancements.js?v=2');
  js('data-shop-invoice-link','/admin/invoice-link.js?v=1');
})();
`;

function readFallbackConfig(){
  const source=fs.readFileSync(CONFIG_PATH,'utf8');
  const sandbox={window:{}};
  vm.runInNewContext(source,sandbox,{filename:'config.js'});
  return sandbox.window.SHOP_CONFIG||{};
}
function isPlainObject(v){return Boolean(v)&&typeof v==='object'&&!Array.isArray(v)}
function deepMerge(base,override){
  if(!isPlainObject(base)||!isPlainObject(override))return override===undefined?base:override;
  const out={...base};
  for(const [key,value] of Object.entries(override))out[key]=isPlainObject(value)&&isPlainObject(base[key])?deepMerge(base[key],value):value;
  return out;
}
function generatedConfigSource(config,slug='test-shop'){
  return `// Generated during the Vercel build for SHOP_SLUG=${slug}.\nwindow.SHOP_CONFIG = ${JSON.stringify(config,null,2)};\n${ADMIN_ASSET_LOADER}`;
}
async function main(){
  const fallback=readFallbackConfig();
  const slug=String(process.env.SHOP_SLUG||'').trim().toLowerCase();
  if(!slug){console.log('[shop-config] SHOP_SLUG not set; keeping repository fallback config.');return;}
  if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY){console.log('[shop-config] Supabase env vars missing; keeping repository fallback config.');return;}
  const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:shop,error}=await supabase.from('shops').select('slug,name,status,public_config').eq('slug',slug).maybeSingle();
  if(error){if(String(error.code)==='42P01'||String(error.code)==='PGRST205'){console.log('[shop-config] Tenant schema is not installed yet; keeping fallback config.');return;}throw error;}
  if(!shop)throw new Error(`[shop-config] Shop '${slug}' does not exist.`);
  if(shop.status!=='active')throw new Error(`[shop-config] Shop '${slug}' is not active.`);
  const merged=deepMerge(fallback,shop.public_config||{});merged.name=shop.name||merged.name;
  fs.writeFileSync(CONFIG_PATH,generatedConfigSource(merged,slug),'utf8');
  console.log(`[shop-config] Generated config.js for ${shop.name} (${slug}).`);
}

if(require.main===module){
  main().catch(err=>{console.error(err);process.exit(1)});
}

module.exports={ADMIN_ASSET_LOADER,deepMerge,generatedConfigSource,readFallbackConfig};
