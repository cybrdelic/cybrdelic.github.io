import {objectWGSL} from './objects.js?v=86e0ab5a0c6c5992';
import {combustionWGSL} from './combustion.js?v=86e0ab5a0c6c5992';
// MAC velocity components live on their own faces in one (N+1)^3 texture.
// Scalars live at cell centers. All distances and velocities use world units.
export function simulationShaders(N=128,D=256){
const common=`
${combustionWGSL}
${objectWGSL}
const N:u32=${N}u;const D:u32=${D}u;const H:f32=6.0/${N}.0;
const LO=vec3f(-3,0,-3);const EXT=vec3f(6);
struct Params{step:vec4f,source:vec4f,shape:vec4f,effect:vec4f,dynamics:vec4f,chemistry:vec4f};
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var smp:sampler;
@group(0) @binding(8) var sigilSource:texture_2d<f32>;
fn hash(a:vec3f)->f32{return fract(sin(dot(a,vec3f(127.1,311.7,74.7)))*43758.5453);}
fn noise(x:vec3f)->f32{let i=floor(x);let a=fract(x);let f=a*a*(3.0-2.0*a);return mix(mix(mix(hash(i),hash(i+vec3f(1,0,0)),f.x),mix(hash(i+vec3f(0,1,0)),hash(i+vec3f(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3f(0,0,1)),hash(i+vec3f(1,0,1)),f.x),mix(hash(i+vec3f(0,1,1)),hash(i+vec3f(1)),f.x),f.y),f.z);}
fn mac(t:texture_3d<f32>,x:vec3f)->vec3f{
 let q=(x-LO)/H;let z=f32(N+1u);
 return vec3f(textureSampleLevel(t,smp,(q+vec3f(.5,0,0))/z,0).x,textureSampleLevel(t,smp,(q+vec3f(0,.5,0))/z,0).y,textureSampleLevel(t,smp,(q+vec3f(0,0,.5))/z,0).z);
}
fn component(t:texture_3d<f32>,x:vec3f,k:u32)->f32{var off=vec3f(0);off[k]=.5;return textureSampleLevel(t,smp,((x-LO)/H+off)/f32(N+1u),0)[k];}
fn scalar(t:texture_3d<f32>,x:vec3f)->vec4f{if(any(x<LO)||any(x>LO+EXT)){return vec4f(0);}return textureSampleLevel(t,smp,(x-LO)/EXT,0);}
fn trace(t:texture_3d<f32>,x:vec3f,dt:f32)->vec3f{return x-dt*mac(t,x-.5*dt*mac(t,x));}
fn face(i:vec3u,k:u32)->vec3f{var v=vec3f(.5);v[k]=0.;return LO+(vec3f(i)+v)*H;}
fn loadV(t:texture_3d<f32>,i:vec3i)->vec4f{return textureLoad(t,clamp(i,vec3i(0),vec3i(i32(N))),0);}
fn segment2(p:vec2f,a:vec2f,b:vec2f)->f32{let d=b-a;return length(p-a-d*clamp(dot(p-a,d)/dot(d,d),0.,1.));}
fn glyphDistance(q:vec2f,kind:f32)->f32{
 var d=1e4;
 if(kind<8.5){
  for(var i=0u;i<3u;i++){let a=1.5707963+f32(i)*2.0943951;let b=a+2.0943951;d=min(d,segment2(q,.73*vec2f(cos(a),sin(a)),.73*vec2f(cos(b),sin(b))));}
  return min(d,abs(length(q)-.92));
 }
 if(kind<9.5){
  for(var i=0u;i<5u;i++){let a=1.5707963+f32(i)*1.2566371;let b=a+2.5132741;d=min(d,segment2(q,.78*vec2f(cos(a),sin(a)),.78*vec2f(cos(b),sin(b))));}
  return min(d,abs(length(q)-.92));
 }
 if(kind<11.5){
  d=segment2(q,vec2f(0,-.8),vec2f(0,.8));
  d=min(d,segment2(q,vec2f(0,.05),vec2f(-.62,.65)));d=min(d,segment2(q,vec2f(0,.05),vec2f(.62,.65)));
  d=min(d,segment2(q,vec2f(0,-.25),vec2f(-.48,-.65)));d=min(d,segment2(q,vec2f(0,-.25),vec2f(.48,-.65)));
  return min(d,abs(abs(q.x)+abs(q.y+.2)-.32)*.7071068);
 }
 return abs(length(q)-.72);
}
fn jetDirection()->vec3f{
 let t=p.step.y;let sweep=select(0.,sin(t*1.8)*.7,p.effect.x>19.5);
 return normalize(vec3f(cos(sweep),.24+.12*sin(t*2.1),sin(sweep)));
}
fn charge(x:vec3f)->f32{
 if(p.source.w<.5||p.step.z<0.||(p.effect.w<.5&&p.step.z>p.effect.z)){return 0.;}
 let q=(x-p.source.xyz)/p.effect.y;
 if(object.options.x>.5){return surfaceFeed(x);}
 if(p.effect.x>18.5){
  let d=jetDirection();let axial=dot(q,d);let radial=length(q-d*axial);
  let pulse=select(1.,1.-smoothstep(.22,.30,fract(p.step.z/.82)),p.effect.x>20.5);
  let breakup=.35+.9*noise(q*28.+vec3f(p.step.y*7.,p.step.y*-11.,p.step.y*5.));
  return exp(-pow(radial/.14,2.)-pow(axial/.20,2.))*pulse*breakup;
 }
 if(p.effect.x>.5){
  if(any(abs(q)>vec3f(1.6))){return 0.;}
  var r2=dot(q/vec3f(.26,.12,.26),q/vec3f(.26,.12,.26));
  if(p.effect.x>1.5&&p.effect.x<2.5){r2=pow((length(q.xz)-.65)/.12,2.)+pow(q.y/.10,2.);}
  if(p.effect.x>2.5&&p.effect.x<3.5){r2=pow(max(abs(q.x)-1.,0.)/.15,2.)+pow(q.y/.12,2.)+pow(q.z/.15,2.);}
  if(p.effect.x>3.5&&p.effect.x<4.5){r2=pow((length(q)-.52)/.12,2.);}
  if(p.effect.x>4.5&&p.effect.x<5.5){r2=pow((max(abs(q.x),max(abs(q.y),abs(q.z)))-.6)/.055,2.);}
  if(p.effect.x>5.5&&p.effect.x<6.5){let a=q.y*7.8539816;let radial=length(q.xz-.5*vec2f(cos(a),sin(a)));r2=pow(radial/.075,2.)+pow(max(abs(q.y)-.8,0.)/.06,2.);}
  if(p.effect.x>6.5&&p.effect.x<7.5){let nearJet=vec3f(abs(q.x)-.48,q.y,q.z)/vec3f(.12,.10,.12);r2=dot(nearJet,nearJet);}
  var support=1.;
  if(p.effect.x>7.5&&p.effect.x<12.5){
   let isCybr=p.effect.x>9.5&&p.effect.x<10.5;
   if(abs(q.z)>select(.3,.65,isCybr)){return 0.;}
   var stroke=0.;
   if(p.effect.x>9.5&&p.effect.x<10.5){
    let uv=vec2f((q.x*4.+7.)/14.,(q.y*4.+2.95)/7.875);
    support=textureSampleLevel(sigilSource,smp,uv,0).r;
   }else{stroke=glyphDistance(q.xy,p.effect.x);}
   r2=pow(stroke/.045,2.)+pow(q.z/select(.055,.14,isCybr),2.);
  }
  // Two inward-facing nozzles; their momentum meets above the source.
  if(p.effect.x>12.5&&p.effect.x<13.5){let nozzle=vec3f(abs(q.x)-.65,q.y,q.z)/vec3f(.10,.12,.12);r2=dot(nozzle,nozzle);}
  // A broad shallow fuel bed tests a large connected smoke sheet.
  if(p.effect.x>13.5&&p.effect.x<14.5){r2=pow(max(abs(q.x)-.7,0.)/.12,2.)+pow(q.y/.08,2.)+pow(max(abs(q.z)-.7,0.)/.12,2.);}
  let feed=noise(q*12.+vec3f(0,p.step.y*2.,0));
  return support*exp(-1.5*r2)*select(.65+.35*feed,.08+1.15*smoothstep(.25,.75,feed),p.effect.w>.5);
 }
 let r=length(q);if(r>.7){return 0.;}
 let n=noise(q*9.+vec3f(p.shape.x,13.7,4.1));
 let radius=.39+(.16*n)+.045*sin(atan2(q.z,q.x)*5.+q.y*11.);
 return (1.-smoothstep(radius-.10,radius+.03,r))*(.6+.4*noise(q*16.+8.));
}
fn sourceVelocity(x:vec3f)->vec3f{
 let q=x-p.source.xyz;let r=length(q);let dir=q/max(r,.03);
 if(object.options.x>.5){return (objectNormal(x)*.32+vec3f(0,.65,0))*p.dynamics.x;}
 if(p.effect.x>18.5){let d=jetDirection();let side=normalize(cross(d,vec3f(0,1,0)));let up=cross(side,d);let jitter=vec2f(noise(q*22.+vec3f(p.step.y*9.,4,8)),noise(q*22.+vec3f(3,p.step.y*11.,7)))*2.-1.;return d*p.dynamics.x*5.+(side*jitter.x+up*jitter.y)*1.4;}
 let asym=1.+.35*sin(atan2(q.z,q.x)*3.+q.y*7.);
 if(p.effect.x>12.5&&p.effect.x<13.5){return vec3f(-sign(q.x)*3.4,2.0,0)*p.dynamics.x;}
 if(p.effect.w>.5){return (vec3f(-q.z*2.*p.dynamics.z,3.8,q.x*2.*p.dynamics.z)+select(vec3f(0),dir*2.,p.effect.x>3.5&&p.effect.x<5.5))*p.dynamics.x;}
 return (dir*(3.8*asym)+vec3f(-q.z*2.*p.dynamics.z,1.6,q.x*2.*p.dynamics.z))*p.dynamics.x;
}
fn turbulence(x:vec3f)->vec3f{
 // Analytic curl of a three-component vector potential: divergence-free
 // before masks. Pressure projects the masked force with the other forces.
 let q=x*7.7+vec3f(.3,.7,-.2)*p.step.y;
 let a=vec3f(cos(q.y+1.3)*sin(q.z),cos(q.z+2.1)*sin(q.x),cos(q.x+.7)*sin(q.y));
 let b=vec3f(sin(q.y+1.3)*cos(q.z),sin(q.z+2.1)*cos(q.x),sin(q.x+.7)*cos(q.y));
 return vec3f(a.z-b.y,a.x-b.z,a.y-b.x);
}
`;
// Predictor alpha caches a shared limiter donor: exact half-float codes 1..64,
// or 0 for the original tracing path. Corrected alpha remains source expansion.
// Near-integer coordinates fall back because separate kernels can round a
// trace to opposite sides of a donor boundary.
const advectVelocity=common+`
@group(0) @binding(2) var v:texture_3d<f32>;
@group(0) @binding(3) var dst:texture_storage_3d<rgba16float,write>;
@compute @workgroup_size(8,4,4) fn main(@builtin(global_invocation_id) i:vec3u){
 if(any(i>vec3u(N))){return;}var out=vec3f(0);
 var donor=vec3i(0);var commonDonor=true;
 for(var k=0u;k<3u;k++){
  let x=face(i,k);let back=trace(v,x,p.step.x);out[k]=component(v,back,k);
  var off=vec3f(.5);off[k]=0.;let q=(back-LO)/H-off;let cell=vec3i(floor(q));
  let fraction=q-vec3f(cell);let margin=min(fraction,vec3f(1.)-fraction);
  let tolerance=8.*1.1920929e-7*max(abs(q),vec3f(1.));
  commonDonor=commonDonor&&all(margin>tolerance);
  if(k==0u){donor=cell;}else{commonDonor=commonDonor&&all(donor==cell);}
 }
 let offset=donor-vec3i(i);var encoded=0u;
 if(commonDonor&&all(offset>=vec3i(-2))&&all(offset<=vec3i(1))){
  let q=vec3u(offset+vec3i(2));encoded=1u+q.x+4u*q.y+16u*q.z;
 }
 if(i.y==0u){out.y=0.;}textureStore(dst,vec3i(i),vec4f(out,f32(encoded)));
}`;
const curl=common+`
@group(0) @binding(2) var v:texture_3d<f32>;
@group(0) @binding(3) var dst:texture_storage_3d<rgba16float,write>;
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) i:vec3u){
 if(any(i>=vec3u(N))){return;}let x=LO+(vec3f(i)+.5)*H;
 let dx=vec3f(H,0,0);let dy=vec3f(0,H,0);let dz=vec3f(0,0,H);
 let w=vec3f(component(v,x+dy,2u)-component(v,x-dy,2u)-component(v,x+dz,1u)+component(v,x-dz,1u),
 component(v,x+dz,0u)-component(v,x-dz,0u)-component(v,x+dx,2u)+component(v,x-dx,2u),
 component(v,x+dx,1u)-component(v,x-dx,1u)-component(v,x+dy,0u)+component(v,x-dy,0u))/(2.*H);
 textureStore(dst,vec3i(i),vec4f(w,length(w)));
}`;
const correctVelocity=common+`
@group(0) @binding(2) var old:texture_3d<f32>;
@group(0) @binding(3) var pred:texture_3d<f32>;
@group(0) @binding(4) var chem:texture_3d<f32>;
@group(0) @binding(5) var vort:texture_3d<f32>;
@group(0) @binding(6) var dst:texture_storage_3d<rgba16float,write>;
fn limitedCell(cell:vec3i,k:u32,value:f32)->f32{
 var lo=1e20;var hi=-1e20;
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var a=0;a<2;a++){let v=loadV(old,cell+vec3i(a,y,z))[k];lo=min(lo,v);hi=max(hi,v);}}}
 return clamp(value,lo,hi);
}
fn limited(x:vec3f,k:u32,value:f32)->f32{
 var off=vec3f(.5);off[k]=0.;return limitedCell(vec3i(floor((x-LO)/H-off)),k,value);
}
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) i:vec3u){
 if(any(i>vec3u(N))){return;}var out=vec3f(0);
 let encoded=loadV(pred,vec3i(i)).w;let hasDonor=encoded>=1.&&encoded<=64.;
 let packed=u32(max(encoded-1.,0.));
 let donor=vec3i(i)+vec3i(i32(packed&3u)-2,i32((packed>>2u)&3u)-2,i32((packed>>4u)&3u)-2);
 for(var k=0u;k<3u;k++){
  let x=face(i,k);
  out[k]=loadV(pred,vec3i(i))[k]+.5*(loadV(old,vec3i(i))[k]-component(pred,trace(old,x,-p.step.x),k));
 }
 if(hasDonor){
  var lo=vec3f(1e20);var hi=vec3f(-1e20);
  for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var dx=0;dx<2;dx++){
   let value=loadV(old,donor+vec3i(dx,y,z)).xyz;lo=min(lo,value);hi=max(hi,value);
  }}}
  out=clamp(out,lo,hi);
 }else{
  for(var k=0u;k<3u;k++){out[k]=limited(trace(old,face(i,k),p.step.x),k,out[k]);}
 }
 let x=LO+(vec3f(i)+.5)*H;let c=scalar(chem,x);
 let w=scalar(vort,x);let dx=vec3f(H,0,0);let dy=vec3f(0,H,0);let dz=vec3f(0,0,H);
 let g=vec3f(scalar(vort,x+dx).w-scalar(vort,x-dx).w,scalar(vort,x+dy).w-scalar(vort,x-dy).w,scalar(vort,x+dz).w-scalar(vort,x-dz).w);
 let confinement=2.0*H*cross(g/max(length(g),.00001),w.xyz);
 let forcing=confinement+turbulence(x)*min(c.x+c.y,1.)*.9*p.chemistry.w+vec3f(0,c.y*3.0*p.dynamics.w-c.x*.10,0);
 out+=forcing*p.step.x;
 // Brinkman-style damping inside stationary solids before projection.
 // Scalars are separately excluded; this is not a cut-cell pressure solve.
 if(objectDistance(x)<-.018){out*=exp(-p.step.x*240.);}
 let s=charge(x);if(s>0.){out=mix(out,sourceVelocity(x),1.-exp(-s*p.step.x*65.));}
 if(i.y==0u){out.y=0.;}
 // Open sides and top; only incoming boundary velocities are suppressed.
 if(i.x==0u){out.x=min(out.x,0.);}if(i.x==N){out.x=max(out.x,0.);}
 if(i.z==0u){out.z=min(out.z,0.);}if(i.z==N){out.z=max(out.z,0.);}
 if(i.y==N){out.y=max(out.y,0.);}
 let expansion=s*45.*p.dynamics.y+flameActivity(c)*1.2;
 textureStore(dst,vec3i(i),vec4f(out,expansion));
}`;
const advectScalar=common+`
@group(0) @binding(2) var v:texture_3d<f32>;
@group(0) @binding(3) var old:texture_3d<f32>;
@group(0) @binding(4) var dst:texture_storage_3d<rgba16float,write>;
@group(0) @binding(6) var<storage,read> bricks:array<vec4u>;
@compute @workgroup_size(4,4,4) fn main(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) local:vec3u){
 let i=bricks[group.x].xyz*8u+vec3u(group.y,group.z%2u,group.z/2u)*4u+local;
 if(any(i>=vec3u(D))){return;}let x=LO+(vec3f(i)+.5)*6./f32(D);
 textureStore(dst,vec3i(i),scalar(old,trace(v,x,p.step.x)));
}`;
const correctScalar=common+`
@group(0) @binding(2) var v:texture_3d<f32>;
@group(0) @binding(3) var old:texture_3d<f32>;
@group(0) @binding(4) var pred:texture_3d<f32>;
@group(0) @binding(5) var dst:texture_storage_3d<rgba16float,write>;
fn oldCell(i:vec3i)->vec4f{if(any(i<vec3i(0))||any(i>=vec3i(i32(D)))){return vec4f(0);}return textureLoad(old,i,0);}
@group(0) @binding(6) var<storage,read> bricks:array<vec4u>;
@group(0) @binding(7) var<storage,read_write> occupied:array<atomic<u32>>;
@group(0) @binding(10) var<storage,read_write> opticalOccupied:array<atomic<u32>>;
var<workgroup> alive:atomic<u32>;
var<workgroup> opticalAlive:atomic<u32>;
@compute @workgroup_size(4,4,4) fn main(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(local_invocation_index) lane:u32){
 if(lane==0u){atomicStore(&alive,0u);atomicStore(&opticalAlive,0u);}workgroupBarrier();
 let brick=bricks[group.x].xyz;let i=brick*8u+vec3u(group.y,group.z%2u,group.z/2u)*4u+local;
 let x=LO+(vec3f(i)+.5)*6./f32(D);let back=trace(v,x,p.step.x);
 let forward=textureLoad(pred,vec3i(i),0);var c=forward+.5*(textureLoad(old,vec3i(i),0)-scalar(pred,trace(v,x,-p.step.x)));
 let cell=vec3i(floor((back-LO)/6.*f32(D)-.5));var lo=vec4f(1e20);var hi=vec4f(-1e20);
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var a=0;a<2;a++){let q=oldCell(cell+vec3i(a,y,z));lo=min(lo,q);hi=max(hi,q);}}}
 // Limit the correction continuously instead of switching entire components
 // back to the predictor. At sub-voxel travel, repeated reverse-advection
 // corrections imprint the velocity lattice into slow soot and flame fronts.
 // Fade only that unresolved correction; moving flames retain second order
 // transport. The donor bounds still prevent new extrema in every scalar.
 let correction=c-forward;
 let capacity=max(select(forward-lo,hi-forward,correction>=vec4f(0)),vec4f(0));
 let travel=length(x-back)*f32(D)/6.;
 let resolved=smoothstep(.15,.75,travel);
 c=forward+correction*min(vec4f(resolved),capacity/max(abs(correction),vec4f(.0000001)));
 c=max(c,vec4f(0));
 let goal=textureSampleLevel(v,smp,((x-LO)/H+.5)/f32(N+1u),0).w;
 // Soot and fuel are transported mass concentrations. Expansion must dilute
 // both together; diluting only soot lets emissive fuel outrun visible smoke.
 let dilution=exp(-max(goal,0.)*p.step.x);
 c.x*=dilution;c.z*=dilution;
 // Consume mixed fuel and oxygen together. Fuel no longer disappears on a
 // timer, and soot/heat no longer depend on a grid-gradient threshold.
 c.w=min(c.w,1.);
 let burned=min(c.z,reactionRate(c)*(1.-exp(-4.*p.step.x))/4.);
 c.z=max(c.z-burned,0.);c.w=min(c.w+burned*.7,1.);
 c.y=(c.y+burned*3.2/(1.+c.z))*exp(-p.step.x*(.9+.7*max(c.y-1.4,0.)));
 c.x=(c.x+burned*mix(.12,1.8,p.shape.z)*p.chemistry.z)*exp(-p.step.x*.045);
 if(p.step.w>.5){c.z=0.;c.w=0.;c.y*=exp(-p.step.x*.12);}
 let s=charge(x);if(s>0.&&object.options.x>.5){
  // Add pyrolysis fuel and sensible heat; never overwrite existing gas state.
  // The surface supplies no soot: soot is produced by the reaction above.
  let heat=surfaceState(x).y;let added=min(s*p.step.x*p.chemistry.y*2.,.2);
  c.y=(c.y+added*heat)/(1.+added)+(heat-c.y)*(1.-exp(-p.step.x*s*10.));
  c.z+=select(added,0.,p.step.w>.5);c.w=1.-(1.-c.w)/(1.+added);
 }else if(s>0.){let n=noise((x-p.source.xyz)*12.+vec3f(p.shape.x,7.,4.));
 let weight=1.-exp(-s*p.step.x*90.);
 // Continuous emitters feed fuel; most soot is formed by combustion.
 let injectedSoot=select(mix(.3,3.4,sqrt(p.shape.z)),.035*p.shape.z,p.effect.w>.5);
 let sootTarget=select(injectedSoot*p.chemistry.z,1.4*p.chemistry.z,p.step.w>.5);
 // A source adds soot; it must not erase the advected plume when fresh fuel arrives.
 c.x=max(c.x,mix(c.x,sootTarget,weight));
 c.y=mix(c.y,(.75+.6*n)*p.chemistry.x,weight);
 c.z=mix(c.z,select((.6+1.25*n)*p.chemistry.y,0.,p.step.w>.5),weight);
 c.w=mix(c.w,select(1.,0.,p.step.w>.5),weight);
 }
 if(objectDistance(x)<-.02){c=vec4f(0);}
 // Quantize only numerical residue below the renderer's visible support.
 // Keeping half-float subnormals alive otherwise expands sparse work forever.
 c=select(c,vec4f(0),c<vec4f(.000001,.00001,.000001,.0001));
 textureStore(dst,vec3i(i),max(c,vec4f(0)));
 if(any(c>vec4f(0))){atomicOr(&alive,1u);}
 // Bit 1 covers the existing camera/light support; its margins include
 // half-float writes. A convex filtered sample cannot exceed its texels'
 // soot/heat maxima, so a zero halo proves the fragment's early continue.
 // Bit 2 keeps every positive soot value for exact shadow extinction.
 if(c.x>=.000033||c.y>.3499){atomicOr(&opticalAlive,1u);}
 if(c.x>0.){atomicOr(&opticalAlive,2u);}workgroupBarrier();
 if(lane==0u){let B=D/8u;let index=brick.x+B*(brick.y+B*brick.z);
  if(atomicLoad(&alive)>0u){atomicStore(&occupied[index],1u);}
  if(atomicLoad(&opticalAlive)>0u){atomicOr(&opticalOccupied[index],atomicLoad(&opticalAlive));}
 }
}`;
const rhs=common+`
@group(0) @binding(2) var v:texture_3d<f32>;
@group(0) @binding(3) var b:texture_storage_3d<r32float,write>;
@group(0) @binding(4) var zero:texture_storage_3d<r32float,write>;
@group(0) @binding(5) var previous:texture_3d<f32>;
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3u){
 if(any(id>=vec3u(N))){return;}let i=vec3i(id);let q=loadV(v,i);
 let div=(loadV(v,i+vec3i(1,0,0)).x-q.x+loadV(v,i+vec3i(0,1,0)).y-q.y+loadV(v,i+vec3i(0,0,1)).z-q.z)/H;
 textureStore(b,i,vec4f((q.w-div)*H*H));textureStore(zero,i,vec4f(textureLoad(previous,i,0).x*p.shape.w));
}`;
const project=common+`
@group(0) @binding(2) var v:texture_3d<f32>;
@group(0) @binding(3) var pressure:texture_3d<f32>;
@group(0) @binding(4) var rhs:texture_3d<f32>;
@group(0) @binding(5) var dst:texture_storage_3d<rgba16float,write>;
@group(0) @binding(6) var<storage,read_write> stats:array<vec4f>;
var<workgroup> vmax:array<f32,64>;var<workgroup> pre:array<f32,64>;var<workgroup> post:array<f32,64>;var<workgroup> counts:array<f32,64>;
fn phi(i:vec3i)->f32{
 let signX=select(1.,-1.,i.x<0||i.x>=i32(N));let signY=select(1.,-1.,i.y>=i32(N));let signZ=select(1.,-1.,i.z<0||i.z>=i32(N));
 return signX*signY*signZ*textureLoad(pressure,clamp(i,vec3i(0),vec3i(i32(N)-1)),0).x;
}
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3u){
 vmax[lane]=0.;pre[lane]=0.;post[lane]=0.;counts[lane]=0.;
 if(all(id<=vec3u(N))){let i=vec3i(id);let q=loadV(v,i);
 var out=q.xyz-vec3f(phi(i)-phi(i-vec3i(1,0,0)),phi(i)-phi(i-vec3i(0,1,0)),phi(i)-phi(i-vec3i(0,0,1)))/H;
 // Packed MAC channels have different valid tangential extents. Extrapolate
 // their projected valid face instead of repeatedly projecting a ghost slot.
 if(id.y==N||id.z==N){
  let j=vec3i(i.x,min(i.y,i32(N)-1),min(i.z,i32(N)-1));
  out.x=loadV(v,j).x-(phi(j)-phi(j-vec3i(1,0,0)))/H;
 }
 if(id.x==N||id.z==N){
  let j=vec3i(min(i.x,i32(N)-1),i.y,min(i.z,i32(N)-1));
  out.y=loadV(v,j).y-(phi(j)-phi(j-vec3i(0,1,0)))/H;
 }
 if(id.x==N||id.y==N){
  let j=vec3i(min(i.x,i32(N)-1),min(i.y,i32(N)-1),i.z);
  out.z=loadV(v,j).z-(phi(j)-phi(j-vec3i(0,0,1)))/H;
 }
 if(id.y==0u){out.y=0.;}textureStore(dst,i,vec4f(out,q.w));
 vmax[lane]=length(out);
 if(all(id<vec3u(N))){
 let b=textureLoad(rhs,i,0).x;
 let A=6.*phi(i)-phi(i+vec3i(1,0,0))-phi(i-vec3i(1,0,0))-phi(i+vec3i(0,1,0))-phi(i-vec3i(0,1,0))-phi(i+vec3i(0,0,1))-phi(i-vec3i(0,0,1));
 pre[lane]=abs(b)/(H*H);post[lane]=abs(b-A)/(H*H);counts[lane]=1.;
 }}workgroupBarrier();
 for(var stride=32u;stride>0u;stride/=2u){if(lane<stride){vmax[lane]=max(vmax[lane],vmax[lane+stride]);pre[lane]+=pre[lane+stride];post[lane]+=post[lane+stride];counts[lane]+=counts[lane+stride];}workgroupBarrier();}
 if(lane==0u){let G=(N+4u)/4u;stats[group.x+G*(group.y+G*group.z)]=vec4f(vmax[0],pre[0],post[0],counts[0]);}
}`;
const buildBricks=common+`
@group(0) @binding(2) var<storage,read> oldMask:array<u32>;
@group(0) @binding(3) var<storage,read> previousMask:array<u32>;
@group(0) @binding(4) var<storage,read_write> bricks:array<vec4u>;
struct Dispatch{x:atomic<u32>,y:u32,z:u32};
@group(0) @binding(5) var<storage,read_write> dispatch:Dispatch;
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3u){
 let B=i32(D/8u);if(any(id>=vec3u(u32(B)))){return;}var live=false;
 for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
 let cell=vec3i(id)+vec3i(x,y,z);if(all(cell>=vec3i(0))&&all(cell<vec3i(B))){let index=u32(cell.x+B*(cell.y+B*cell.z));live=live||oldMask[index]>0u||previousMask[index]>0u;}
 }}}
 let at=LO+(vec3f(id)+.5)*6./f32(B);
 // Conservative brick/source intersection. Gaussian tails beyond r2=25
 // are <6e-17, far below a representable injected rgba16float value.
 // Existing state still uses the unchanged one-brick transport halo above.
 let halfBrick=3./f32(B);let nearQ=max(abs(at-p.source.xyz)-vec3f(halfBrick),vec3f(0))/p.effect.y;
 let farQ=(abs(at-p.source.xyz)+vec3f(halfBrick))/p.effect.y;
 var sourceLive=all(nearQ<vec3f(.85));
 if(p.effect.x>.5){
  var r2=dot(nearQ/vec3f(.26,.12,.26),nearQ/vec3f(.26,.12,.26));
  if(p.effect.x>1.5&&p.effect.x<2.5){let radial=max(max(length(nearQ.xz)-.65,.65-length(farQ.xz)),0.);r2=pow(radial/.12,2.)+pow(nearQ.y/.10,2.);}
  if(p.effect.x>2.5&&p.effect.x<3.5){r2=pow(max(nearQ.x-1.,0.)/.15,2.)+pow(nearQ.y/.12,2.)+pow(nearQ.z/.15,2.);}
  if(p.effect.x>3.5&&p.effect.x<4.5){r2=pow(max(max(length(nearQ)-.52,.52-length(farQ)),0.)/.12,2.);}
  sourceLive=all(nearQ<=vec3f(1.6))&&r2<=25.;
  if(p.effect.x>4.5){
   var extent=vec3f(.90);
   if(p.effect.x>5.5&&p.effect.x<6.5){extent=vec3f(.90,1.12,.90);}
   if(p.effect.x>6.5&&p.effect.x<7.5){extent=vec3f(1.10,.62,.62);}
   if(p.effect.x>7.5&&p.effect.x<12.5){extent=vec3f(1.20,1.20,.30);}
   if(p.effect.x>9.5&&p.effect.x<10.5){extent=vec3f(1.20,.65,.65);}
   if(p.effect.x>12.5&&p.effect.x<13.5){extent=vec3f(1.18,.65,.65);}
   if(p.effect.x>13.5){extent=vec3f(1.35,.45,1.35);}
   if(p.effect.x>14.5&&p.effect.x<18.5){extent=vec3f(1.6);}
   if(p.effect.x>18.5){extent=vec3f(.45);}
   sourceLive=all(nearQ<=extent);
  }
 }
 if(object.options.x>.5){
  let center=clamp(at,object.origin.xyz-vec3f(1.49*object.origin.w),object.origin.xyz+vec3f(1.49*object.origin.w));
  let d=objectDistance(center)+length(at-center);
  // Conservative shell/brick intersection, including interpolation padding.
  let radius=halfBrick*1.733+.05*object.origin.w;
  sourceLive=d<.13*object.origin.w+radius&&d>-.02*object.origin.w-radius;
 }
 live=live||(p.source.w>.5&&(p.effect.w>.5||p.step.z<p.effect.z)&&sourceLive);
 if(live){let index=atomicAdd(&dispatch.x,1u);bricks[index]=vec4u(id,0u);}
}`;
const reduceStats=`
@group(0) @binding(0) var<storage,read> groups:array<vec4f>;
@group(0) @binding(1) var<storage,read_write> out:array<vec4f>;
var<workgroup> values:array<vec4f,256>;
@compute @workgroup_size(256) fn main(@builtin(local_invocation_index) lane:u32){
 var value=vec4f(0);for(var i=lane;i<${Math.ceil((N+1)/4)**3}u;i+=256u){let q=groups[i];value=vec4f(max(value.x,q.x),value.yzw+q.yzw);}values[lane]=value;workgroupBarrier();
 for(var stride=128u;stride>0u;stride/=2u){if(lane<stride){let a=values[lane];let b=values[lane+stride];values[lane]=vec4f(max(a.x,b.x),a.yzw+b.yzw);}workgroupBarrier();}
 if(lane==0u){let previous=out[0];out[0]=vec4f(max(previous.x,values[0].x),previous.yzw+values[0].yzw);}
}`;
return {advectVelocity,curl,correctVelocity,advectScalar,correctScalar,rhs,project,buildBricks,reduceStats};
}

