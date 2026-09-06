import { G,TAU,dispersion,groupVelocity,mulberry32,gaussian } from './math.js';
import { FFT } from './fft.js';
export const BANDS = [{length:768,minWave:16,maxWave:769},{length:96,minWave:2,maxWave:16},{length:12,minWave:.25,maxWave:2}];
/** Reproducible JONSWAP coefficients. All units are metres and seconds.
 * k-bands do not overlap; horizontal displacement is an explicit choppy closure.
 * CPU reference and GPU evolution consume the identical initial coefficients.
 */
export class Spectrum {
  constructor(n,preset,seed=91317){
    this.n=n;this.preset=preset;this.seed=seed;this.expectedVariance=0;
    this.bands=BANDS.map((band,index)=>{
      const h0=new Float32Array(n*n*4),rng=mulberry32(seed+5989*index);let variance=0;
      for(let z=0;z<n;z++) for(let x=0;x<n;x++){
        const kx=(x<=n/2?x:x-n)*TAU/band.length,kz=(z<=n/2?z:z-n)*TAU/band.length;
        const k=Math.hypot(kx,kz),wl=TAU/(k||1e-12),omega=dispersion(k,preset.depth),i=4*(z*n+x);
        h0[i+2]=omega;h0[i+3]=k;
        if(k===0||x===n/2||z===n/2||wl<band.minWave||wl>=band.maxWave)continue;
        const theta=Math.atan2(kz,kx),spec=(period,gamma)=>{
          const wp=TAU/period,ss=omega<=wp?.07:.09,r=Math.exp(-.5*((omega-wp)/(ss*wp))**2);
          return G*G*omega**-5*Math.exp(-1.25*(wp/omega)**4)*gamma**r;
        };
        const directional=(angle,power)=>Math.exp(power*(Math.cos(theta-angle)-1));
        const power=(spec(preset.period,3.3)*directional(preset.direction,12)+.55*spec(preset.period*.55,1.35)*directional(preset.direction+.24,3))*groupVelocity(k,preset.depth)/k*(TAU/band.length)**2;
        h0[i]=gaussian(rng)*Math.sqrt(power*.25);h0[i+1]=gaussian(rng)*Math.sqrt(power*.25);variance+=power;
      }
      this.expectedVariance+=variance;return {...band,h0,variance};
    });
    const scale=preset.hs/4/Math.sqrt(this.expectedVariance||1);
    for(const b of this.bands)for(let i=0;i<b.h0.length;i+=4){b.h0[i]*=scale;b.h0[i+1]*=scale;}
    this.expectedVariance*=scale*scale;
  }
  /** Exact spatial and temporal spectral derivatives, not a finite-difference approximation. */
  reference(t,bandIndex=0){
    const b=this.bands[bandIndex],n=this.n,N=n*n,mask=n-1,fft=new FFT(n);
    const fields={};for(const name of ['h','x','z','hx','hz','xx','xz','zz','vx','vy','vz'])fields[name]={r:new Float32Array(N),i:new Float32Array(N)};
    const put=(name,j,r,i)=>{fields[name].r[j]=r*N;fields[name].i[j]=i*N;};
    for(let z=0;z<n;z++)for(let x=0;x<n;x++){
      const i=z*n+x,j=((n-z)&mask)*n+((n-x)&mask),a=i*4,q=j*4,w=b.h0[a+2],k=b.h0[a+3];
      const c=Math.cos(w*t),s=Math.sin(w*t),ar=b.h0[a],ai=b.h0[a+1],br=b.h0[q],bi=b.h0[q+1];
      const r=(ar+br)*c+(ai+bi)*s,im=(ai-bi)*c+(br-ar)*s;
      const vr=w*(-(ar+br)*s+(ai+bi)*c),vi=w*(-(ai-bi)*s+(br-ar)*c);
      const kx=(x<=n/2?x:x-n)*TAU/b.length,kz=(z<=n/2?z:z-n)*TAU/b.length,cp=this.preset.chop/(k||1);
      put('h',i,r,im);put('x',i,-kx*cp*im,kx*cp*r);put('z',i,-kz*cp*im,kz*cp*r);
      put('hx',i,-kx*im,kx*r);put('hz',i,-kz*im,kz*r);
      put('xx',i,-kx*kx*cp*r,-kx*kx*cp*im);put('xz',i,-kx*kz*cp*r,-kx*kz*cp*im);put('zz',i,-kz*kz*cp*r,-kz*kz*cp*im);
      put('vx',i,-kx*cp*vi,kx*cp*vr);put('vy',i,vr,vi);put('vz',i,-kz*cp*vi,kz*cp*vr);
    }
    for(const f of Object.values(fields))fft.transform2D(f.r,f.i);
    return fields;
  }
}
