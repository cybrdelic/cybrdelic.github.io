// Authored supernatural sources feed the existing gas solve. These functions
// never draw a flame, lower resolution or allocate particle/texture resources.
export const POWER_DEFINITIONS = Object.freeze([
  {id:'radial-blast',kind:1,name:'Radial blast',continuous:false,duration:.45,floor:true,hint:'Click to cast an expanding fire wave. Cast or B fires again.'},
  {id:'fireball',kind:2,name:'Fireball',continuous:false,duration:1.15,floor:false,hint:'Click to launch. Heading and elevation aim the fireball; Cast or B fires again.'},
  {id:'fire-rain',kind:3,name:'Fire rain',continuous:true,duration:0,floor:true,hint:'Click or drag to move the rain field. Stop power ends the rain while released fire keeps evolving.'},
  {id:'fire-tornado',kind:4,name:'Fire tornado',continuous:true,duration:0,floor:true,hint:'Click or drag to move the driven vortex. Stop power removes its fuel and circulation.'},
  {id:'floor-trail',kind:5,name:'Fire floor trail',continuous:true,duration:0,floor:true,hint:'Drag on the floor to lay a burning oil trail. Fuel is finite; staying still does not refill it.'},
  {id:'combustion-bomb',kind:6,name:'Combustion bomb',continuous:false,duration:1.55,floor:true,hint:'Click to plant a bomb. A small charge burns for 1.2 seconds before it detonates.'},
].map(Object.freeze));

export function powerDefinition(value) {
  if (typeof value === 'object' && value) value=value.power || value.id;
  if (typeof value === 'string') value=value.replace(/^legacy:/,'');
  return POWER_DEFINITIONS.find(p=>p.id===value||p.kind===value) || null;
}
export function normalizePowerSettings(value={}) {
  const number=(v,d,lo,hi)=>Number.isFinite(Number(v))?Math.max(lo,Math.min(hi,Number(v))):d;
  return {strength:number(value?.strength,1,.25,2),heading:number(value?.heading,0,-180,180),elevation:number(value?.elevation,9,-30,80)};
}
export function powerDirection(settings={}) {
  const {heading,elevation}=normalizePowerSettings(settings),a=heading*Math.PI/180,b=elevation*Math.PI/180;
  return [Math.cos(a)*Math.cos(b),Math.sin(b),Math.sin(a)*Math.cos(b)];
}

