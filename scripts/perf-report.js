const fs=require('fs');
try{const report=JSON.parse(fs.readFileSync('lighthouse-report.json','utf8'));const cat=report.categories;console.log('\nPERF');['performance','accessibility','best-practices','seo'].forEach(k=>{if(cat[k])console.log(k+':',Math.round(cat[k].score*100)+'%');});}catch(e){console.log('No lighthouse-report.json');}
