// Geometry and surface state are shared by combustion and ray tracing.
// Static signed-distance assets contain no rendered fire or temporal frames.
export const objectWGSL = `
struct ObjectSettings{origin:vec4f,options:vec4f,tint:vec4f};
@group(0) @binding(11) var solid:texture_3d<f32>;
@group(0) @binding(12) var skin:texture_3d<f32>;
@group(0) @binding(13) var<uniform> object:ObjectSettings;
fn objectUV(x:vec3f)->vec3f{return ((x-object.origin.xyz)/object.origin.w+1.5)/3.;}
fn objectSample(x:vec3f)->vec4f{
 if(object.options.x<.5){return vec4f(10,0,0,0);}
 let uv=objectUV(x);if(any(uv<vec3f(0))||any(uv>vec3f(1))){return vec4f(10,0,0,0);}
 return textureSampleLevel(solid,smp,uv,0);
}
fn objectDistance(x:vec3f)->f32{return objectSample(x).x*object.origin.w;}
fn objectNormal(x:vec3f)->vec3f{
 let e=.024*object.origin.w;
 let n=vec3f(objectDistance(x+vec3f(e,0,0))-objectDistance(x-vec3f(e,0,0)),objectDistance(x+vec3f(0,e,0))-objectDistance(x-vec3f(0,e,0)),objectDistance(x+vec3f(0,0,e))-objectDistance(x-vec3f(0,0,e)));
 return n/max(length(n),.00001);
}
fn surfaceState(x:vec3f)->vec4f{return textureSampleLevel(skin,smp,clamp(objectUV(x),vec3f(0),vec3f(1)),0);}
fn surfaceFeed(x:vec3f)->f32{
 let d=objectSample(x).x;if(d<-.02||d>.13){return 0.;}
 return surfaceState(x).z*exp(-pow((d-.035)/.055,2.))*2.8;
}
fn colorEmission(spectrum:vec3f)->vec3f{
 // Color looks are art direction, not a chemical emission-line simulation.
 return select(spectrum,mix(object.tint.xyz,vec3f(1),clamp(spectrum.z,0.,1.)*.5),object.options.y>.5);
}
`;

