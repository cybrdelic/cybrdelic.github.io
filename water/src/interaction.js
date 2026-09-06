import {G,clamp,mulberry32} from './math.js';
/** Local, linear shallow-water interaction patch. It is NOT bidirectionally coupled CFD.
 * Staggered finite-volume height/velocity update; CFL-controlled fixed substeps.
 * The sponge intentionally absorbs outgoing wave energy near the patch boundary.
 */
export class RippleField {
 constructor(n=128,size=64,depth=1.5){this.n=n;this.size=size;this.depth=depth;this.dx=size/n;this.center=[0,0];this.height=new Float32Array(n*n);this.u=new Float32Array(n*n);this.v=new Float32Array(n*n);this.data=new Float32Array(n*n*4);this.maxDt=.38*this.dx/Math.sqrt(2*G*depth);}
 reset(x=0,z=0){this.center=[x,z];this.height.fill(0);this.u.fill(0);this.v.fill(0);this.data.fill(0);}
 impulse(x,z,amplitude=.7,radius=1.4){if(Math.abs(x-this.center[0])>this.size*.38||Math.abs(z-this.center[1])>this.size*.38)this.reset(x,z);const n=this.n,field=new Float64Array(n*n);let sum=0;for(let j=0;j<n;j++)for(let i=0;i<n;i++){const wx=(i+.5)/n*this.size-this.size/2+this.center[0],wz=(j+.5)/n*this.size-this.size/2+this.center[1],r2=((wx-x)**2+(wz-z)**2)/(radius*radius);const a=amplitude*(1-r2*.5)*Math.exp(-r2*.5);field[j*n+i]=a;sum+=a;}const mean=sum/(n*n);for(let k=0;k<n*n;k++)this.height[k]+=field[k]-mean;this.pack();}
 step(delta,{sponge=true}={}){const n=this.n,steps=Math.max(1,Math.ceil(delta/this.maxDt)),dt=delta/steps,idx=dt/this.dx;for(let step=0;step<steps;step++){
  for(let z=0;z<n;z++)for(let x=0;x<n;x++){const i=z*n+x;this.u[i]-=G*idx*(this.height[z*n+(x+1)%n]-this.height[i]);this.v[i]-=G*idx*(this.height[((z+1)%n)*n+x]-this.height[i]);}
  for(let z=0;z<n;z++)for(let x=0;x<n;x++){const i=z*n+x;this.height[i]-=this.depth*idx*(this.u[i]-this.u[z*n+(x+n-1)%n]+this.v[i]-this.v[((z+n-1)%n)*n+x]);if(sponge){const edge=Math.min(x,z,n-1-x,n-1-z)/(n*.13),damp=Math.exp(-dt*(.045+Math.max(0,1-edge)**2*4));this.height[i]*=damp;this.u[i]*=damp;this.v[i]*=damp;}}
 }this.pack();}
 pack(){const n=this.n,dx=this.dx;for(let z=0;z<n;z++)for(let x=0;x<n;x++){const i=z*n+x,k=i*4;this.data[k]=this.height[i];this.data[k+1]=(this.height[z*n+(x+1)%n]-this.height[z*n+(x+n-1)%n])/(2*dx);this.data[k+2]=(this.height[((z+1)%n)*n+x]-this.height[((z+n-1)%n)*n+x])/(2*dx);}}
 mass(){return this.height.reduce((a,b)=>a+b,0)*this.dx*this.dx;}
 energy(){let e=0;for(let i=0;i<this.height.length;i++)e+=.5*G*this.height[i]**2+.5*this.depth*(this.u[i]**2+this.v[i]**2);return e*this.dx*this.dx;}
}
/** Exact spherical-cap submerged volume, gravity and quadratic drag; fixed-step heave. */
export class Buoy {
 constructor(x=7,z=-10,radius=.9,density=550){this.x=x;this.z=z;this.radius=radius;this.mass=density*4/3*Math.PI*radius**3;this.y=1;this.vy=0;this.wetVolume=0;}
 static submergedVolume(radius,cap){const h=clamp(cap,0,2*radius);return Math.PI*h*h*(radius-h/3);}
 step(dt,height){const count=Math.max(1,Math.ceil(dt*120)),d=dt/count;for(let i=0;i<count;i++){const cap=height-(this.y-this.radius);this.wetVolume=Buoy.submergedVolume(this.radius,cap);const force=1025*G*this.wetVolume-this.mass*G;const drag=-.7*1025*Math.PI*this.radius**2*this.vy*Math.abs(this.vy);this.vy+=(force+drag)/this.mass*d;this.y+=this.vy*d;}}
}
export class Spray {
 constructor(max=1800){this.max=max;this.position=new Float32Array(max*3);this.velocity=new Float32Array(max*3);this.info=new Float32Array(max*2);this.age=new Float32Array(max);this.life=new Float32Array(max);this.rng=mulberry32(97421);this.cursor=0;this.count=0;}
 step(dt,ocean,eye){const storm=ocean.preset.wind>15;if(storm){const attempts=Math.ceil(dt*150);for(let j=0;j<attempts;j++){const x=eye[0]+(this.rng()-.5)*110,z=eye[2]+(this.rng()-.5)*110;const h=ocean.sample(x,z);if(h<ocean.preset.hs*.30)continue;const i=this.cursor++%this.max,k=i*3;this.position[k]=x;this.position[k+1]=h+.03;this.position[k+2]=z;this.velocity[k]=2.5+this.rng()*3;this.velocity[k+1]=1.8+this.rng()*3;this.velocity[k+2]=-1+this.rng();this.life[i]=.65+this.rng()*.6;this.age[i]=0;this.info[i*2+1]=.017+this.rng()*.022;}}
 this.count=0;for(let i=0;i<this.max;i++){const k=i*3;this.age[i]+=dt;if(this.age[i]>=this.life[i]){this.info[i*2]=0;continue;}this.velocity[k+1]-=G*dt;for(let a=0;a<3;a++)this.position[k+a]+=this.velocity[k+a]*dt;this.info[i*2]=Math.sin(Math.PI*this.age[i]/this.life[i]);this.count++;}}
}
