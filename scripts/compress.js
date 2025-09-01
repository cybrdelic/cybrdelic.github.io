const fs=require('fs');const zlib=require('zlib');
try{const input=fs.readFileSync('dist/index.html');const gz=zlib.gzipSync(input);fs.writeFileSync('dist/index.html.gz',gz);console.log('Gzipped:',(input.length/1024).toFixed(1)+'KB ->',(gz.length/1024).toFixed(1)+'KB');}catch(e){console.error('Compression failed',e);process.exit(1);}
