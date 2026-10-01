import { objectWGSL } from './objects.js?v=467fdf306aa8ace5';
import { woodPoseWGSL } from '../wood-structure.js?v=467fdf306aa8ace5';
import { WOOD_THERMO } from '../wood-thermo.js?v=467fdf306aa8ace5';

// The first four words are two unsigned64 counters implemented with ordinary
// u32 atomics. Word4 is the reciprocal masked-fine-kernel integral; word5 marks
// a completely blocked destination. No optional64-bit GPU feature is needed.
// Blocked quantities persist in these cells until the fluid kernel opens.
// The64-byte trailer separates current retained mass/energy (words0..3) from
// cumulative OUTSIDE-domain escape (words8..11). Reset alone clears the latter.
// A32³ fine-source work mask follows that trailer in the SAME buffer. It is
// derived from the normalized kernel, so blocked releases never activate gas.
export const WOOD_FLUX = Object.freeze({ N: 128, B: 64, stride: 6,
  massUnitsPerKg: 1e8, energyUnitsPerJ: 256,
  gasFuelDensityKgM3: WOOD_THERMO.gasFuelDensityKgM3,
  gasHeatCapacityJkgK: 1200, gasHeatScaleK: 1200, gasAmbientK: 300,
  bindings: Object.freeze({ flux:34, nodes:35, poses:36, metadata:37, owners:41, residual:42 }),
  ledger: Object.freeze({retainedWord:0,escapedWord:8,wordCount:16}),
  work: Object.freeze({bricks:32,fineBrickSize:8}) });

// Vapor.x is added fuel in the existing 1 kg/m³ concentration unit;
// vapor.y is added sensible enthalpy divided by reference rho*cp*1200 K.
// Temperature is intensive: added vapor carries heat capacity as well as
// energy. This is the same 1+fuel mixture-capacity model as floor fuel.
export function mixWoodVaporHeat(heat, fuel, vapor) {
  if (!Array.isArray(vapor) || vapor.length !== 2 ||
      ![heat, fuel, ...vapor].every(value => Number.isFinite(value) && value >= 0))
    throw Error('Invalid wood vapor sensible heat');
  const capacity = 1 + fuel;
  return (heat * capacity + vapor[1]) / (capacity + vapor[0]);
}
// Raw delivered coarse mass is also a source of gas volume in the global
// incompressible pressure solve. The masked fine-kernel normalization is
// solely for scalar delivery, never a second pressure-volume multiplier.
export function woodFluxDeliveredMass(words){
  if(words.length!==6||!Array.from(words).every(value=>Number.isInteger(value)&&value>=0&&value<=0xffffffff))
    throw Error('Invalid wood flux mass words');
  if(words[5]!==0)return 0;
  return Number(BigInt(words[0])+(BigInt(words[1])<<32n))/WOOD_FLUX.massUnitsPerKg;
}
export function woodFluxVolumeSource(words,dt,N=128){
  if(!Number.isFinite(dt)||dt<=0||![64,128].includes(N))throw Error('Invalid wood source volume units');
  return woodFluxDeliveredMass(words)/(WOOD_FLUX.gasFuelDensityKgM3*(6/N)**3*dt);
}
// A finite external starter heats gas as well as wood. Rated power is an
// authored torch/tinder approximation, integrated over REAL gas seconds.
// The compact free-space Gaussian integrates to rated watts; solid/domain
// clipping can only reduce delivered energy. It supplies no fuel or oxygen.
export const WOOD_GAS_PILOT = Object.freeze({powerW:120000,allPowerW:160000,
  sigmaLocal:.12,cutoffSigma:3,gaussianFraction:.9707091134651118,
  durationS:1.2,treeDurationS:2.5});
