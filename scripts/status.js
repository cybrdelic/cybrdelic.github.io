const fs=require('fs');
console.log('\nSTATUS');
try{const size=fs.statSync('index.html').size;console.log('Template:',(size/1024).toFixed(1)+'KB');}catch{console.log('Template missing');}
try{const size=fs.statSync('dist/index.html').size;console.log('Built:',(size/1024).toFixed(1)+'KB');}catch{console.log('Built file missing');}