function surfaceSource(tree) {
  return (
    objectWGSL +
    `
struct Params{step:vec4f,source:vec4f,shape:vec4f,effect:vec4f,dynamics:vec4f,chemistry:vec4f};
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var smp:sampler;
@group(0) @binding(2) var gas:texture_3d<f32>;
@group(0) @binding(14) var next:texture_storage_3d<rgba16float,write>;
${tree ? '@group(0) @binding(15) var damage:texture_3d<f32>; @group(0) @binding(16) var nextDamage:texture_storage_3d<rgba16float,write>;' : ''}
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3u){
 if(any(id>=vec3u(64))){return;}
 let local=(vec3f(id)+.5)*3./64.-1.5;
 let mat=textureLoad(solid,vec3i(id),0);var state=textureLoad(skin,vec3i(id),0);${tree ? 'var wear=textureLoad(damage,vec3i(id),0);' : ''}
 // State: remaining fuel fraction, surface heat, fuel release rate, char.
 if(abs(mat.x)>.16||mat.y<=0.){textureStore(next,vec3i(id),state);${tree ? 'textureStore(nextDamage,vec3i(id),wear);' : ''}return;}
 let at=object.origin.xyz+local*object.origin.w;
 let normal=objectNormal(at);let outside=at+normal*max(.035-mat.x*object.origin.w,.025);
 let c=textureSampleLevel(gas,smp,clamp((outside-vec3f(-3,0,-3))/6.,vec3f(0),vec3f(1)),0);
 let dt=p.step.x;
 // A localized starter ignites the object; subsequent pyrolysis is heated by
 // the surrounding live gas. No timed mask moving across the object's skin.
 var ignition=select(0.,select(6.0*exp(-dot(local-vec3f(-.45,-.85,.15),local-vec3f(-.45,-.85,.15))*2.0),4.0,object.options.w>.5),p.step.z<1.2&&p.source.w>.5);
${
  tree
    ? ` if(object.tint.w>.5){
  // Tree state: moisture, inner temperature, irreversible crack opening,
  // remaining section stiffness. Heat diffusion is explicit and CFL-bounded.
  let centre=select(vec3f(0,-1.12,0),vec3f(.16,.48,.05),object.options.w>1.5);
  ignition=select(0.,9.*exp(-dot(local-centre,local-centre)*22.),p.step.z<2.5&&p.source.w>.5);
  let q=vec3i(id);var neighbour=0.;
  let offsets=array<vec3i,6>(vec3i(1,0,0),vec3i(-1,0,0),vec3i(0,1,0),vec3i(0,-1,0),vec3i(0,0,1),vec3i(0,0,-1));
  for(var j=0;j<6;j++){let pos=clamp(q+offsets[j],vec3i(0),vec3i(63));let m=textureLoad(solid,pos,0);neighbour+=select(state.y,textureLoad(skin,pos,0).y,abs(m.x)<.16&&m.y>0.);}
  let heatIn=(c.y-state.y)*mat.z*2.2+ignition+(neighbour-6.*state.y)*.32-state.y*.08;
  state.y=max(0.,state.y+heatIn*dt);
  let evaporated=min(wear.x,max(state.y-.18,0.)*dt*.48);
  wear.x-=evaporated;state.y=max(0.,state.y-evaporated*1.6);
  wear.y+=clamp((state.y-wear.y)*dt*select(.16,.8,mat.w>7.5),-wear.y,2.);
  let dry=1.-smoothstep(.02,.28,wear.x);
  let rate=smoothstep(.34,.72,state.y)*dry*state.x*mat.y*select(.42,1.4,mat.w>7.5)*select(0.,1.,p.source.w>.5);
  let consumed=min(state.x,rate*dt/max(mat.y,.01)*select(.12,.7,mat.w>7.5));
  state.x-=consumed;state.y=max(0.,state.y-consumed*.6);state.z=rate;state.w=1.-state.x;
  // A section loses bending stiffness with radius^4. This diagnoses damage;
  // it does not pretend that a detached branch has been simulated.
  wear.w=pow(max(1.-state.w*.7,.05),4.);
  wear.z=max(wear.z,clamp(abs(state.y-wear.y)*.35+state.w*.7-.15,0.,1.));
  textureStore(next,vec3i(id),state);textureStore(nextDamage,vec3i(id),wear);return;
 }`
    : ''
}
 state.y=max(0.,state.y+(c.y-state.y)*min(dt*mat.z*3.,1.)+ignition*dt-state.y*dt*.12);
 let rate=smoothstep(.22,.65,state.y)*state.x*mat.y*.65*select(0.,1.,p.source.w>.5);
 let consumed=min(state.x,rate*dt/max(mat.y, .01)*.16);
 state.x-=consumed;state.y=max(0.,state.y-consumed*.35);
 state.z=rate;state.w=1.-state.x;
 textureStore(next,vec3i(id),state);
 ${tree ? 'textureStore(nextDamage,vec3i(id),wear);' : ''}
}
@compute @workgroup_size(4,4,4) fn reset(@builtin(global_invocation_id) id:vec3u){
 if(any(id>=vec3u(64))){return;}textureStore(next,vec3i(id),vec4f(1,0,0,0));
}`
  );
}
export const surfaceWGSL = surfaceSource(true);
export const basicSurfaceWGSL = surfaceSource(false);

export const damageResetWGSL = `
struct ObjectSettings{origin:vec4f,options:vec4f,tint:vec4f};
@group(0) @binding(13) var<uniform> object:ObjectSettings;
@group(0) @binding(16) var nextDamage:texture_storage_3d<rgba16float,write>;
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3u){
 if(any(id>=vec3u(64))){return;}
 let moisture=select(.12,.65,object.tint.w>1.5);
 textureStore(nextDamage,vec3i(id),vec4f(moisture,0,0,1));
}`;

export { FIRE_COLORS } from './fire-colors.js?v=0c4b630ed586cdec';