export function woodGasPilotSites({origin=[0,0,0],scale=1,tree=false,ignition=0}={}){
  if(origin.length!==3||!origin.every(Number.isFinite)||!Number.isFinite(scale)||scale<=0||
    !Number.isFinite(ignition))throw Error('Invalid wood gas pilot placement');
  const local=tree?[ignition>1.5?[.16,.48,.05]:[0,-1.12,0]]:
    ignition>.5?[[-.45,-.45,.15],[.45,0,.15],[0,.6,.15]]:[[-.45,-.45,.15]];
  const totalW=tree||ignition<=.5?WOOD_GAS_PILOT.powerW:WOOD_GAS_PILOT.allPowerW;
  return local.map(at=>({center:at.map((value,axis)=>axis===1?
    Math.max(.07,origin[axis]+value*scale):origin[axis]+value*scale),
    powerW:totalW/local.length,sigma:WOOD_GAS_PILOT.sigmaLocal*scale}));
}
export function woodGasPilotHeat(world,{age=0,dt=0,active=true,tree=false,...placement}={}){
  if(world.length!==3||!world.every(Number.isFinite)||![age,dt].every(Number.isFinite)||dt<0)
    throw Error('Invalid wood gas pilot time');
  if(!active||age<0)return 0;
  const seconds=Math.max(0,Math.min(dt,(tree?WOOD_GAS_PILOT.treeDurationS:WOOD_GAS_PILOT.durationS)-age));
  if(seconds===0)return 0;
  let energyDensity=0;
  for(const site of woodGasPilotSites({...placement,tree})){
    const r2=world.reduce((sum,value,axis)=>sum+((value-site.center[axis])/site.sigma)**2,0);
    if(r2>9)continue;
    const normalization=(2*Math.PI)**1.5*site.sigma**3*WOOD_GAS_PILOT.gaussianFraction;
    energyDensity+=site.powerW*seconds*Math.exp(-.5*r2)/normalization;
  }
  return energyDensity/(WOOD_FLUX.gasFuelDensityKgM3*WOOD_FLUX.gasHeatCapacityJkgK*WOOD_FLUX.gasHeatScaleK);
}
const N = WOOD_FLUX.N, B = WOOD_FLUX.B, CELLS = N ** 3, WORDS = CELLS * WOOD_FLUX.stride;
const WORK_BRICKS=WOOD_FLUX.work.bricks, WORK_BASE=WORDS+WOOD_FLUX.ledger.wordCount;

