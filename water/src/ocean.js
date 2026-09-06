import {FFT} from './fft.js';
import {G,TAU,dispersion,groupVelocity,mulberry32,gaussian,clamp} from './math.js';
/**
 * Band-limited, seeded Tessendorf ocean with finite-depth gravity-wave dispersion.
 * JONSWAP is a statistical sea-state model, not a nonlinear free-surface solver.
 * Three nonoverlapping k-bands avoid counting spectral energy multiple times.
 * The horizontal displacement and foam birth are explicitly visual closures.
 */
function jonswap(omega,period,gamma=3.3){if(omega<1e-5)return 0;const peak=TAU/period,sigma=omega<=peak?.07:.09,r=Math.exp(-.5*((omega-peak)/(sigma*peak))**2);return G*G*Math.pow(omega,-5)*Math.exp(-1.25*Math.pow(peak/omega,4))*Math.pow(gamma,r);}
function spreading(theta,wind,s=8){return Math.exp(s*(Math.cos(theta-wind)-1));}
export class SpectralCascade {
 constructor({n=128,length,minWave,maxWave,seed,depth,period,direction,chop}){
  this.n=n;this.length=length;this.dx=length/n;this.depth=depth;this.chop=chop;this.fft=new FFT(n);const count=n*n;
  for(const key of ['h0r','h0i','omega','kx','kz','invk','hr','hi','xr','xi','zr','zi','foam','nextFoam','previousHeight','velocity'])this[key]=new Float32Array(count);
  this.displacement=new Float32Array(count*4);this.derivativeX=new Float32Array(count*4);this.derivativeZ=new Float32Array(count*4);
  const rng=mulberry32(seed),dk=TAU/length;this.expectedVariance=0;
  for(let z=0;z<n;z++)for(let x=0;x<n;x++){
   const i=z*n+x,kx=(x<=n/2?x:x-n)*dk,kz=(z<=n/2?z:z-n)*dk,k=Math.hypot(kx,kz),lambda=TAU/(k||1e-12);
   this.kx[i]=kx;this.kz[i]=kz;this.invk[i]=k>0?1/k:0;this.omega[i]=dispersion(k,depth);
   // Exclude Nyquist axes: odd spectral derivatives must be zero at self-conjugate modes.
   if(k===0||x===n/2||z===n/2||lambda<minWave||lambda>=maxWave)continue;
   const theta=Math.atan2(kz,kx),w=this.omega[i];
   const swell=jonswap(w,period,3.3)*spreading(theta,direction,12);
   const wind=.55*jonswap(w,period*.55,1.35)*spreading(theta,direction+.24,3);
   const power=(swell+wind)*groupVelocity(k,depth)/k*dk*dk;
   const a=Math.sqrt(power*.25);this.h0r[i]=gaussian(rng)*a;this.h0i[i]=gaussian(rng)*a;this.expectedVariance+=power;
  }
  this.lastTime=null;
 }
 scale(s){for(let i=0;i<this.h0r.length;i++){this.h0r[i]*=s;this.h0i[i]*=s;}this.expectedVariance*=s*s;}
 evolve(t,dt=1/30,{foamThreshold=.48,foamGain=1,drift=[.14,.03]}={}){
  const n=this.n,N=n*n,mask=n-1,coef=N;
  for(let z=0;z<n;z++)for(let x=0;x<n;x++){
   const i=z*n+x,j=((n-z)&mask)*n+((n-x)&mask),wt=this.omega[i]*t,c=Math.cos(wt),s=Math.sin(wt);
   const hr=((this.h0r[i]+this.h0r[j])*c+(this.h0i[i]+this.h0i[j])*s)*coef;
   const hi=((this.h0i[i]-this.h0i[j])*c+(this.h0r[j]-this.h0r[i])*s)*coef;
   this.hr[i]=hr;this.hi[i]=hi;
   const q=this.chop*this.invk[i];this.xr[i]=-this.kx[i]*q*hi;this.xi[i]=this.kx[i]*q*hr;this.zr[i]=-this.kz[i]*q*hi;this.zi[i]=this.kz[i]*q*hr;
  }
  this.fft.transform2D(this.hr,this.hi);this.fft.transform2D(this.xr,this.xi);this.fft.transform2D(this.zr,this.zi);
  const inv2dx=.5/this.dx,decay=Math.exp(-Math.max(0,dt)/5.5),birth=1-Math.exp(-Math.max(0,dt)*2.6),du=drift[0]*dt/this.dx,dv=drift[1]*dt/this.dx;
  let mean=0,sq=0,min=Infinity,max=-Infinity,minJ=Infinity,maxImag=0,totalFoam=0;
  for(let z=0;z<n;z++)for(let x=0;x<n;x++){
   const i=z*n+x,o=i*4,xp=z*n+((x+1)&mask),xm=z*n+((x-1)&mask),zp=((z+1)&mask)*n+x,zm=((z-1)&mask)*n+x;
   const hx=(this.hr[xp]-this.hr[xm])*inv2dx,hz=(this.hr[zp]-this.hr[zm])*inv2dx;
   const dxx=(this.xr[xp]-this.xr[xm])*inv2dx,dxz=(this.xr[zp]-this.xr[zm])*inv2dx,dzx=(this.zr[xp]-this.zr[xm])*inv2dx,dzz=(this.zr[zp]-this.zr[zm])*inv2dx;
   const jac=(1+dxx)*(1+dzz)-dxz*dzx,source=clamp((foamThreshold-jac)*2.8,0,1)*foamGain;
   const px=x-du,pz=z-dv,ix=Math.floor(px),iz=Math.floor(pz),fx=px-ix,fz=pz-iz;
   const f00=this.foam[(iz&mask)*n+(ix&mask)],f10=this.foam[(iz&mask)*n+((ix+1)&mask)],f01=this.foam[((iz+1)&mask)*n+(ix&mask)],f11=this.foam[((iz+1)&mask)*n+((ix+1)&mask)];
   const adv=(f00*(1-fx)+f10*fx)*(1-fz)+(f01*(1-fx)+f11*fx)*fz;
   const foam=clamp(adv*decay+source*birth,0,1);this.nextFoam[i]=foam;totalFoam+=foam;
   this.displacement[o]=this.xr[i];this.displacement[o+1]=this.hr[i];this.displacement[o+2]=this.zr[i];this.displacement[o+3]=foam;
   this.derivativeX[o]=dxx;this.derivativeX[o+1]=hx;this.derivativeX[o+2]=dzx;this.derivativeX[o+3]=jac;
   this.derivativeZ[o]=dxz;this.derivativeZ[o+1]=hz;this.derivativeZ[o+2]=dzz;this.derivativeZ[o+3]=0;
   this.velocity[i]=this.lastTime===null||dt<=0?0:(this.hr[i]-this.previousHeight[i])/dt;this.previousHeight[i]=this.hr[i];
   mean+=this.hr[i];sq+=this.hr[i]**2;min=Math.min(min,this.hr[i]);max=Math.max(max,this.hr[i]);minJ=Math.min(minJ,jac);maxImag=Math.max(maxImag,Math.abs(this.hi[i]));
  }
  [this.foam,this.nextFoam]=[this.nextFoam,this.foam];this.lastTime=t;
  this.stats={mean:mean/N,rms:Math.sqrt(sq/N),min,max,minJacobian:minJ,imaginaryResidual:maxImag,foamMean:totalFoam/N};
 }
 sample(qx,qz){const n=this.n,mask=n-1,px=qx/this.length*n,pz=qz/this.length*n,ix=Math.floor(px),iz=Math.floor(pz),fx=px-ix,fz=pz-iz,out=[0,0,0,0];for(let z=0;z<2;z++)for(let x=0;x<2;x++){const i=(((iz+z)&mask)*n+((ix+x)&mask))*4,w=(x?fx:1-fx)*(z?fz:1-fz);for(let c=0;c<4;c++)out[c]+=this.displacement[i+c]*w;}return out;}
}
export const PRESETS={
 dawn:{name:'First light',subtitle:'Long-period swell · open water',hs:2.7,period:8.2,direction:-.5,chop:1.0,depth:180,sky:'dawn',exposure:1.05,sun:[-.72,.082,-.69],water:[.006,.026,.033],foamThreshold:.50,foamGain:.6,roughness:.065,wind:8},
 blue:{name:'Blue water',subtitle:'Crossing wave trains · clear water',hs:3.4,period:7.4,direction:-.25,chop:1.12,depth:22,sky:'blue',exposure:1,sun:[-.4,.48,-.78],water:[.006,.035,.044],foamThreshold:.54,foamGain:.9,roughness:.085,wind:11},
 storm:{name:'Heavy weather',subtitle:'Wind sea · persistent whitecaps',hs:6.8,period:9.4,direction:-.38,chop:1.22,depth:300,sky:'storm',exposure:1.1,sun:[-.6,.20,-.77],water:[.012,.030,.033],foamThreshold:.60,foamGain:1.4,roughness:.13,wind:19},
};
export class Ocean {
 constructor(preset='dawn',n=128){this.n=n;this.reset(preset);}
 reset(preset){this.preset=typeof preset==='string'?{...PRESETS[preset]}:{...preset};const p=this.preset;this.cascades=[{length:768,minWave:16,maxWave:769},{length:96,minWave:2,maxWave:16},{length:12,minWave:.25,maxWave:2}].map((c,i)=>new SpectralCascade({...c,n:this.n,seed:91317+i*5989,depth:p.depth,period:p.period,direction:p.direction,chop:p.chop}));const variance=this.cascades.reduce((a,c)=>a+c.expectedVariance,0),s=(p.hs/4)/Math.sqrt(variance);this.cascades.forEach(c=>c.scale(s));this.time=0;this.step(0,0);}
 step(t,dt){this.time=t;const p=this.preset;for(const c of this.cascades)c.evolve(t,dt,{foamThreshold:p.foamThreshold,foamGain:p.foamGain,drift:[p.wind*.015*Math.cos(p.direction),p.wind*.015*Math.sin(p.direction)]});}
 sample(x,z){let qx=x,qz=z;for(let j=0;j<4;j++){let dx=0,dz=0;for(const c of this.cascades){const v=c.sample(qx,qz);dx+=v[0];dz+=v[2];}qx=x-dx;qz=z-dz;}let h=0;for(const c of this.cascades)h+=c.sample(qx,qz)[1];return h;}
 diagnostics(){const s=this.cascades.map(c=>c.stats);return {model:'Linear finite-depth JONSWAP/Tessendorf ocean; choppy geometry + heuristic advected foam',time:this.time,grid:this.n,cascades:s,meanHeight:s.reduce((a,c)=>a+c.mean,0),targetHs:this.preset.hs,estimateHs:4*Math.sqrt(s.reduce((a,c)=>a+c.rms*c.rms,0)),minJacobian:Math.min(...s.map(c=>c.minJacobian)),maxImaginaryResidual:Math.max(...s.map(c=>c.imaginaryResidual))};}
}
