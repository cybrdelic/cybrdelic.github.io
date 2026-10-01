// A stationary finite fuel bed. Clicks add cold mass; only simulated heat can
// volatilize it. RGBA = dry mass kg/m², gas-temperature coordinate, volatile
// release kg/m²/s, char kg/m². Wood may store NEGATIVE heat: 293.15K is below
// the gas coordinate's300K origin. This keeps its cold thermal state exact.
import {WOOD_THERMO,advanceWood,gasHeatToWoodHeat,woodThermoWGSL,
  woodHeatCapacity} from '../wood-thermo.js?v=467fdf306aa8ace5';
export const FLOOR_FUEL_SIZE = 128;

// CPU reference of the same reduced floor-column closure. Wear stores
// [initial dry kg/m², water/initial dry mass, core woodHeat, crack].
// Exposed surface/core nodes share the solid wood model, with no floor beam.
export function advanceFloorWood({stock=[0,0,0,0],wear=[0,0,0,0],deposit=0,
  incomingGasHeat=0,oxygen=1,dt=0,ignite=false,smokeOnly=false,
  timeScale=WOOD_THERMO.demoTimeScale}={}){
  if([...stock,...wear,deposit,incomingGasHeat,oxygen,dt,timeScale].some(x=>!Number.isFinite(x)))throw Error('Floor wood state must be finite');
  const remaining=Math.max(stock[0],0),char=Math.max(stock[3],0),accepted=Math.max(0,Math.min(4-remaining,Math.max(deposit,0)));
  const previousInitial=Math.max(wear[0],remaining+char),initial=previousInitial+accepted;
  if(initial<=0)return {stock:[0,0,0,0],wear:[0,0,0,0],volatileKgM2:0,oxidizedKgM2:0,waterKgM2:0,acceptedDeposit:0};
  const moisture=(Math.max(wear[1],0)*previousInitial+accepted*WOOD_THERMO.dryMoistureFraction)/initial;
  const surface=previousInitial>0?gasHeatToWoodHeat(stock[1]):0,core=Math.max(wear[2],0);
  const oldWater=Math.max(wear[1],0)*previousInitial;
  const freshCp=accepted*(woodHeatCapacity(293.15)+WOOD_THERMO.dryMoistureFraction*4180);
  const retainedCp=h=>remaining*woodHeatCapacity(293.15+500*h)+char*woodHeatCapacity(293.15+500*h,true)+oldWater*4180;
  const surfaceCp=retainedCp(surface),coreCp=retainedCp(core);
  const mixedSurface=surface*surfaceCp/Math.max(surfaceCp+freshCp,1e-20);
  const mixedCore=core*coreCp/Math.max(coreCp+freshCp,1e-20);
  const normalized=[(remaining+accepted)/initial,mixedSurface,0,char/initial];
  const normalizedWear=[moisture,mixedCore,Math.max(wear[3],0),1];
  const result=advanceWood({stock:normalized,wear:normalizedWear,
    incomingHeat:gasHeatToWoodHeat(incomingGasHeat),oxygen,dt,
    ignite:ignite&&!smokeOnly?WOOD_THERMO.starterFluxWm2:0,
    capacity:1,cellSize:initial/WOOD_THERMO.dryDensityKgM3,material:1,
    timeScale:smokeOnly?0:timeScale});
  const surfaceGas=(293.15+500*result.stock[1]-300)/1200;
  return {stock:[result.stock[0]*initial,surfaceGas,result.stock[2]*initial,result.stock[3]*initial],
    wear:[initial,result.wear[0],result.wear[1],result.wear[2]],
    volatileKgM2:result.volatileMass*initial,oxidizedKgM2:result.oxidizedMass*initial,
    waterKgM2:result.evaporatedMass*initial,acceptedDeposit:accepted};
}
export const floorFuelRenderWGSL = `
@group(0) @binding(32) var floorFuel:texture_2d<f32>;
fn floorFuelAt(xz:vec2f)->vec4f{
 if(any(xz<vec2f(-3))||any(xz>vec2f(3))){return vec4f(0);}
 let size=vec2i(textureDimensions(floorFuel));let texel=(xz+3.)/6.*vec2f(size)-.5;
 let base=vec2i(floor(texel));let f=fract(texel);
 let a=textureLoad(floorFuel,clamp(base,vec2i(0),size-1),0);
 let b=textureLoad(floorFuel,clamp(base+vec2i(1,0),vec2i(0),size-1),0);
 let c=textureLoad(floorFuel,clamp(base+vec2i(0,1),vec2i(0),size-1),0);
 let d=textureLoad(floorFuel,clamp(base+vec2i(1),vec2i(0),size-1),0);
 return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
`;
export const floorFuelWGSL = floorFuelRenderWGSL + `
fn floorFeed(x:vec3f)->vec4f{
 if(p.shape.y<.5||x.y<0.||x.y>=.24){return vec4f(0);}
 let bed=floorFuelAt(x.xz);
 let profile=exp(-x.y/.055)/(.055*(1.-exp(-.24/.055)));
 return vec4f(bed.z*profile,bed.y,0,0);
}
fn floorWork(center:vec3f,halfBrick:f32)->bool{
 if(p.shape.y<.5||center.y-halfBrick>=.24){return false;}
 let size=vec2i(textureDimensions(floorFuel));
 let lo=clamp(vec2i(floor((center.xz-halfBrick+3.)/6.*vec2f(size)))-1,vec2i(0),size-1);
 let hi=clamp(vec2i(ceil((center.xz+halfBrick+3.)/6.*vec2f(size)))+1,vec2i(0),size-1);
 for(var z=lo.y;z<=hi.y;z++){for(var x=lo.x;x<=hi.x;x++){
  if(textureLoad(floorFuel,vec2i(x,z),0).z>0.){return true;}
 }}return false;
}
`;

