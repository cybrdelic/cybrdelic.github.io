// CPU input queue only. The engines retain and burn inventory on the GPU.
export function floorHit(eye,ray,{minX=-3,maxX=3,minZ=-3,maxZ=3,y=.018}={}){
  if(!eye||!ray||eye.length!==3||ray.length!==3||![...eye,...ray,minX,maxX,minZ,maxZ,y].every(Number.isFinite))return null;
  if(minX>=maxX||minZ>=maxZ||ray[1]>=-1e-8)return null;
  const t=(y-eye[1])/ray[1];if(t<=0)return null;
  const x=eye[0]+ray[0]*t,z=eye[2]+ray[2]*t;
  return x<minX||x>maxX||z<minZ||z>maxZ?null:[x,z];
}

// Rounding to binary16 once at upload keeps repeated input accumulation in f32.
const bitsF32=new Float32Array(1),bitsU32=new Uint32Array(bitsF32.buffer);
export function fuelHalf(value){
  bitsF32[0]=Math.max(0,Math.min(4,value));const bits=bitsU32[0],exponent=((bits>>>23)&255)-127+15;
  const mantissa=bits&0x7fffff;
  if(exponent<=0){if(exponent<-10)return 0;const m=mantissa|0x800000,shift=14-exponent,base=m>>>shift,rest=m&((1<<shift)-1),tie=1<<(shift-1);return base+(rest>tie||(rest===tie&&(base&1))?1:0);}
  let half=(exponent<<10)|(mantissa>>>13),rest=mantissa&8191;if(rest>4096||(rest===4096&&(half&1)))half++;return half;
}

export class FuelBrush{
  constructor({width=128,height=128,minX=-3,maxX=3,minZ=-3,maxZ=3,radius=.22,amount=.65}={}){
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>2048||height>2048||
      ![minX,maxX,minZ,maxZ,radius,amount].every(Number.isFinite)||minX>=maxX||minZ>=maxZ||radius<=0||amount<0)throw Error('Invalid fuel brush domain');
    Object.assign(this,{width,height,minX,maxX,minZ,maxZ,radius,amount});
    this.pending=new Float32Array(width*height);this.dirty=new Set();
  }
  valid(x,z){return Number.isFinite(x)&&Number.isFinite(z)&&x>=this.minX&&x<=this.maxX&&z>=this.minZ&&z<=this.maxZ;}
  stamp(x,z,weight=1){
    if(!this.valid(x,z)||!Number.isFinite(weight)||weight<=0||this.amount===0)return false;
    const sx=this.width/(this.maxX-this.minX),sz=this.height/(this.maxZ-this.minZ),r=this.radius;
    const x0=Math.max(0,Math.ceil((x-r-this.minX)*sx-.5)),x1=Math.min(this.width-1,Math.floor((x+r-this.minX)*sx-.5));
    const z0=Math.max(0,Math.ceil((z-r-this.minZ)*sz-.5)),z1=Math.min(this.height-1,Math.floor((z+r-this.minZ)*sz-.5));
    let changed=false;
    for(let j=z0;j<=z1;j++)for(let i=x0;i<=x1;i++){
      const dx=(this.minX+(i+.5)/sx-x)/r,dz=(this.minZ+(j+.5)/sz-z)/r,q=dx*dx+dz*dz;
      if(q>=1)continue;const k=j*this.width+i;
      // Compact C1 radial footprint, additive and capped at the GPU's mass bound.
      this.pending[k]=Math.min(4,this.pending[k]+this.amount*weight*(1-q)*(1-q));this.dirty.add(k);changed=true;
    }
    return changed;
  }
  stroke(from,to){
    if(!from||!to||from.length!==2||to.length!==2||!this.valid(...from)||!this.valid(...to))return false;
    const distance=Math.hypot(to[0]-from[0],to[1]-from[1]);if(distance<1e-8)return false;
    const n=Math.max(1,Math.ceil(distance/(this.radius*.4))),weight=distance/(n*this.radius*.4);
    let changed=false;
    // Midpoint quadrature yields a continuous line whose mass depends on world
    // distance, not pointer-event count. Pointerdown adds the separate click dose.
    for(let i=0;i<n;i++){const t=(i+.5)/n;changed=this.stamp(from[0]+(to[0]-from[0])*t,from[1]+(to[1]-from[1])*t,weight)||changed;}
    return changed;
  }
  consume(){
    if(!this.dirty.size)return null;
    const data=new Uint16Array(this.width*this.height);
    for(const i of this.dirty){data[i]=fuelHalf(this.pending[i]);this.pending[i]=0;}
    this.dirty.clear();return {data,width:this.width,height:this.height};
  }
  clear(){for(const i of this.dirty)this.pending[i]=0;this.dirty.clear();}
}

// Shared constants/reference for lifecycle fixtures; matching GPU equations use
// the previous chemistry field and conserve released gas against surface mass.
export function groundFuelStep({fuel=0,heat=0,char=0},incoming,deposit,dt,ignite=false,combustionEnabled=true){
  if(![fuel,heat,char,incoming,deposit,dt].every(Number.isFinite)||dt<=0)throw Error('Invalid ground step');
  fuel=Math.min(4,Math.max(0,fuel)+Math.max(0,deposit));
  heat=Math.max(0,heat+(Math.max(0,incoming)-heat)*(1-Math.exp(-8*dt)))*Math.exp(-.22*dt);
  if(ignite&&fuel>0&&combustionEnabled)heat+=1.2;
  const t=Math.max(0,Math.min(1,(heat-.32)/(.65-.32))),activation=t*t*(3-2*t);
  const burned=combustionEnabled?Math.min(fuel,fuel*activation*1.3*dt):0;
  return {fuel:fuel-burned,heat,release:burned/dt,char:Math.min(4,char+burned)};
}
export function groundVaporProfile(y){return y<0||y>.24?0:Math.exp(-y/.055)/(.055*(1-Math.exp(-.24/.055)));}
