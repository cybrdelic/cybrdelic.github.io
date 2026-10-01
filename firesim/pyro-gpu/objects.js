// Geometry and surface state are shared by combustion and ray tracing.
// Static signed-distance assets contain no rendered fire or temporal frames.
import { woodThermoWGSL, WOOD_THERMO } from '../wood-thermo.js?v=54c82352661e679d';
import {woodPoseWGSL} from '../wood-structure.js?v=54c82352661e679d';
import {woodCollisionSampleWGSL} from './wood-collision.js?v=54c82352661e679d';

// F32 stocks never use hardware filtering. Empty thermal cells are zeroed by
// the update kernel: averaging them into solid stock would invent conversion.
// Normalize ONLY by occupied-capacity weights, not by the remaining stock, so
// genuinely exhausted wood still samples zero. No float32-filter feature.
export function woodHasThermalCapacity(mat){
 return mat[1]>0&&(mat[0]<=0||(mat[3]>7.5&&mat[3]<8.5&&mat[0]<.07));
}
export function sampleWoodTrilinear(field,geometry,uv,fallback,size=64){
 const q=uv.map(v=>Math.min(1,Math.max(0,v))*size-.5),low=q.map(Math.floor),f=q.map((v,i)=>v-low[i]);
 const value=[0,0,0,0];let coverage=0;
 for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++){
  const offset=[x,y,z],at=offset.map((v,i)=>Math.min(size-1,Math.max(0,low[i]+v)));
  if(!woodHasThermalCapacity(geometry(at)))continue;
  const weight=offset.reduce((v,b,i)=>v*(b?f[i]:1-f[i]),1),sample=field(at);
  for(let i=0;i<4;i++)value[i]+=sample[i]*weight;
  coverage+=weight;
 }
 return coverage>0?value.map(v=>v/coverage):[...fallback];
}
// Binding-free helper: callers supply the actual solid proxy and a fresh
// stock/wear fallback. Shared by volume geometry and normal/shadow mesh passes.
export const woodStateWGSL = `
fn woodSampleOccupied(mat:vec4f)->bool{
 return mat.y>0.&&(mat.x<=0.||(mat.w>7.5&&mat.w<8.5&&mat.x<.07));
}
fn woodTrilinear(field:texture_3d<f32>,geometry:texture_3d<f32>,uv:vec3f,fallback:vec4f)->vec4f{
 let q=clamp(uv,vec3f(0),vec3f(1))*64.-.5;let lo=vec3i(floor(q));let f=fract(q);
 var value=vec4f(0);var coverage=0.;
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let offset=vec3i(x,y,z);let at=clamp(lo+offset,vec3i(0),vec3i(63));
  if(!woodSampleOccupied(textureLoad(geometry,at,0))){continue;}
  let weight=select(vec3f(1)-f,f,vec3<bool>(x==1,y==1,z==1));
  let w=weight.x*weight.y*weight.z;
  value+=textureLoad(field,at,0)*w;coverage+=w;
 }}}
 if(coverage>0.){return value/coverage;}return fallback;
}
fn woodFreshWear(damp:bool)->vec4f{return vec4f(select(${WOOD_THERMO.dryMoistureFraction},${WOOD_THERMO.dampMoistureFraction},damp),0,0,1);}
`;
export const objectWGSL = `
struct ObjectSettings{origin:vec4f,options:vec4f,tint:vec4f};
@group(0) @binding(11) var solid:texture_3d<f32>;
@group(0) @binding(12) var skin:texture_3d<f32>;
@group(0) @binding(13) var<uniform> object:ObjectSettings;
@group(0) @binding(15) var damage:texture_3d<f32>;
${woodStateWGSL}
${woodCollisionSampleWGSL}
fn objectUV(x:vec3f)->vec3f{if(woodMoved()){let code=woodCellCode(x);if(code!=0u){return woodRestUV(code);}}return ((x-object.origin.xyz)/object.origin.w+1.5)/3.;}
fn objectSample(x:vec3f)->vec4f{
 if(object.options.x<.5){return vec4f(10,0,0,0);}
 if(woodMoved()){let code=woodCellCode(x);if(code==0u){return vec4f(6./128.,0,0,0);}var m=textureSampleLevel(solid,smp,woodRestUV(code),0);m.x=-3./128./object.origin.w;return m;}
 let uv=objectUV(x);if(any(uv<vec3f(0))||any(uv>vec3f(1))){return vec4f(10,0,0,0);}
 return textureSampleLevel(solid,smp,uv,0);
}
fn objectDistance(x:vec3f)->f32{return objectSample(x).x*object.origin.w;}
fn objectNormal(x:vec3f)->vec3f{
 let e=.024*object.origin.w;
 let n=vec3f(objectDistance(x+vec3f(e,0,0))-objectDistance(x-vec3f(e,0,0)),objectDistance(x+vec3f(0,e,0))-objectDistance(x-vec3f(0,e,0)),objectDistance(x+vec3f(0,0,e))-objectDistance(x-vec3f(0,0,e)));
 return n/max(length(n),.00001);
}
fn surfaceState(x:vec3f)->vec4f{return woodTrilinear(skin,solid,objectUV(x),vec4f(1,0,0,0));}
fn surfaceWear(x:vec3f)->vec4f{return woodTrilinear(damage,solid,objectUV(x),woodFreshWear(object.tint.w>1.5));}
fn surfaceFeed(x:vec3f)->f32{
 let d=objectSample(x).x;if(d<-.02||d>.13){return 0.;}
 // Compatibility only: production wood vapor is transferred by wood-flux,
 // not this unnormalized surface shell. Keep older modules compiling.
 return surfaceState(x).z*exp(-pow((d-.035)/.055,2.))*2.8;
}
fn colorEmission(spectrum:vec3f)->vec3f{
 // Color looks are art direction, not a chemical emission-line simulation.
 return select(spectrum,mix(object.tint.xyz,vec3f(1),clamp(spectrum.z,0.,1.)*.5),object.options.y>.5);
}
`;