export const floorFuelUpdateWGSL = `
${woodThermoWGSL}
struct Params{step:vec4f,source:vec4f,shape:vec4f,effect:vec4f,dynamics:vec4f,chemistry:vec4f,lifecycle:vec4f};
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var smp:sampler;
@group(0) @binding(2) var chem:texture_3d<f32>;
@group(0) @binding(3) var previous:texture_2d<f32>;
@group(0) @binding(4) var deposits:texture_2d<f32>;
@group(0) @binding(5) var next:texture_storage_2d<rgba32float,write>;
@group(0) @binding(6) var previousWear:texture_2d<f32>;
@group(0) @binding(7) var nextWear:texture_storage_2d<rgba32float,write>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){
 let size=textureDimensions(next);if(any(id.xy>=size)){return;}
 let i=vec2i(id.xy);let uv=(vec2f(id.xy)+.5)/vec2f(size);
 let old=textureLoad(previous,i,0);let requested=max(0.,textureLoad(deposits,i,0).x);
 let fuel=min(4.,old.x+requested);
 let lowGas=textureSampleLevel(chem,smp,vec3f(uv.x,.06/6.,uv.y),0);
 let highGas=textureSampleLevel(chem,smp,vec3f(uv.x,.14/6.,uv.y),0);
 let incoming=max(lowGas.y,highGas.y);let dt=p.step.x;
 if(p.lifecycle.y>.5){
  let oldWear=textureLoad(previousWear,i,0);let remaining=max(old.x,0.);let char=max(old.w,0.);
  let added=max(0.,min(4.-remaining,requested));let previousInitial=max(oldWear.x,remaining+char);
  let initial=previousInitial+added;
  if(initial<=0.){textureStore(next,i,vec4f(0));textureStore(nextWear,i,vec4f(0));return;}
  let moisture=(max(oldWear.y,0.)*previousInitial+added*${WOOD_THERMO.dryMoistureFraction})/initial;
  let surface=select(0.,gasHeatToWoodHeat(old.y),previousInitial>0.);let core=max(oldWear.z,0.);
  let water=max(oldWear.y,0.)*previousInitial;
  let freshCp=added*(woodCp(293.15,0.)+${WOOD_THERMO.dryMoistureFraction}*4180.);
  let Ts=293.15+500.*surface;let Tc=293.15+500.*core;
  let surfaceCp=remaining*woodCp(Ts,0.)+char*woodCp(Ts,1.)+water*4180.;
  let coreCp=remaining*woodCp(Tc,0.)+char*woodCp(Tc,1.)+water*4180.;
  let state=vec4f((remaining+added)/initial,surface*surfaceCp/max(surfaceCp+freshCp,1e-20),0.,char/initial);
  let wear=vec4f(moisture,core*coreCp/max(coreCp+freshCp,1e-20),max(oldWear.w,0.),1.);
  let ignition=select(0.,${WOOD_THERMO.starterFluxWm2}.,p.shape.y>1.5&&fuel>0.&&p.step.w<.5);
  let scale=select(select(${WOOD_THERMO.demoTimeScale}.,p.lifecycle.z,p.lifecycle.z>0.),0.,p.step.w>.5);
  let oxygen=max(1.-max(lowGas.w,highGas.w),0.);
  let result=woodThermoStep(state,wear,gasHeatToWoodHeat(incoming),dt,ignition,oxygen,1.,initial/495.,1.,0.,scale);
  // Keep a signed gas-temperature coordinate in the BED ONLY. Fresh cold wood
  // is293.15K; gas fields remain nonnegative with a300K ambient convention.
  let surfaceGas=(293.15+500.*result.stock.y-300.)/1200.;
  textureStore(next,i,vec4f(result.stock.x*initial,surfaceGas,result.stock.z*initial,result.stock.w*initial));
  textureStore(nextWear,i,vec4f(initial,result.wear.x,result.wear.y,result.wear.z));return;
 }
 // An explicit Ignite fuel action is a single finite thermal impulse. Input
 // placement contains no heat; no soot/emission is manufactured by this pass.
 let ignition=select(0.,1.2,p.shape.y>1.5&&fuel>0.&&p.step.w<.5);
 let heat=max(0.,old.y+(incoming-old.y)*(1.-exp(-8.*dt)))*exp(-.22*dt)+ignition;
 let burned=select(min(fuel,fuel*smoothstep(.32,.65,heat)*1.3*dt),0.,p.step.w>.5);
 textureStore(next,i,vec4f(max(0.,fuel-burned),heat,burned/max(dt,.000001),min(4.,old.w+burned)));
 textureStore(nextWear,i,vec4f(0));
}
`;

