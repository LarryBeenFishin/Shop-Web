const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.cwd();
const TARGET_DIRS = ['api', 'scripts'];

function walk(dir){
  const full=path.join(ROOT,dir);
  if(!fs.existsSync(full)) return [];
  return fs.readdirSync(full,{withFileTypes:true}).flatMap(entry=>{
    const rel=path.join(dir,entry.name);
    if(entry.isDirectory()) return walk(rel);
    return entry.isFile() && entry.name.endsWith('.js') ? [rel] : [];
  });
}

let failed=false;
for(const file of TARGET_DIRS.flatMap(walk)){
  try{
    const source=fs.readFileSync(path.join(ROOT,file),'utf8');
    new vm.Script(source,{filename:file});
    console.log(`OK  ${file}`);
  }catch(err){
    failed=true;
    console.error(`FAIL ${file}`);
    console.error(err.stack||err.message||err);
  }
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