// CPU references for integer conservation and the exact128→256 sample lattice.
export function splitWoodFluxInteger(total, weights) {
  if (typeof total !== 'bigint' || total < 0n || weights.length !== 8 ||
      weights.some(w => !Number.isFinite(w) || w < 0) || Math.abs(weights.reduce((a,b)=>a+b,0)-1) > 1e-6)
    throw Error('Invalid conservative wood flux partition');
  let remaining = total;
  return weights.map((weight,i) => {
    if (i === 7) return remaining;
    let part = BigInt(Math.floor(Number(total) * weight));
    if (part > remaining) part = remaining;
    remaining -= part; return part;
  });
}
export function quantizeWoodFlux(value, remainder, scale) {
  if (![value,remainder,scale].every(Number.isFinite) || value < 0 || scale <= 0) throw Error('Invalid wood flux quantity');
  const pending = value + remainder, units = BigInt(Math.floor(Math.max(pending,0) * scale));
  return { units, remainder: pending - Number(units) / scale };
}
// Integer lifecycle reference: a delivered generation is removed exactly once;
// a blocked generation survives any number of steps and admits new finite fuel.
export function advanceWoodFluxCell(previous={mass:0n,energy:0n,blocked:false},
  added={mass:0n,energy:0n},volumeFraction=1){
  if(![previous.mass,previous.energy,added.mass,added.energy].every(v=>typeof v==='bigint'&&v>=0n)||
    !Number.isFinite(volumeFraction)||volumeFraction<0||volumeFraction>1)throw Error('Invalid retained wood flux');
  const mass=(previous.blocked?previous.mass:0n)+added.mass,
    energy=(previous.blocked?previous.energy:0n)+added.energy;
  const blocked=volumeFraction===0&&(mass>0n||energy>0n);
  return {state:{mass,energy,blocked},delivered:{mass:blocked?0n:mass,energy:blocked?0n:energy},
    retained:{mass:blocked?mass:0n,energy:blocked?energy:0n}};
}
export function woodFineKernel(coarse, N = 128, isFluid = () => true) {
  const weights = [.25,.75,.75,.25], entries = []; let integral = 0;
  for(let z=0;z<4;z++)for(let y=0;y<4;y++)for(let x=0;x<4;x++){
    const fine=[2*coarse[0]+x-1,2*coarse[1]+y-1,2*coarse[2]+z-1];
    if(fine.some(v=>v<0||v>=2*N)||!isFluid(fine))continue;
    const weight=weights[x]*weights[y]*weights[z];integral+=weight;
    entries.push({fine,weight});
  }
  return { entries, reciprocal: integral > 0 ? 8 / integral : 0,
    volumeFraction: integral / 8, blocked: integral === 0 };
}
// Conservative source support: keep the entire basis footprint, including
// solid samples, whenever any fluid sample admits a nonzero increment.
export function woodFluxWorkBricks(coarse, volumeFraction=1, nonzero=true) {
  if(coarse.length!==3||coarse.some(v=>!Number.isInteger(v)||v<0||v>=128)||
    !Number.isFinite(volumeFraction)||volumeFraction<0||volumeFraction>1)
    throw Error('Invalid wood flux work footprint');
  if(!nonzero||volumeFraction===0)return [];
  const low=coarse.map(v=>Math.floor(Math.max(2*v-1,0)/8));
  const high=coarse.map(v=>Math.floor(Math.min(2*v+2,255)/8));
  const bricks=[];
  for(let z=low[2];z<=high[2];z++)for(let y=low[1];y<=high[1];y++)for(let x=low[0];x<=high[0];x++)
    bricks.push(x+32*(y+32*z));
  return bricks;
}
export function woodFluxWorkQuery(world, halfBrick) {
  if(world.length!==3||!world.every(Number.isFinite)||!Number.isFinite(halfBrick)||halfBrick<=0)
    throw Error('Invalid wood flux work query');
  const origin=[-3,0,-3], width=6/32;
  const clamp=v=>Math.max(0,Math.min(31,v));
  // B32 callers query the aligned fine brick's center: one work-mask read.
  if(halfBrick===3/32){
    const at=world.map((v,i)=>clamp(Math.floor((v-origin[i])/width)));
    return [at[0]+32*(at[1]+32*at[2])];
  }
  // Inclusive upper extent is deliberate: adjacent boundary flags may add
  // harmless work, while every fine sample inside the footprint stays covered.
  const low=world.map((v,i)=>clamp(Math.floor((v-halfBrick-origin[i])/width)));
  const high=world.map((v,i)=>clamp(Math.floor((v+halfBrick-origin[i])/width)));
  const bricks=[];
  for(let z=low[2];z<=high[2];z++)for(let y=low[1];y<=high[1];y++)for(let x=low[0];x<=high[0];x++)
    bricks.push(x+32*(y+32*z));
  return bricks;
}