export const floorFuelClearWGSL = `
@group(0) @binding(0) var a:texture_storage_2d<rgba32float,write>;
@group(0) @binding(1) var b:texture_storage_2d<rgba32float,write>;
@group(0) @binding(2) var deposits:texture_storage_2d<r32float,write>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=textureDimensions(a))){return;}
 textureStore(a,vec2i(id.xy),vec4f(0));textureStore(b,vec2i(id.xy),vec4f(0));textureStore(deposits,vec2i(id.xy),vec4f(0));
}
`;
// Separate reset keeps every stage within the WebGPU minimum of four storage
// textures. Clearing stockA/B+deposits+wearA/B in one stage would require five.
export const floorWoodWearClearWGSL = `
@group(0) @binding(0) var wearA:texture_storage_2d<rgba32float,write>;
@group(0) @binding(1) var wearB:texture_storage_2d<rgba32float,write>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=textureDimensions(wearA))){return;}
 textureStore(wearA,vec2i(id.xy),vec4f(0));textureStore(wearB,vec2i(id.xy),vec4f(0));
}
`;
export const floorDepositsClearWGSL = `
@group(0) @binding(0) var deposits:texture_storage_2d<r32float,write>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=textureDimensions(deposits))){return;}
 textureStore(deposits,vec2i(id.xy),vec4f(0));
}
`;

// Uploads carry half-float mass from the shared brush. R32F deposits are loaded
// explicitly and require no optional float32-filterable GPU feature.
export function expandFuelDeposits(source, target) {
 if(source.length!==target.length)throw Error('Fuel deposit dimensions changed.');
 for(let i=0;i<source.length;i++){
  const bits=source[i], exponent=(bits>>>10)&31, fraction=bits&1023;
  const value=exponent===0?fraction*2**-24:exponent===31?NaN:(1+fraction/1024)*2**(exponent-15);
  target[i]=(bits&32768)||!Number.isFinite(value)?0:Math.min(4,value);
 }return target;
}
