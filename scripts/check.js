const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.cwd();
const JS_DIRS = ['api', 'scripts'];
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
for(const file of JS_DIRS.flatMap(dir=>walk(dir,'.js'))){
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
  JSON.parse(fs.readFileSync(path.join(ROOT,'vercel.json'),'utf8'));
  console.log('OK  vercel.json');
}catch(err){
  failed=true;
  console.error('FAIL vercel.json');
  console.error(err.stack||err.message||err);
}

if(failed) process.exit(1);
console.log('Shop-Web validation passed.');