const wordHelpers = `
struct WoodWordPair{lo:u32,hi:u32};
fn woodWords(value:f32)->WoodWordPair{
 let v=min(max(floor(value),0.),1.8e19);let high=u32(floor(v/4294967296.));
 let low=max(v-f32(high)*4294967296.,0.);
 if(low>=4294967296.){return WoodWordPair(0u,high+1u);}
 return WoodWordPair(u32(low),high);
}
fn woodWordFloat(value:WoodWordPair)->f32{return f32(value.lo)+f32(value.hi)*4294967296.;}
fn woodWordMin(a:WoodWordPair,b:WoodWordPair)->WoodWordPair{
 if(a.hi<b.hi||(a.hi==b.hi&&a.lo<=b.lo)){return a;}return b;
}
fn woodWordSubtract(a:WoodWordPair,b:WoodWordPair)->WoodWordPair{
 return WoodWordPair(a.lo-b.lo,a.hi-b.hi-select(0u,1u,a.lo<b.lo));
}
`;
const statsBase = `${WORDS}u`;
const workBase = `${WORK_BASE}u`;
export const woodFluxClearWGSL=`
@group(0) @binding(34) var<storage,read_write> flux:array<atomic<u32>>;
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3u){
 if(any(id>=vec3u(128))){return;}let index=(id.x+128u*(id.y+128u*id.z))*6u;
 // The first32³ invocations each clear one source-work word before scatter.
 if(all(id<vec3u(32))){atomicStore(&flux[${workBase}+id.x+32u*(id.y+32u*id.z)],0u);}
 // Last substep's delivered quantity must not be consumed a second time.
 // A blocked quantity remains in place and is reconsidered after new scatter.
 if(atomicLoad(&flux[index+5u])==0u){
  atomicStore(&flux[index],0u);atomicStore(&flux[index+1u],0u);
  atomicStore(&flux[index+2u],0u);atomicStore(&flux[index+3u],0u);
 }
 atomicStore(&flux[index+4u],0u);
}
`;
export const woodFluxScatterWGSL = `
${woodPoseWGSL({staticBinding:35,stateBinding:36})}
${wordHelpers}
struct Params{step:vec4f,source:vec4f,shape:vec4f,effect:vec4f,dynamics:vec4f,chemistry:vec4f};
struct ObjectSettings{origin:vec4f,options:vec4f,tint:vec4f};
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(12) var skin:texture_3d<f32>;
@group(0) @binding(13) var<uniform> object:ObjectSettings;
@group(0) @binding(34) var<storage,read_write> flux:array<atomic<u32>>;
@group(0) @binding(37) var metadata:texture_3d<f32>;
@group(0) @binding(41) var<storage,read> donorOwner:array<u32>;
@group(0) @binding(42) var<storage,read_write> residual:array<vec2f>;
fn woodAtomicAdd(index:u32,value:WoodWordPair){
 let old=atomicAdd(&flux[index],value.lo);
 let carry=select(0u,1u,old>0xffffffffu-value.lo);
 atomicAdd(&flux[index+1u],value.hi+carry);
}
fn woodEscaped(mass:WoodWordPair,energy:WoodWordPair){
 woodAtomicAdd(${statsBase}+8u,mass);woodAtomicAdd(${statsBase}+10u,energy);
}
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3u){
 if(any(id>=vec3u(64))){return;}
 let donor=id.x+64u*(id.y+64u*id.z);let oldRemainder=residual[donor];
 let stock=textureLoad(skin,vec3i(id),0);let rest=textureLoad(metadata,vec3i(id),0);
 let scale=max(object.origin.w,0.);let mass=max(stock.z,0.)*max(p.step.x,0.)*rest.w*scale*scale*scale;
 let heat=max(293.15+500.*stock.y-300.,0.);
 let energy=mass*1200.*heat;
 let pending=vec2f(mass,energy)+oldRemainder;
 if(all(pending<=vec2f(0))){residual[donor]=pending;return;}
 let totalMass=woodWords(max(pending.x,0.)*1e8);
 let totalEnergy=woodWords(max(pending.y,0.)*256.);
 residual[donor]=pending-vec2f(woodWordFloat(totalMass)/1e8,woodWordFloat(totalEnergy)/256.);
 if(totalMass.lo==0u&&totalMass.hi==0u&&totalEnergy.lo==0u&&totalEnergy.hi==0u){return;}
 var position=rest.xyz;let owner=donorOwner[donor];
 if(owner!=0xffffffffu&&owner<arrayLength(&woodNodes)){position=woodTransformRest(owner,position);}
 let world=object.origin.xyz+position*scale;
 // A source outside the chamber escapes. Do not clamp it back into the room.
 if(any(world<vec3f(-3,0,-3))||any(world>=vec3f(3,6,3))){woodEscaped(totalMass,totalEnergy);return;}
 let q=(world-vec3f(-3,0,-3))/(6./128.)-.5;let low=vec3i(floor(q));let f=fract(q);
 var remainingMass=totalMass;var remainingEnergy=totalEnergy;
 for(var corner=0u;corner<8u;corner++){
  let offset=vec3i(i32(corner&1u),i32((corner>>1u)&1u),i32((corner>>2u)&1u));
  let weights=select(vec3f(1)-f,f,offset==vec3i(1));let weight=weights.x*weights.y*weights.z;
  var partMass=remainingMass;var partEnergy=remainingEnergy;
  if(corner!=7u){
   partMass=woodWordMin(woodWords(woodWordFloat(totalMass)*weight),remainingMass);
   partEnergy=woodWordMin(woodWords(woodWordFloat(totalEnergy)*weight),remainingEnergy);
  }
  remainingMass=woodWordSubtract(remainingMass,partMass);remainingEnergy=woodWordSubtract(remainingEnergy,partEnergy);
  // For an IN-domain point, duplicated edge anchors retain all eight weights.
  // The later fine-kernel integral corrects the truncated fine lattice.
  let cell=clamp(low+offset,vec3i(0),vec3i(127));let index=u32(cell.x+128*(cell.y+128*cell.z))*6u;
  woodAtomicAdd(index,partMass);woodAtomicAdd(index+2u,partEnergy);
 }
}`;

