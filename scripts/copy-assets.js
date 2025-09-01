const fs=require('fs');const path=require('path');
function copyRecursive(src,dest){if(!fs.existsSync(src))return;fs.mkdirSync(dest,{recursive:true});for(const file of fs.readdirSync(src)){const s=path.join(src,file);const d=path.join(dest,file);if(fs.statSync(s).isDirectory())copyRecursive(s,d);else fs.copyFileSync(s,d);} }
try{copyRecursive('assets','dist/assets');if(fs.existsSync('favicon.svg'))fs.copyFileSync('favicon.svg','dist/favicon.svg');}catch(e){console.error('Asset copy failed',e);}
