import {pressureShaders} from './shaders.js?v=5316305f3032d241';
import {PyroSolver} from './solver.js?v=5316305f3032d241';
// Manufactured solution checks the actual GPU kernels and mixed boundaries.
export async function pressureCheck(device){
 const n=32,count=n**3,index=(x,y,z)=>x+n*(y+n*z);
 const expected=new Float32Array(count),rhs=new Float32Array(count);
 for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++)expected[index(x,y,z)]=Math.sin(Math.PI*(x+.5)/n)*Math.cos(Math.PI*(y+.5)/(2*n))*Math.sin(Math.PI*(z+.5)/n)+.2*Math.sin(5*Math.PI*(x+.5)/n)*Math.cos(3*Math.PI*(y+.5)/(2*n))*Math.sin(3*Math.PI*(z+.5)/n);
 function at(a,x,y,z){const sign=(x<0||x>=n?-1:1)*(y>=n?-1:1)*(z<0||z>=n?-1:1);return sign*a[index(Math.max(0,Math.min(n-1,x)),Math.max(0,Math.min(n-1,y)),Math.max(0,Math.min(n-1,z)))];}
 function op(a,x,y,z){return 6*at(a,x,y,z)-at(a,x-1,y,z)-at(a,x+1,y,z)-at(a,x,y-1,z)-at(a,x,y+1,z)-at(a,x,y,z-1)-at(a,x,y,z+1);}
 for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++)rhs[index(x,y,z)]=op(expected,x,y,z);
 const test=Object.create(PyroSolver.prototype);Object.assign(test,{device,cache:new Map(),ids:new WeakMap(),nextId:0,levels:[]});const textures=[];
 const texture=size=>{const t=device.createTexture({size:[size,size,size],dimension:'3d',format:'r32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC});textures.push(t);return {t,view:t.createView()};};
 let read;
 try{
 for(let size=n;size>=4;size/=2){const level={n:size,p:[texture(size),texture(size)],b:texture(size),current:0,kernels:{}};for(const [name,code]of Object.entries(pressureShaders(size)))level.kernels[name]=await test.pipeline(code,'pressure-'+name+'-'+size);test.levels.push(level);}
 device.queue.writeTexture({texture:test.levels[0].b.t},rhs,{bytesPerRow:n*4,rowsPerImage:n},[n,n,n]);
 const encoder=device.createCommandEncoder();for(let i=0;i<10;i++)test.vcycle(encoder);
 const row=256;read=device.createBuffer({size:row*n*n,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const fine=test.levels[0];encoder.copyTextureToBuffer({texture:fine.p[fine.current].t},{buffer:read,bytesPerRow:row,rowsPerImage:n},[n,n,n]);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
 const raw=new Float32Array(read.getMappedRange()),actual=new Float32Array(count);for(let z=0;z<n;z++)for(let y=0;y<n;y++)actual.set(raw.subarray((z*n+y)*64,(z*n+y)*64+n),index(0,y,z));read.unmap();
 let err=0,norm=0,residual=0,source=0;for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){const i=index(x,y,z);err+=(actual[i]-expected[i])**2;norm+=expected[i]**2;residual+=Math.abs(rhs[i]-op(actual,x,y,z));source+=Math.abs(rhs[i]);}
 const relativeL2=Math.sqrt(err/norm),relativeResidualL1=residual/source;return {grid:n,cycles:10,relativeL2,relativeResidualL1,pass:relativeL2<.003&&relativeResidualL1<.003};
 }finally{read?.destroy();for(const t of textures)t.destroy();}
}
