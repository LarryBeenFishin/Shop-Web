const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createClient } = require('@supabase/supabase-js');

const CONFIG_PATH = path.join(process.cwd(), 'config.js');
const ADMIN_ASSET_LOADER = `\n(function loadSharedAdminAssets(){\n  if(typeof document==='undefined' || !String(location.pathname||'').startsWith('/admin')) return;\n  if(!document.querySelector('link[data-shop-admin-skin]')){\n    const link=document.createElement('link');\n    link.rel='stylesheet';\n    link.href='/admin/admin-redesign.css?v=3';\n    link.dataset.shopAdminSkin='true';\n    document.head.appendChild(link);\n  }\n  if(!document.querySelector('script[data-shop-appt-modal]')){\n    const script=document.createElement('script');\n    script.src='/admin/appointment-modal-redesign.js?v=1';\n    script.dataset.shopApptModal='true';\n    document.head.appendChild(script);\n  }\n})();\n`;

function readFallbackConfig(){
  const source=fs.readFileSync(CONFIG_PATH,'utf8');
  const sandbox={window:{}};
  vm.runInNewContext(source,sandbox,{filename:'config.js'});
  return sandbox.window.SHOP_CONFIG||{};
}

function isPlainObject(v){ return Boolean(v) && typeof v==='object' && !Array.isArray(v); }
function deepMerge(base, override){
  if(!isPlainObject(base) || !isPlainObject(override)) return override===undefined?base:override;
  const out={...base};
  for(const [key,value] of Object.entries(override)){
    out[key]=isPlainObject(value)&&isPlainObject(base[key]) ? deepMerge(base[key],value) : value;
  }
  return out;
}

async function main(){
  const fallback=readFallbackConfig();
  const slug=String(process.env.SHOP_SLUG||'').trim().toLowerCase();

  if(!slug){
    console.log('[shop-config] SHOP_SLUG not set; keeping repository fallback config.');
    return;
  }
  if(!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY){
    console.log('[shop-config] Supabase env vars missing; keeping repository fallback config.');
    return;
  }

  const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:shop,error}=await supabase.from('shops').select('slug,name,status,public_config').eq('slug',slug).maybeSingle();
  if(error){
    if(String(error.code)==='42P01'||String(error.code)==='PGRST205'){
      console.log('[shop-config] Tenant schema is not installed yet; keeping fallback config.');
      return;
    }
    throw error;
  }
  if(!shop) throw new Error(`[shop-config] Shop '${slug}' does not exist.`);
  if(shop.status!=='active') throw new Error(`[shop-config] Shop '${slug}' is not active.`);

  const merged=deepMerge(fallback,shop.public_config||{});
  merged.name=shop.name||merged.name;

  const output=`// Generated during the Vercel build for SHOP_SLUG=${slug}.\nwindow.SHOP_CONFIG = ${JSON.stringify(merged,null,2)};\n${ADMIN_ASSET_LOADER}`;
  fs.writeFileSync(CONFIG_PATH,output,'utf8');
  console.log(`[shop-config] Generated config.js for ${shop.name} (${slug}).`);
}

main().catch(err=>{
  console.error(err);
  process.exit(1);
});