export const woodFluxNormalizeWGSL = objectWGSL + wordHelpers + `
@group(0) @binding(1) var smp:sampler;
@group(0) @binding(34) var<storage,read_write> flux:array<atomic<u32>>;
fn woodNormalizeAdd(index:u32,value:WoodWordPair){
 let old=atomicAdd(&flux[index],value.lo);let carry=select(0u,1u,old>0xffffffffu-value.lo);
 atomicAdd(&flux[index+1u],value.hi+carry);
}
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3u){
 if(any(id>=vec3u(128))){return;}let index=(id.x+128u*(id.y+128u*id.z))*6u;
 let mass=WoodWordPair(atomicLoad(&flux[index]),atomicLoad(&flux[index+1u]));
 let energy=WoodWordPair(atomicLoad(&flux[index+2u]),atomicLoad(&flux[index+3u]));
 if(mass.lo==0u&&mass.hi==0u&&energy.lo==0u&&energy.hi==0u){atomicStore(&flux[index+5u],0u);return;}
 let weights=array<f32,4>(.25,.75,.75,.25);var integral=0.;
 for(var z=0;z<4;z++){for(var y=0;y<4;y++){for(var x=0;x<4;x++){
  let fine=vec3i(id)*2+vec3i(x,y,z)-vec3i(1);
  if(any(fine<vec3i(0))||any(fine>=vec3i(256))){continue;}
  let at=vec3f(-3,0,-3)+(vec3f(fine)+.5)*(6./256.);
  // IDENTICAL predicate to production correctScalar's final solid exclusion.
  if(objectDistance(at)<-.02){continue;}
  integral+=weights[x]*weights[y]*weights[z];
 }}}
 if(integral>0.){
  atomicStore(&flux[index+4u],bitcast<u32>(8./integral));atomicStore(&flux[index+5u],0u);
  // All positive128→256 basis samples lie at2*id+[-1..2]. Each axis
  // intersects at most two eight-cell fine bricks; OR avoids shared writes.
  // Marking the full footprint is conservative at dynamic solid interfaces.
  let low=vec3u(max(vec3i(id)*2-vec3i(1),vec3i(0)))/8u;
  let high=min(id*2u+vec3u(2),vec3u(255))/8u;
  for(var z=low.z;z<=high.z;z++){for(var y=low.y;y<=high.y;y++){for(var x=low.x;x<=high.x;x++){
   atomicOr(&flux[${workBase}+x+32u*(y+32u*z)],1u);
  }}}
  return;
 }
 // Fully sealed source cells cannot inject into a nonexistent fluid sample.
 // Keep these quantities until later geometry/flow exposes fluid. This is a
 // coarse world-cell trapped-vapor approximation, not solid-space transport.
 // Current retained totals are distinct from cumulative domain escape.
 woodNormalizeAdd(${statsBase},mass);woodNormalizeAdd(${statsBase}+2u,energy);
 atomicStore(&flux[index+5u],1u);
}`;

