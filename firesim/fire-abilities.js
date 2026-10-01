import {powerDefinition,powerDirection} from './fire-powers.js?v=7dfac6909b1f2622';
import {POWER_CAST_CAPACITY,powerPhase,powerSpeedFloor,powerExpansion} from './fire-power-definitions.js?v=7dfac6909b1f2622';
const finite3=v=>Array.isArray(v)||ArrayBuffer.isView(v)?v.length===3&&Array.from(v).every(Number.isFinite):false;
const set3=(to,v)=>{for(let i=0;i<3;i++)to[i]=v[i];};
// Reserve room for the burning impact and fan spread, not just its center.
const targetMargin=d=>(d.impactMargin||0)+
 (d.id==='meteor-barrage'||d.id==='cinder-scatter'||d.id==='ember-orbit'?.8:0);
const floorHeight=bounds=>Math.max(bounds.min[1],Math.min(bounds.max[1],.14));
const originFitsDomain=(definition,origin,scale,bounds)=>{
 let distance2=0;for(let i=0;i<3;i++){
  const closest=definition.floor&&i===1?floorHeight(bounds):Math.max(bounds.min[i],Math.min(bounds.max[i],origin[i]));
  distance2+=(closest-origin[i])**2;
 }return distance2<=(definition.range*scale)**2+1e-12;
};
const insetDistance2=(s,margin,topMargin,factor)=>{
 const lo=s.clampLo,hi=s.clampHi,closest=s.clampClosest,reserve=margin*factor,topReserve=topMargin*factor;
 let distance2=0;for(let i=0;i<3;i++){
  if(i===1){lo[i]=s.bounds.min[i];hi[i]=Math.max(lo[i],s.bounds.max[i]-topReserve);
   if(s.definition.floor)lo[i]=hi[i]=floorHeight(s.bounds);
  }else{const mid=(s.bounds.min[i]+s.bounds.max[i])*.5;
   lo[i]=Math.min(mid,s.bounds.min[i]+reserve);hi[i]=Math.max(mid,s.bounds.max[i]-reserve);
  }
  closest[i]=Math.max(lo[i],Math.min(hi[i],s.origin[i]));distance2+=(closest[i]-s.origin[i])**2;
 }return distance2;
};
const clampTarget=s=>{
 const range=s.definition.range*s.scale,range2=range*range,margin=targetMargin(s.definition)*s.scale;
 const topMargin=margin+(s.definition.id==='flame-serpent'?.35*s.scale:0);
 const lo=s.clampLo,hi=s.clampHi,closest=s.clampClosest;
 // Narrow domains can saturate the inset. If the requested inset and range
 // sphere do not meet, reduce only the reservation; range/domain remain hard.
 if(insetDistance2(s,margin,topMargin,1)>range2){let low=0,high=1;
  for(let n=0;n<36;n++){const middle=(low+high)*.5;if(insetDistance2(s,margin,topMargin,middle)<=range2)low=middle;else high=middle;}
  insetDistance2(s,margin,topMargin,low);
 }
 let a=0,b=0,c=-range2;
 for(let i=0;i<3;i++){
  s.target[i]=Math.max(lo[i],Math.min(hi[i],s.target[i]));
  const delta=s.target[i]-closest[i],offset=closest[i]-s.origin[i];
  a+=delta*delta;b+=2*offset*delta;c+=offset*offset;
 }
 if(a+b+c>0&&a>0){
  // Intersect a segment between two points in the convex inset with the
  // range sphere. This keeps both limits, unlike sequential projections.
  c=Math.min(c,0);const denominator=b+Math.sqrt(Math.max(0,b*b-4*a*c));
  const fraction=denominator>0?Math.max(0,Math.min(1,-2*c/denominator)):0;
  for(let i=0;i<3;i++)s.target[i]=closest[i]+(s.target[i]-closest[i])*fraction;
 }
};
export class PowerCastPool{
 constructor({bounds={min:[-2.84,.14,-2.84],max:[2.84,5.76,2.84]}}={}){
  if(!finite3(bounds.min)||!finite3(bounds.max)||bounds.min.some((v,i)=>v>=bounds.max[i]))throw Error('Invalid ability domain bounds');
  this.bounds={min:Array.from(bounds.min),max:Array.from(bounds.max)};
  this.slots=Array.from({length:POWER_CAST_CAPACITY},()=>({origin:new Float64Array(3),direction:new Float64Array([1,0,0]),target:new Float64Array(3),
   clampLo:new Float64Array(3),clampHi:new Float64Array(3),clampClosest:new Float64Array(3),
   age:0,kind:0,scale:1,strength:1,active:false,held:false,charge:1,serial:0,seed:0,definition:null,bounds:this.bounds}));
  this.serial=0;this.latest=null;
 }
 cast(value,settings={}){
  const d=powerDefinition(value);if(!d||!finite3(settings.origin))return null;
  const direction=settings.direction||powerDirection(settings);
  if(!finite3(direction)||!Number.isFinite(settings.strength??1)||!Number.isFinite(settings.scale??1))return null;
  const length=Math.hypot(...direction);if(length<1e-6)return null;
  if(settings.target&&!finite3(settings.target))return null;
  const scale=Math.max(.05,settings.scale??1);
  if(!originFitsDomain(d,settings.origin,scale,this.bounds))return null;
  let slot=d.continuous?this.slots[0]:this.slots.find(s=>!s.active);
  if(!slot)slot=this.slots.reduce((a,b)=>a.serial<b.serial?a:b);
  if(d.continuous)for(const s of this.slots)s.active=false;
  slot.definition=d;slot.kind=d.kind;slot.age=0;slot.active=true;slot.held=!!settings.held&&d.hold;
  slot.strength=Math.max(.25,Math.min(2,settings.strength??1));slot.scale=scale;
  slot.charge=slot.held?.65:1;slot.serial=++this.serial;slot.seed=Number.isFinite(settings.seed)?settings.seed:this.serial*.61803398875%1;
  set3(slot.origin,settings.origin);for(let i=0;i<3;i++)slot.direction[i]=direction[i]/length;
  if(settings.target)set3(slot.target,settings.target);
  else{const directional=['flame-dash','eruption-chain','fire-cross'].includes(d.id);for(let i=0;i<3;i++)slot.target[i]=slot.origin[i]+(d.targetMode==='ground'&&!directional?0:slot.direction[i]*d.range*slot.scale);}
  clampTarget(slot);
  this.latest=slot;return slot;
 }
 step(dt){
  if(!Number.isFinite(dt)||dt<0)throw Error('Ability step must be finite and nonnegative');
  for(const s of this.slots){if(!s.active)continue;s.age+=dt;
   if(s.held){s.charge=Math.min(1,s.charge+dt*.3);s.age=Math.min(s.age,s.definition.windup);}
   else if(!s.definition.continuous&&s.age>s.definition.duration)s.active=false;
  }
 }
 move(origin,target,settings={}){
  const s=this.latest;if(!s?.active||!s.definition.continuous||!finite3(origin))return false;
  const scale=Number.isFinite(settings.scale)?Math.max(.05,settings.scale):s.scale;
  if(!originFitsDomain(s.definition,origin,scale,this.bounds))return false;
  set3(s.origin,origin);this.updateContinuous(settings);if(target&&finite3(target))set3(s.target,target);clampTarget(s);return true;
 }
 aim(target,direction){const s=this.latest;if(!s?.active||!s.held)return false;
  if(target&&finite3(target)){set3(s.target,target);clampTarget(s);}
  if(direction&&finite3(direction)){const n=Math.hypot(...direction);if(n>1e-6)for(let i=0;i<3;i++)s.direction[i]=direction[i]/n;}return true;
 }
 updateContinuous({direction,strength,scale}={}){
  const s=this.latest;if(!s?.active||!s.definition.continuous)return false;
  if(Number.isFinite(scale)&&!originFitsDomain(s.definition,s.origin,Math.max(.05,scale),this.bounds))return false;
  if(direction&&finite3(direction)){const n=Math.hypot(...direction);if(n>1e-6)for(let i=0;i<3;i++)s.direction[i]=direction[i]/n;}
  if(Number.isFinite(strength))s.strength=Math.max(.25,Math.min(2,strength));if(Number.isFinite(scale))s.scale=Math.max(.05,scale);
  if(s.definition.targetMode==='aim'&&direction)for(let i=0;i<3;i++)s.target[i]=s.origin[i]+s.direction[i]*s.definition.range*s.scale;
  clampTarget(s);return true;
 }
 release(target,direction){const s=this.latest;if(!s?.active||!s.held)return false;this.aim(target,direction);s.held=false;s.age=s.definition.windup;return true;}
 cancelHeld(){const s=this.latest;if(!s?.held)return false;s.held=false;s.active=false;return true;}
 stop(){for(const s of this.slots){s.active=false;s.held=false;}}
 reset(){this.stop();this.latest=null;this.serial=0;for(const s of this.slots){s.kind=0;s.age=0;s.serial=0;}}
 write(out,offset=0){
  if(out.length<offset+POWER_CAST_CAPACITY*16)throw Error('Ability uniform target is too small');
  for(let i=0;i<this.slots.length;i++){const s=this.slots[i],o=offset+i*16;
   out[o]=s.origin[0];out[o+1]=s.origin[1];out[o+2]=s.origin[2];out[o+3]=s.held?Math.min(s.age,Math.max(0,s.definition.windup-1e-4)):s.age;
   out[o+4]=s.direction[0];out[o+5]=s.direction[1];out[o+6]=s.direction[2];out[o+7]=s.strength;
   out[o+8]=s.kind;out[o+9]=s.scale;out[o+10]=s.active&&!s.held?1:0;out[o+11]=s.seed;
   // Held casts still supply their anticipation phase, never their release.
   if(s.active&&s.held)out[o+10]=2;
   out[o+12]=s.target[0];out[o+13]=s.target[1];out[o+14]=s.target[2];out[o+15]=s.charge;
  }return out;
 }
 speedFloor(dt=0){let speed=0;for(const s of this.slots)if(s.active)speed=Math.max(speed,powerSpeedFloor(s.definition,s.age,dt)*Math.sqrt(s.strength)*Math.max(1,s.scale));return speed;}
 crossesImpulse(dt){return this.slots.some(s=>s.active&&!s.held&&s.definition.impulses.some(w=>s.age<w.at&&s.age+dt>=w.at));}
 expansion(){let value=0;for(const s of this.slots)if(s.active&&!s.held&&powerExpansion(s.definition,s.age)===18)value=Math.max(value,12*s.strength*s.charge);return value;}
 snapshot(){const s=this.latest?.active?this.latest:this.slots.filter(v=>v.active).sort((a,b)=>b.serial-a.serial)[0];return {active:this.slots.filter(v=>v.active).length,capacity:POWER_CAST_CAPACITY,held:!!s?.held,
  phase:s?.active?powerPhase(s.definition,s.age,s.held):{name:'Ready',progress:0},casts:this.slots.filter(v=>v.active).map(v=>({kind:v.kind,age:v.age,held:v.held,origin:Array.from(v.origin),target:Array.from(v.target),strength:v.strength,charge:v.charge}))};}
}
