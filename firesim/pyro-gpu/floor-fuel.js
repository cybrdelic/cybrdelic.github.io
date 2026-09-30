// A stationary finite fuel bed. Clicks add cold mass; only simulated heat can
// volatilize it. RGBA = remaining mass, surface heat, release rate, char.
export const FLOOR_FUEL_SIZE = 128;
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
struct Params{step:vec4f,source:vec4f,shape:vec4f,effect:vec4f,dynamics:vec4f,chemistry:vec4f};
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var smp:sampler;
@group(0) @binding(2) var chem:texture_3d<f32>;
@group(0) @binding(3) var previous:texture_2d<f32>;
@group(0) @binding(4) var deposits:texture_2d<f32>;
@group(0) @binding(5) var next:texture_storage_2d<rgba32float,write>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){
 let size=textureDimensions(next);if(any(id.xy>=size)){return;}
 let i=vec2i(id.xy);let uv=(vec2f(id.xy)+.5)/vec2f(size);
 let old=textureLoad(previous,i,0);let fuel=min(4.,old.x+max(0.,textureLoad(deposits,i,0).x));
 let low=textureSampleLevel(chem,smp,vec3f(uv.x,.06/6.,uv.y),0).y;
 let high=textureSampleLevel(chem,smp,vec3f(uv.x,.14/6.,uv.y),0).y;
 let incoming=max(low,high);let dt=p.step.x;
 // An explicit Ignite fuel action is a single finite thermal impulse. Input
 // placement contains no heat; no soot/emission is manufactured by this pass.
 let ignition=select(0.,1.2,p.shape.y>1.5&&fuel>0.&&p.step.w<.5);
 let heat=max(0.,old.y+(incoming-old.y)*(1.-exp(-8.*dt)))*exp(-.22*dt)+ignition;
 let burned=select(min(fuel,fuel*smoothstep(.32,.65,heat)*1.3*dt),0.,p.step.w>.5);
 textureStore(next,i,vec4f(max(0.,fuel-burned),heat,burned/max(dt,.000001),min(4.,old.w+burned)));
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