// Read-only reinterpretation of the producer's words. Consumers add this
// INCREMENT once per substep: no second multiplication by dt or source knob.
export const woodFluxWGSL = `
@group(0) @binding(34) var<storage,read> woodFluxWords:array<u32>;
fn woodMixGas(heat:f32,fuel:f32,vapor:vec2f)->f32{
 let capacity=1.+fuel;
 return (heat*capacity+vapor.y)/(capacity+vapor.x);
}
fn woodFluxRawMass(cell:vec3u)->f32{
 if(any(cell>=vec3u(128u))){return 0.;}
 let index=(cell.x+128u*(cell.y+128u*cell.z))*6u;
 if(woodFluxWords[index+5u]!=0u){return 0.;}
 // Word4 is deliberately omitted: fine scalar support is normalized once
 // by woodFluxCell, while pressure consumes each raw amount exactly once.
 return (f32(woodFluxWords[index])+f32(woodFluxWords[index+1u])*4294967296.)/${WOOD_FLUX.massUnitsPerKg}.;
}
fn woodFluxVolumeSource(cell:vec3u,gridN:u32,dt:f32)->f32{
 if(dt<=0.||any(cell>=vec3u(gridN))){return 0.;}
 let span=128u/gridN;let base=cell*span;var mass=0.;
 for(var z=0u;z<span;z++){for(var y=0u;y<span;y++){for(var x=0u;x<span;x++){
  mass+=woodFluxRawMass(base+vec3u(x,y,z));
 }}}
 let cellVolume=pow(6./f32(gridN),3.);
 return mass/(${WOOD_FLUX.gasFuelDensityKgM3}.*cellVolume*dt);
}
fn woodGasPilotSeconds(age:f32,dt:f32,starterEnabled:f32)->f32{
 if(starterEnabled<.5||abs(object.tint.w)<.5||age<0.){return 0.;}
 let duration=select(${WOOD_GAS_PILOT.durationS},${WOOD_GAS_PILOT.treeDurationS},object.tint.w>.5);
 return max(0.,min(dt,duration-age));
}
fn woodGasPilotCenter(site:u32)->vec3f{
 var local=vec3f(-.45,-.45,.15);
 if(object.tint.w>.5){local=select(vec3f(0,-1.12,0),vec3f(.16,.48,.05),object.options.w>1.5);}
 else if(object.options.w>.5){
  if(site==1u){local=vec3f(.45,0,.15);}else if(site==2u){local=vec3f(0,.6,.15);}
 }
 var center=object.origin.xyz+local*object.origin.w;center.y=max(center.y,.07);return center;
}
fn woodGasPilotCount()->u32{return select(1u,3u,object.tint.w<-.5&&object.options.w>.5);}
fn woodGasPilotHeat(world:vec3f,age:f32,dt:f32,starterEnabled:f32)->f32{
 let seconds=woodGasPilotSeconds(age,dt,starterEnabled);if(seconds<=0.){return 0.;}
 let count=woodGasPilotCount();let sigma=${WOOD_GAS_PILOT.sigmaLocal}*object.origin.w;
 let totalW=select(${WOOD_GAS_PILOT.powerW}.,${WOOD_GAS_PILOT.allPowerW}.,count==3u);
 let normalization=15.749609945722419*pow(sigma,3.)*${WOOD_GAS_PILOT.gaussianFraction};
 var energyDensity=0.;for(var site=0u;site<count;site++){
  let q=(world-woodGasPilotCenter(site))/sigma;let r2=dot(q,q);
  if(r2<=9.){energyDensity+=totalW/f32(count)*seconds*exp(-.5*r2)/normalization;}
 }
 return energyDensity/(${WOOD_FLUX.gasFuelDensityKgM3}.*${WOOD_FLUX.gasHeatCapacityJkgK}.*${WOOD_FLUX.gasHeatScaleK}.);
}
fn woodGasPilotLive(world:vec3f,halfBrick:f32,age:f32,dt:f32,starterEnabled:f32)->bool{
 if(woodGasPilotSeconds(age,dt,starterEnabled)<=0.){return false;}
 let radius=${WOOD_GAS_PILOT.cutoffSigma}.*${WOOD_GAS_PILOT.sigmaLocal}*object.origin.w;
 for(var site=0u;site<woodGasPilotCount();site++){
  let near=max(abs(world-woodGasPilotCenter(site))-vec3f(halfBrick),vec3f(0));
  if(dot(near,near)<=radius*radius){return true;}
 }return false;
}
fn woodFluxCell(i:vec3i)->vec2f{
 if(any(i<vec3i(0))||any(i>=vec3i(128))){return vec2f(0);}
 let index=u32(i.x+128*(i.y+128*i.z))*6u;
 if(woodFluxWords[index+5u]!=0u){return vec2f(0);}
 let normalization=bitcast<f32>(woodFluxWords[index+4u]);
 let mass=f32(woodFluxWords[index])+f32(woodFluxWords[index+1u])*4294967296.;
 let energy=f32(woodFluxWords[index+2u])+f32(woodFluxWords[index+3u])*4294967296.;
 let volume=pow(6./128.,3.);
 return vec2f(mass/(1e8*volume),energy/(256.*volume*1200.*1200.))*normalization;
}
fn woodFluxDensity(world:vec3f)->vec2f{
 let q=(world-vec3f(-3,0,-3))/(6./128.)-.5;let low=vec3i(floor(q));let f=fract(q);var value=vec2f(0);
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let offset=vec3i(x,y,z);let weights=select(vec3f(1)-f,f,offset==vec3i(1));
  value+=woodFluxCell(low+offset)*weights.x*weights.y*weights.z;
 }}}return value;
}
fn woodFluxLive(world:vec3f,halfBrick:f32)->bool{
 let q=(world-vec3f(-3,0,-3))/(6./32.);
 // Canonical B32 queries are aligned fine-brick centers, requiring one read.
 if(halfBrick==3./32.){
  let cell=clamp(vec3i(floor(q)),vec3i(0),vec3i(31));
  return woodFluxWords[${workBase}+u32(cell.x+32*(cell.y+32*cell.z))]!=0u;
 }
 // Other source classifiers union intersecting fine-brick flags. The upper
 // extent is inclusive for conservative interface support (B16: at most27).
 let extent=halfBrick/(6./32.);
 let low=clamp(vec3i(floor(q-vec3f(extent))),vec3i(0),vec3i(31));
 let high=clamp(vec3i(floor(q+vec3f(extent))),vec3i(0),vec3i(31));
 for(var z=low.z;z<=high.z;z++){for(var y=low.y;y<=high.y;y++){for(var x=low.x;x<=high.x;x++){
  if(woodFluxWords[${workBase}+u32(x+32*(y+32*z))]!=0u){return true;}
 }}}return false;
}
`;

