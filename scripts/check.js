const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.cwd();
const JS_DIRS = ['api', 'scripts', 'admin', 'assets'];
const ROOT_JS = ['config.js', 'sw.js'];
const HTML_DIRS = ['admin', 'inspection'];

function walk(dir,ext){
  const full=path.join(ROOT,dir);
  if(!fs.existsSync(full)) return [];
  return fs.readdirSync(full,{withFileTypes:true}).flatMap(entry=>{
    const rel=path.join(dir,entry.name);
    if(entry.isDirectory()) return walk(rel,ext);
    return entry.isFile() && entry.name.endsWith(ext) ? [rel] : [];
  });
}
function checkScript(source,label){
  try{
    new vm.Script(source,{filename:label});
    console.log(`OK  ${label}`);
  }catch(err){
    failed=true;
    console.error(`FAIL ${label}`);
    console.error(err.stack||err.message||err);
  }
}

let failed=false;
const jsFiles=[...new Set([
  ...JS_DIRS.flatMap(dir=>walk(dir,'.js')),
  ...ROOT_JS.filter(file=>fs.existsSync(path.join(ROOT,file)))
])];
for(const file of jsFiles){
  checkScript(fs.readFileSync(path.join(ROOT,file),'utf8'),file);
}

for(const file of HTML_DIRS.flatMap(dir=>walk(dir,'.html'))){
  const html=fs.readFileSync(path.join(ROOT,file),'utf8');
  const re=/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match,index=0;
  while((match=re.exec(html))){
    const source=match[1].trim();
    if(!source) continue;
    index++;
    checkScript(source,`${file}#inline-script-${index}`);
  }
  if(index===0) console.log(`OK  ${file} (no inline scripts)`);
}

try{
  const vercel=JSON.parse(fs.readFileSync(path.join(ROOT,'vercel.json'),'utf8'));
  if(!vercel.buildCommand || !String(vercel.buildCommand).includes('npm run check')){
    throw new Error('vercel.json buildCommand must run npm run check before build');
  }
  console.log('OK  vercel.json');
}catch(err){
  failed=true;
  console.error('FAIL vercel.json');
  console.error(err.stack||err.message||err);
}

// Guard against the invoice autosave recursion that previously caused repeated POSTs.
try{
  const invoiceHtml=fs.readFileSync(path.join(ROOT,'admin','invoice','index.html'),'utf8');
  const core=fs.readFileSync(path.join(ROOT,'admin','invoice-core.js'),'utf8');
  if(!core.includes('lastSavedFingerprint') || !core.includes('state.inFlight')){
    throw new Error('invoice-core.js is missing deterministic autosave safeguards');
  }
  if(!invoiceHtml.includes("action='invoice-save'") && !invoiceHtml.includes("action=\"invoice-save\"") && !invoiceHtml.includes("'invoice-save'")){
    throw new Error('invoice page no longer contains the invoice save path');
  }
  console.log('OK  invoice autosave safeguards');
}catch(err){
  failed=true;
  console.error('FAIL invoice autosave safeguards');
  console.error(err.stack||err.message||err);
}

if(failed) process.exit(1);
console.log('Shop-Web validation passed.');
