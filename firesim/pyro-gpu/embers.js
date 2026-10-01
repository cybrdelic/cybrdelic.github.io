import {combustionWGSL} from './combustion.js?v=7a3bf1fa893730f2';
import {woodCollisionSampleWGSL} from './wood-collision.js?v=7a3bf1fa893730f2';
// One-way Lagrangian tracers: born in reacting soot, carried by the actual
// MAC velocity, with inertia, gravity and cooling. No screen-space spawner.
export const emberComputeWGSL=`
${combustionWGSL}
struct Params{step:vec4f,source:vec4f,shape:vec4f,effect:vec4f,dynamics:vec4f,chemistry:vec4f};
struct Particle{pos:vec4f,velocity:vec4f};
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var smp:sampler;
@group(0) @binding(2) var flow:texture_3d<f32>;
@group(0) @binding(3) var gas:texture_3d<f32>;
@group(0) @binding(4) var<storage,read_write> particles:array<Particle>;
fn random(seed:u32)->f32{var x=seed;x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;return f32(x)/4294967296.;}
fn velocity(at:vec3f)->vec3f{
 let q=(at-vec3f(-3,0,-3))/(6./128.);
 return vec3f(textureSampleLevel(flow,smp,(q+vec3f(.5,0,0))/129.,0).x,textureSampleLevel(flow,smp,(q+vec3f(0,.5,0))/129.,0).y,textureSampleLevel(flow,smp,(q+vec3f(0,0,.5))/129.,0).z);
}
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=2048u){return;}var a=particles[id.x];let dt=p.step.x;
 if(a.pos.w<=.08||a.velocity.w<=0.){
  let seed=id.x*97u+u32(p.step.y*6000.)*31u+u32(p.shape.x*100.);
  let r=vec3f(random(seed),random(seed+1u),random(seed+2u));
  let at=clamp(p.source.xyz+(r-.5)*vec3f(3.5,3.8,3.5)+vec3f(0,.8,0),vec3f(-2.98,.02,-2.98),vec3f(2.98,5.98,2.98));
  let c=textureSampleLevel(gas,smp,(at-vec3f(-3,0,-3))/6.,0);
  if(c.x>.025&&flameActivity(c)>.12&&random(seed+3u)<dt*12.){a.pos=vec4f(at,min(c.y,2.));a.velocity=vec4f(velocity(at),2.+random(seed+4u)*3.);}
 }else{
  let carried=velocity(a.pos.xyz);a.velocity=vec4f(mix(a.velocity.xyz,carried,1.-exp(-dt*5.))+vec3f(0,-.35*dt,0),a.velocity.w-dt);
  a.pos=vec4f(a.pos.xyz+a.velocity.xyz*dt,a.pos.w*exp(-dt*.75));
  if(a.pos.y<.015||any(abs(a.pos.xz)>vec2f(3.))||a.pos.y>6.){a.velocity.w=0.;a.pos.w=0.;}
 }
 particles[id.x]=a;
}`;

export const emberRenderWGSL=`
struct View{eye:vec4f,right:vec4f,up:vec4f,forward:vec4f,options:vec4f,ambient:vec4f,spotPos0:vec4f,spotDir0:vec4f,spotPower0:vec4f,spotPos1:vec4f,spotDir1:vec4f,spotPower1:vec4f};
struct ObjectSettings{origin:vec4f,options:vec4f,tint:vec4f};
struct Particle{pos:vec4f,velocity:vec4f};
@group(0) @binding(0) var<storage,read> particles:array<Particle>;
@group(0) @binding(1) var<uniform> cam:View;
@group(0) @binding(2) var smp:sampler;
@group(0) @binding(3) var gas:texture_3d<f32>;
@group(0) @binding(4) var solid:texture_3d<f32>;
@group(0) @binding(5) var<uniform> object:ObjectSettings;
${woodCollisionSampleWGSL}
struct V{@builtin(position) pos:vec4f,@location(0) uv:vec2f,@location(1) heat:f32,@location(2) visibility:f32};
@vertex fn vertex(@builtin(vertex_index) i:u32,@builtin(instance_index) id:u32)->V{
 let a=particles[id];let corner=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1))[i];
 let size=.007+f32(id%5u)*.0012;let at=a.pos.xyz+cam.right.xyz*corner.x*size+cam.up.xyz*corner.y*size;
 let rel=at-cam.eye.xyz;let depth=dot(rel,cam.forward.xyz);var o:V;
 o.pos=vec4f(dot(rel,cam.right.xyz)/(cam.eye.w*16./9.),dot(rel,cam.up.xyz)/cam.eye.w,depth*.5,depth);o.uv=corner;o.heat=a.pos.w;o.visibility=select(0.,1.,a.velocity.w>0.&&depth>0.);
 // Fully transparent particles cannot contribute, regardless of occlusion.
 if(o.visibility==0.){return o;}
 // Integrate soot between camera and particle; solids also occlude sparks.
 let distance=length(rel);let ray=rel/max(distance,.001);var tau=0.;
 for(var j=0;j<24;j++){let x=cam.eye.xyz+ray*(distance*(f32(j)+.5)/24.);let uv=(x-vec3f(-3,0,-3))/6.;
  if(all(uv>=vec3f(0))&&all(uv<=vec3f(1))){tau+=textureSampleLevel(gas,smp,uv,0).x*3.*distance/24.;}
  let local=((x-object.origin.xyz)/object.origin.w+1.5)/3.;
  if(object.options.x>.5){
   if(woodMoved()){if(woodCellCode(x)!=0u){o.visibility=0.;}}
   else if(all(local>=vec3f(0))&&all(local<=vec3f(1))){if(textureSampleLevel(solid,smp,local,0).x<-.01){o.visibility=0.;}}
  }
 }o.visibility*=exp(-tau);return o;
}
@fragment fn fragment(v:V)->@location(0) vec4f{
 let a=exp(-dot(v.uv,v.uv)*3.)*v.visibility*smoothstep(.08,.6,v.heat);
 let natural=mix(vec3f(1,.11,.008),vec3f(1,.72,.26),clamp(v.heat-1.,0.,1.));
 let color=select(natural,sqrt(object.tint.xyz),object.options.y>.5);
 return vec4f(color,a*.8);
}`;