export function pressureShaders(n){
const common=`const N:i32=${n};
@group(0) @binding(0) var p:texture_3d<f32>;
@group(0) @binding(1) var b:texture_3d<f32>;
@group(0) @binding(2) var dst:texture_storage_3d<r32float,write>;
fn at(i:vec3i)->f32{let sx=select(1.,-1.,i.x<0||i.x>=N);let sy=select(1.,-1.,i.y>=N);let sz=select(1.,-1.,i.z<0||i.z>=N);return sx*sy*sz*textureLoad(p,clamp(i,vec3i(0),vec3i(N-1)),0).x;}
fn sum(i:vec3i)->f32{return at(i+vec3i(1,0,0))+at(i-vec3i(1,0,0))+at(i+vec3i(0,1,0))+at(i-vec3i(0,1,0))+at(i+vec3i(0,0,1))+at(i-vec3i(0,0,1));}
`;
return {
 // The 4^3 coarse grid fits in one workgroup. Keep all 24 Jacobi
 // iterations in shared memory, with the same f32 arithmetic and boundaries.
 ...(n===4?{coarse:common+`
var<workgroup> values:array<f32,64>;
var<workgroup> next:array<f32,64>;
fn localAt(i:vec3i)->f32{
 let sx=select(1.,-1.,i.x<0||i.x>=4);let sy=select(1.,-1.,i.y>=4);let sz=select(1.,-1.,i.z<0||i.z>=4);
 let q=clamp(i,vec3i(0),vec3i(3));return sx*sy*sz*values[u32(q.x+4*(q.y+4*q.z))];
}
@compute @workgroup_size(4,4,4) fn main(@builtin(local_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32){
 let i=vec3i(id);let rhs=textureLoad(b,i,0).x;values[lane]=textureLoad(p,i,0).x;workgroupBarrier();
 for(var j=0u;j<24u;j++){
  let neighbors=localAt(i+vec3i(1,0,0))+localAt(i-vec3i(1,0,0))+localAt(i+vec3i(0,1,0))+localAt(i-vec3i(0,1,0))+localAt(i+vec3i(0,0,1))+localAt(i-vec3i(0,0,1));
  next[lane]=mix(values[lane],(neighbors+rhs)/6.,.6666667);workgroupBarrier();
  values[lane]=next[lane];workgroupBarrier();
 }
 textureStore(dst,i,vec4f(values[lane]));
}`}:{}),
 smooth:common+`@compute @workgroup_size(8,8,4) fn main(@builtin(global_invocation_id) id:vec3u){if(any(id>=vec3u(u32(N)))){return;}let i=vec3i(id);textureStore(dst,i,vec4f(mix(at(i),(sum(i)+textureLoad(b,i,0).x)/6.,.6666667)));}`,
 restrict:common+`@group(0) @binding(3) var zero:texture_storage_3d<r32float,write>;
 @compute @workgroup_size(8,8,4) fn main(@builtin(global_invocation_id) id:vec3u){if(any(id>=vec3u(u32(N/2)))){return;}var r=0.;for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){let i=vec3i(id)*2+vec3i(x,y,z);r+=textureLoad(b,i,0).x-6.*at(i)+sum(i);}}}textureStore(dst,vec3i(id),vec4f(r*.5));textureStore(zero,vec3i(id),vec4f(0));}`,
 prolong:common+`fn coarse(i:vec3i)->f32{let sx=select(1.,-1.,i.x<0||i.x>=N/2);let sy=select(1.,-1.,i.y>=N/2);let sz=select(1.,-1.,i.z<0||i.z>=N/2);return sx*sy*sz*textureLoad(b,clamp(i,vec3i(0),vec3i(N/2-1)),0).x;}
 @compute @workgroup_size(8,8,4) fn main(@builtin(global_invocation_id) id:vec3u){if(any(id>=vec3u(u32(N)))){return;}let q=(vec3f(id)+.5)*.5-.5;let lo=vec3i(floor(q));let f=fract(q);var c=0.;for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){let o=vec3i(x,y,z);let w=select(vec3f(1)-f,f,vec3<bool>(x==1,y==1,z==1));c+=coarse(lo+o)*w.x*w.y*w.z;}}}textureStore(dst,vec3i(id),vec4f(at(vec3i(id))+c));}`
};
}