// Common analytic support and forces, translated to GLSL for Original. Scale
// affects spatial support; age remains simulation seconds (Pause pauses it).
export const powerSourceWGSL = `
fn powerHash(p:vec3f)->f32{return fract(sin(dot(p,vec3f(127.1,311.7,74.7)))*43758.5453);}
fn powerFireballCenter(origin:vec3f,scale:f32,age:f32,direction:vec3f)->vec3f{
 let t:f32=clamp(age,0.,1.15);let dir:vec3f=direction/max(length(direction),.001);
 var center:vec3f=dir*(2.8*t)+vec3f(0,-1.65*t*t,0);
 center.y=max(center.y,.16-origin.y/max(scale,.05));
 return origin+center*scale;
}
fn powerRainCenter(cell:vec2f,age:f32)->vec3f{
 let seed:f32=powerHash(vec3f(cell,3.71));
 let cycle:f32=age/1.28+seed;let phase:f32=fract(cycle);let batch:f32=floor(cycle);
 let jitter:vec2f=vec2f(powerHash(vec3f(cell,batch+2.)),powerHash(vec3f(cell,batch+7.)))-vec2f(.5);
 return vec3f((cell.x-1.)*1.1+jitter.x*.3,4.12-4.10*phase,(cell.y-1.)*1.1+jitter.y*.3);
}
fn powerSupport(kind:f32,x:vec3f,origin:vec3f,scale:f32,age:f32,padding:f32)->bool{
 if(age<0.||scale<=0.){return false;}
 let q:vec3f=(x-origin)/max(scale,.05);
 let pad:f32=max(padding,0.)/max(scale,.05);
 if(kind<1.5){return age<=.45&&abs(q.y)<.72+pad&&length(q.xz)<2.25+pad;}
 if(kind<2.5){return age<=1.15&&all(abs(q)<vec3f(3.7+pad));}
 if(kind<3.5){return abs(q.x)<1.72+pad&&abs(q.z)<1.72+pad&&q.y>-.22-pad&&q.y<4.35+pad;}
 if(kind<4.5){return length(q.xz)<1.75+pad&&q.y>-.22-pad&&q.y<4.25+pad;}
 if(kind<5.5){return false;}
 return age<=1.55&&all(abs(q)<vec3f(1.7+pad));
}
fn powerSource(kind:f32,x:vec3f,origin:vec3f,scale:f32,age:f32,clock:f32,direction:vec3f,strength:f32)->vec4f{
 if(!powerSupport(kind,x,origin,scale,age,0.)){return vec4f(0);}
 let q:vec3f=(x-origin)/max(scale,.05);
 let drive:f32=clamp(strength,.25,2.);
 if(kind<1.5){
  let r:f32=length(q.xz);let ring:f32=.18+4.0*age;
  let rib:f32=.04*sin(atan2(q.z,q.x)*7.+age*13.);
  let v:f32=pow((r-ring-rib)/.13,2.)+pow((q.y-.08*ring)/.18,2.);
  if(v>12.){return vec4f(0);}
  let axis:vec2f=q.xz/max(r,.02);
  let envelope:f32=1.-smoothstep(.29,.45,age);
  return vec4f(vec3f(axis.x*6.5,1.2,axis.y*6.5)*sqrt(drive),3.2*exp(-v)*envelope*drive);
 }
 if(kind<2.5){
  let t:f32=min(age,1.15);
  let dir:vec3f=direction/max(length(direction),.001);
  let center:vec3f=(powerFireballCenter(origin,scale,age,direction)-origin)/max(scale,.05);
  let delta:vec3f=q-center;let r:f32=length(delta);
  if(r>.43){return vec4f(0);}
  let ripple:f32=.018*sin(delta.x*35.+clock*9.)*sin(delta.z*29.-clock*11.);
  let mask:f32=exp(-pow(r/max(.21+ripple,.15),2.)*1.5);
  let fade:f32=1.-smoothstep(.92,1.15,age);
  let spin:vec3f=cross(dir,delta)*8.;
  return vec4f((dir*2.8+vec3f(0,-3.3*t,0)+spin)*sqrt(drive),2.1*mask*fade*drive);
 }
 if(kind<3.5){
  // Nine staggered falling columns; evaluate only the nearest cell, not a
  // per-voxel particle loop. Each packet leaves evolving combustion behind.
  let cell:vec2f=clamp(floor((q.xz+vec2f(1.65))/1.1),vec2f(0),vec2f(2));
  let seed:f32=powerHash(vec3f(cell,3.71));
  let cycle:f32=age/1.28+seed;
  let phase:f32=fract(cycle);let batch:f32=floor(cycle);
  let jitter:vec2f=vec2f(powerHash(vec3f(cell,batch+2.)),powerHash(vec3f(cell,batch+7.)))-vec2f(.5);
  let center:vec3f=powerRainCenter(cell,age);
  let delta:vec3f=q-center;
  let v:f32=dot(delta/vec3f(.15,.23,.15),delta/vec3f(.15,.23,.15));
  if(v>12.){return vec4f(0);}
  return vec4f(vec3f(jitter.x*.5,-3.2,jitter.y*.5)*sqrt(drive),1.8*exp(-1.5*v)*drive);
 }
 if(kind<4.5){
  // A supernatural fuel ribbon feeds the driven vortex over its height. The
  // gas then rolls, mixes and burns in the solver; no flame is drawn here.
  let r:f32=length(q.xz);let theta:f32=atan2(q.z,q.x);
  let radius:f32=.32+.10*max(q.y,0.)+.035*sin(q.y*4.-clock*3.);
  let v:f32=pow((r-radius)/.13,2.);
  if(v>12.){return vec4f(0);}
  let tangent:vec3f=vec3f(-q.z,0,q.x)/max(r,.06);
  let feed:f32=.55+.45*sin(theta*2.-q.y*3.-clock*4.);
  let ends:f32=smoothstep(-.12,.06,q.y)*(1.-smoothstep(2.6,3.5,q.y));
  let lift:f32=mix(.45,3.5,smoothstep(0.,.8,q.y));
  let taper:f32=mix(1.8,.7,clamp(q.y/3.5,0.,1.));
  return vec4f((tangent*3.4+vec3f(0,lift,0))*sqrt(drive),.35*exp(-v)*feed*ends*taper*drive);
 }
 if(kind<5.5){return vec4f(0);}
 if(age<1.2){
  let r:f32=length(q);if(r>.28){return vec4f(0);}
  return vec4f(0,.35,0,.12*exp(-pow(r/.10,2.))*drive);
 }
 let t:f32=age-1.2;let r:f32=length(q);
 let rough:f32=.08*sin(q.x*19.+q.z*7.)*sin(q.y*17.-q.z*11.);
 let radius:f32=.32+2.8*t+rough;
 let body:f32=(1.-smoothstep(radius-.16,radius+.04,r))*(1.-smoothstep(.15,.35,t));
 if(body<=.001){return vec4f(0);}
 let axis:vec3f=q/max(r,.04);
 let swirl:vec3f=cross(vec3f(.3,.8,.5),q)*2.5;
 return vec4f((axis*6.+swirl+vec3f(0,1.5,0))*sqrt(drive),3.6*body*drive);
}
fn powerAcceleration(kind:f32,x:vec3f,origin:vec3f,scale:f32,age:f32,clock:f32,direction:vec3f,strength:f32)->vec3f{
 if(kind<3.5||kind>4.5||age<0.){return vec3f(0);}
 let q:vec3f=(x-origin)/max(scale,.05);let r:f32=length(q.xz);
 if(q.y<0.||q.y>4.||r>1.6){return vec3f(0);}
 let core:f32=.27+.13*q.y;
 let band:f32=exp(-pow(r/max(core,.2),2.));
 let ends:f32=smoothstep(0.,.18,q.y)*(1.-smoothstep(3.3,4.,q.y));
 let tangent:vec3f=vec3f(-q.z,0,q.x)/max(r,.1);
 let inward:vec3f=vec3f(-q.x,0,-q.z)/max(r,.1);
 let wobble:f32=1.+.12*sin(q.y*5.-clock*2.7);
 return (tangent*(7.*wobble)+inward*1.4+vec3f(0,3.0,0))*band*ends*clamp(strength,.25,2.);
}
`;

export const powerSourceGLSL = powerSourceWGSL
 .replace(/fn (\w+)\(([^)]*)\)->(vec[234]f|f32|bool)\{/g,(_,name,args,type)=>
  (type==='f32'?'float':type.replace('f',''))+' '+name+'('+args.split(',').map(a=>a.trim().replace(/(\w+):(vec[234]f|f32)/,(_,n,t)=>(t==='f32'?'float':t.replace('f',''))+' '+n)).join(',')+'){')
 .replace(/\b(?:let|var) (\w+):(vec[234]f|f32)=/g,(_,name,type)=>(type==='f32'?'float':type.replace('f',''))+' '+name+'=')
 .replace(/\bvec([234])f\b/g,'vec$1')
 .replace(/all\(abs\(q\)<vec3\(([^)]+)\)\)/g,'all(lessThan(abs(q),vec3($1)))')
 .replace(/atan2\(/g,'atan(');