const woodCellWGSL = `
fn woodCell(mat:vec4f)->bool{
 if(mat.y<=0.){return false;}
 // Porous foliage is a positive-distance lamina proxy, not solid wood.
 return select((mat.x<=0.),(mat.x<.07),(mat.w>7.5));
}
fn woodBulkHeat(s:vec4f,w:vec4f,material:f32,h:f32)->f32{
 let depth=select(.0015,.0002,material>7.5);let fraction=min(depth,h*.5)/h;
 return s.y*fraction+w.y*(1.-fraction);
}
`;

export const surfaceWGSL = objectWGSL + woodThermoWGSL + woodCellWGSL + woodPoseWGSL() + `
@group(0) @binding(41) var<storage,read> woodOwners:array<u32>;
struct Params{step:vec4f,source:vec4f,shape:vec4f,effect:vec4f,dynamics:vec4f,chemistry:vec4f};
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var smp:sampler;
@group(0) @binding(2) var gas:texture_3d<f32>;
@group(0) @binding(14) var next:texture_storage_3d<rgba32float,write>;
@group(0) @binding(16) var nextDamage:texture_storage_3d<rgba32float,write>;
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3u){
 if(any(id>=vec3u(64))){return;}
 let local=(vec3f(id)+.5)*3./64.-1.5;
 let q=vec3i(id);let mat=textureLoad(solid,q,0);var state=textureLoad(skin,q,0);var wear=textureLoad(damage,q,0);
 if(!woodCell(mat)){textureStore(next,q,vec4f(0));textureStore(nextDamage,q,vec4f(0));return;}
 let owner=woodOwners[id.x+64u*(id.y+64u*id.z)];
 let h=3.*object.origin.w/64.;var exposed=mat.x>=-3./64.*.85||mat.w>7.5;
 let at=object.origin.xyz+woodTransformRest(owner,local)*object.origin.w;
 if(woodMoved()&&!exposed){exposed=objectDistance(at+vec3f(h,0,0))>0.||objectDistance(at-vec3f(h,0,0))>0.||objectDistance(at+vec3f(0,h,0))>0.||objectDistance(at-vec3f(0,h,0))>0.||objectDistance(at+vec3f(0,0,h))>0.||objectDistance(at-vec3f(0,0,h))>0.;}
 var incoming=state.y;var oxygen=0.;var ignition=0.;
 if(exposed){
  let normal=objectNormal(at);let outside=at+normal*max(.5*h-mat.x*object.origin.w,.5*h);
  let c=textureSampleLevel(gas,smp,clamp((outside-vec3f(-3,0,-3))/6.,vec3f(0),vec3f(1)),0);
  incoming=gasHeatToWoodHeat(c.y);oxygen=max(1.-c.w,0.);
  // Source activity gates the bounded starter only. A hot solid continues
  // pyrolysis using persistent stock and gas heat after the starter is stopped.
  if(p.source.w>.5){
   if(object.tint.w>.5&&p.step.z<2.5){
    let centre=select(vec3f(0,-1.12,0),vec3f(.16,.48,.05),object.options.w>1.5);
    ignition=${WOOD_THERMO.starterFluxWm2}.*exp(-dot(local-centre,local-centre)*22.);
   }else if(object.tint.w<.5&&p.step.z<1.2){
    let offset=local-vec3f(-.45,-.85,.15);
    ignition=select(${WOOD_THERMO.starterFluxWm2}.*exp(-dot(offset,offset)*6.),${WOOD_THERMO.starterFluxWm2}.,object.options.w>.5);
   }
  }
 }
 let wood=(mat.w>.5&&mat.w<2.5)||mat.w>7.5;
 if(wood){
  let timeScale=select(${WOOD_THERMO.demoTimeScale}.,object.options.z,object.options.z>0.);
  let capacity=max(mat.y/1.5,.000001);let bulk=woodBulkHeat(state,wear,mat.w,h);
  let T=293.15+bulk*500.;let cp=max(state.x*woodCp(T,0.)+state.w*woodCp(T,1.)+wear.x*4180.,40.);
  let conductivity=woodK(T,state.w);var sum=0.;var total=0.;
  let offsets=array<vec3i,6>(vec3i(1,0,0),vec3i(-1,0,0),vec3i(0,1,0),vec3i(0,-1,0),vec3i(0,0,1),vec3i(0,0,-1));
  for(var j=0;j<6;j++){
   let pos=clamp(q+offsets[j],vec3i(0),vec3i(63));let material=textureLoad(solid,pos,0);
   if(!woodCell(material)||!(material.w<2.5||material.w>7.5)){continue;}
   let neighbour=textureLoad(skin,pos,0);let neighbourWear=textureLoad(damage,pos,0);
   let neighbourHeat=woodBulkHeat(neighbour,neighbourWear,material.w,h);
   let otherK=woodK(293.15+neighbourHeat*500.,neighbour.w);
   // The partition's beam axis gives each branch/plank its rest-space grain.
   // Project the conductivity tensor onto this face; keep equal-and-opposite
   // harmonic face conductance even when neighbouring grain directions differ.
   var grain=vec3f(1,0,0);var otherGrain=grain;
   if(abs(object.tint.w)>.5){
    let owner=woodOwners[u32(q.x+64*(q.y+64*q.z))];
    let otherOwner=woodOwners[u32(pos.x+64*(pos.y+64*pos.z))];
    if(woodPiece(owner)!=woodPiece(otherOwner)){continue;}
    grain=woodNodes[owner].axisRadius.xyz;
    otherGrain=woodNodes[otherOwner].axisRadius.xyz;
   }
   let direction=vec3f(offsets[j]);
   let kFace=conductivity*(1.+(${WOOD_THERMO.longitudinalConductivityRatio}-1.)*pow(dot(grain,direction),2.));
   let otherFace=otherK*(1.+(${WOOD_THERMO.longitudinalConductivityRatio}-1.)*pow(dot(otherGrain,direction),2.));
   let conductance=2.*kFace*otherFace/max(kFace+otherFace,.0001);
   sum+=conductance*(neighbourHeat-bulk);total+=conductance;
  }
  let heatCapacity=495.*capacity*cp*h*h;
  // Keep the explicit grid update a convex combination of neighbour heat.
  let stable=min(1.,heatCapacity/max(total*p.step.x*timeScale,.0000001));
  let conduction=sum/max(heatCapacity,.0000001)*stable;
  let result=woodThermoStep(state,wear,incoming,p.step.x,ignition,oxygen,capacity,h,mat.w,conduction,timeScale);
  textureStore(next,q,result.stock);textureStore(nextDamage,q,result.wear);return;
 }
 // Other combustible coatings retain a reduced finite model; pine kinetics
 // are not silently assigned to tyre rubber, furnishings or dummy coatings.
 state.y=max(0.,state.y+(incoming-state.y)*min(p.step.x*mat.z*3.,1.)+ignition/280000.*p.step.x*4.-state.y*p.step.x*.12);
 let consumed=min(state.x,state.x*(1.-exp(-smoothstep(.22,.65,state.y)*.104*p.step.x)));
 state.x-=consumed;state.w+=consumed*.2;state.z=consumed*.8/max(p.step.x,.0000001);
 wear.y+=clamp((state.y-wear.y)*p.step.x*.16,-wear.y,2.);wear.w=min(wear.w,state.x*state.x);
 textureStore(next,q,state);textureStore(nextDamage,q,wear);
}
@compute @workgroup_size(4,4,4) fn reset(@builtin(global_invocation_id) id:vec3u){
 if(any(id>=vec3u(64))){return;}textureStore(next,vec3i(id),vec4f(1,0,0,0));
}`;
// One generalized wood kernel; the host may reuse the same compiled pipeline.
export const basicSurfaceWGSL = surfaceWGSL;

export const damageResetWGSL = `
struct ObjectSettings{origin:vec4f,options:vec4f,tint:vec4f};
@group(0) @binding(13) var<uniform> object:ObjectSettings;
@group(0) @binding(16) var nextDamage:texture_storage_3d<rgba32float,write>;
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3u){
 if(any(id>=vec3u(64))){return;}
 let moisture=select(${WOOD_THERMO.dryMoistureFraction},${WOOD_THERMO.dampMoistureFraction},object.tint.w>1.5);
 textureStore(nextDamage,vec3i(id),vec4f(moisture,0,0,1));
}`;

export { FIRE_COLORS } from './fire-colors.js?v=54c82352661e679d';