export class WoodFlux {
  constructor(device, {N=128,B=64,group} = {}) {
    if(N!==128||B!==64)throw Error('Wood flux uses the canonical128/256 gas and64 wood grids');
    this.device=device;this.externalGroup=group;this.metadataCache=new Map();this.groups=new Map();this.ids=new WeakMap();this.nextId=0;
    const usage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;
    this.flux=device.createBuffer({label:'wood-flux',size:(WORK_BASE+WORK_BRICKS**3)*4,usage});
    this.residual=device.createBuffer({label:'wood-flux-remainder',size:B**3*8,usage});
    this.defaultOwners=device.createBuffer({label:'wood-flux-no-owners',size:B**3*4,usage});
    device.queue.writeBuffer(this.defaultOwners,0,new Uint32Array(B**3).fill(0xffffffff));
    this.defaultNodes=device.createBuffer({label:'wood-flux-no-nodes',size:64,usage});
    this.defaultPoses=device.createBuffer({label:'wood-flux-no-poses',size:64,usage});
    this.statsOffset=WORDS*4;this.workOffset=WORK_BASE*4;this.destroyed=false;
  }
  async init() {
    const make=async(code,label)=>this.device.createComputePipelineAsync({layout:'auto',label,
      compute:{module:this.device.createShaderModule({code,label}),entryPoint:'main'}});
    try{
      this.clear=await make(woodFluxClearWGSL,'wood-flux-clear-delivered');
      this.scatter=await make(woodFluxScatterWGSL,'wood-flux-scatter');
      this.normalize=await make(woodFluxNormalizeWGSL,'wood-flux-normalize');
      if(this.destroyed)throw Error('Wood flux was closed while compiling');
      return this;
    }catch(error){this.destroy();throw error;}
  }
  async loadMetadata(url) {
    if(this.destroyed)throw Error('Wood flux is closed');
    const key=String(url);if(this.metadataCache.has(key))return this.metadataCache.get(key);
    const loading=(async()=>{
      const response=await fetch(url);if(!response.ok)throw Error('Wood metadata unavailable: '+url);
      const bytes=await response.arrayBuffer();if(bytes.byteLength!==64**3*16)throw Error('Invalid wood metadata size');
      const values=new Float32Array(bytes);let modelMassKg=0;
      for(let i=0;i<values.length;i+=4){if(!Number.isFinite(values[i])||!Number.isFinite(values[i+1])||!Number.isFinite(values[i+2])||!Number.isFinite(values[i+3])||values[i+3]<0)throw Error('Nonfinite wood metadata');modelMassKg+=values[i+3];}
      if(this.destroyed)throw Error('Wood flux was closed while loading its metadata');
      const t=this.device.createTexture({label:'wood-vapor-destinations',size:[64,64,64],dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
      try{
        this.device.queue.writeTexture({texture:t},values,{bytesPerRow:64*16,rowsPerImage:64},[64,64,64]);
        return {t,view:t.createView(),modelMassKg};
      }catch(error){t.destroy();throw error;}
    })();
    this.metadataCache.set(key,loading);
    try{return await loading;}catch(error){this.metadataCache.delete(key);throw error;}
  }
  group(pipeline, entries) {
    if(this.externalGroup)return this.externalGroup(pipeline,entries);
    const resource=value=>value?.view||value;
    const identify=value=>{if(!this.ids.has(value))this.ids.set(value,++this.nextId);return this.ids.get(value);};
    const normalized=entries.map(([binding,value])=>({binding,resource:resource(value)}));
    const key=identify(pipeline)+':'+normalized.map(entry=>entry.binding+':'+identify(entry.resource?.buffer||entry.resource)).join(',');
    if(!this.groups.has(key))this.groups.set(key,this.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:normalized}));
    return this.groups.get(key);
  }
  bindings(){return [[34,{buffer:this.flux}]];}
  encode(encoder,{params,settings,skin,metadata,owners=this.defaultOwners,nodes=this.defaultNodes,poses=this.defaultPoses,normalizationBindings}){
    if(this.destroyed||!this.clear||!this.scatter||!this.normalize)throw Error('Wood flux is not ready');
    if(!normalizationBindings)throw Error('Wood flux requires the actual collision bindings');
    // Clear only the current-retained ledger prefix. The cumulative escaped
    // trailer at+32bytes survives until scene reset; the field uses a selective
    // compute clear so fully blocked releases are not silently discarded.
    encoder.clearBuffer(this.flux,this.statsOffset,32);
    const scatterEntries=[[0,{buffer:params}],[12,skin],[13,{buffer:settings}],[34,{buffer:this.flux}],
      [35,{buffer:nodes}],[36,{buffer:poses}],[37,metadata],[41,{buffer:owners}],[42,{buffer:this.residual}]];
    const submit=(pipeline,entries,count)=>{const pass=encoder.beginComputePass({label:pipeline.label});pass.setPipeline(pipeline);pass.setBindGroup(0,this.group(pipeline,entries));pass.dispatchWorkgroups(count,count,count);pass.end();};
    submit(this.clear,[[34,{buffer:this.flux}]],32);
    submit(this.scatter,scatterEntries,16);
    submit(this.normalize,[[34,{buffer:this.flux}],...normalizationBindings],32);
  }
  reset(encoder){encoder.clearBuffer(this.flux);encoder.clearBuffer(this.residual);}
  destroy(){
    if(this.destroyed)return;this.destroyed=true;
    for(const buffer of [this.flux,this.residual,this.defaultOwners,this.defaultNodes,this.defaultPoses])buffer.destroy();
    for(const loading of this.metadataCache.values())Promise.resolve(loading).then(metadata=>metadata.t.destroy(),()=>{});
    this.metadataCache.clear();this.groups.clear();
  }
}
