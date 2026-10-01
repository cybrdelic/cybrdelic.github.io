import {objectWGSL} from './objects.js?v=54c82352661e679d';
import {combustionWGSL} from './combustion.js?v=54c82352661e679d';
import {sparseSamplerWGSL} from './sparse-field.js?v=54c82352661e679d';
import {lightWorkEntryWGSL,lightReceiverEntryWGSL,withLightingReceiverSupport} from './lighting-work.js?v=54c82352661e679d';
import {sigilGuideWGSL} from './sigil-guide.js?v=54c82352661e679d';
import {floorFuelRenderWGSL} from './floor-fuel.js?v=54c82352661e679d';
import {woodMaterialWGSL} from '../wood-material.js?v=54c82352661e679d';
// Five room faces share this irradiance resolution. Keep atlas allocation,
// compute dispatch and sampling coordinates in sync with this value.
export const ROOM_SIZE=64;
// Volumetric integration in world units. No animated render noise or flipbooks.
function renderSource(tree,sparse,fastSeams){return `
${combustionWGSL}
${objectWGSL}
${woodMaterialWGSL}
struct View{eye:vec4f,right:vec4f,up:vec4f,forward:vec4f,options:vec4f,ambient:vec4f,
 spotPos0:vec4f,spotDir0:vec4f,spotPower0:vec4f,spotPos1:vec4f,spotDir1:vec4f,spotPower1:vec4f};
${sparse ? sparseSamplerWGSL({D:256,brick:8,atlasTiles:20,name:'field',atlasBinding:0,pagesBinding:25,samplerName:'smp',declareSampler:false,seamMode:fastSeams?'filtered':'manual'}) : '@group(0) @binding(0) var chem:texture_3d<f32>;'}
@group(0) @binding(1) var smp:sampler;
@group(0) @binding(2) var<uniform> cam:View;
@group(0) @binding(3) var illumination:texture_3d<f32>;
@group(0) @binding(6) var directRoom:texture_2d<f32>;
@group(0) @binding(7) var finalRoom:texture_2d<f32>;
@group(0) @binding(9) var<storage,read> occupied:array<u32>;
${tree?`@group(0) @binding(18) var meshPosition:texture_2d<f32>;
@group(0) @binding(19) var meshNormal:texture_2d<f32>;
@group(0) @binding(20) var meshColor:texture_2d<f32>;
@group(0) @binding(23) var meshShadows:texture_depth_2d_array;
@group(0) @binding(24) var meshCompare:sampler_comparison;
`:''}
struct FireLight{position:vec4f,power:vec4f,lower:vec4f,upper:vec4f};
@group(0) @binding(5) var<storage,read> lights:array<FireLight>;
const LO=vec3f(-3,0,-3);const EXT=vec3f(6);
const ROOM_SIZE:f32=${ROOM_SIZE}.;
${sparse ? '' : 'fn field(x:vec3f)->vec4f{if(any(x<LO)||any(x>LO+EXT)){return vec4f(0);}return textureSampleLevel(chem,smp,(x-LO)/EXT,0);}' }
${sigilGuideWGSL}
${floorFuelRenderWGSL}
@group(0) @binding(45) var floorWoodWear:texture_2d<f32>;
fn floorWearAt(xz:vec2f)->vec4f{let size=vec2i(textureDimensions(floorWoodWear));return textureLoad(floorWoodWear,clamp(vec2i((xz+3.)/6.*vec2f(size)),vec2i(0),size-1),0);}
fn extinction(c:vec4f)->f32{return c.x*3.0;}
fn emission(c:vec4f)->vec3f{
 let reaction=flameActivity(c);
 if(c.y<=.2||(reaction==0.&&c.x==0.)){return vec3f(0);}
 let kelvin=clamp(300.+1200.*c.y,700.,2800.);
 let wavelength=vec3f(.61,.55,.46);
 let spectrum=pow(vec3f(.61)/wavelength,vec3f(5.))*(exp(14388./(.61*kelvin))-1.)/(exp(vec3f(14388.)/(wavelength*kelvin))-vec3f(1.));
 return colorEmission(spectrum)*(reaction*3.2*pow(max(c.y-.2,0.),2.)+c.x*pow(max(c.y-.55,0.),4.)*.12);
}
fn transmission(x:vec3f,l:vec3f,solidShadow:bool)->f32{
 let d=l-x;let distance=length(d);let ray=d/max(distance,.001);
 let safe=select(vec3f(.000001),ray,abs(ray)>vec3f(.000001));
 let a=(LO-x)/safe;let b=(LO+EXT-x)/safe;let near=min(a,b);let far=max(a,b);
 let start=max(0.,max(near.x,max(near.y,near.z)));let end=min(distance,min(far.x,min(far.y,far.z)));
 if(solidShadow&&object.options.x>.5&&objectHit(x+ray*.035,ray,max(distance-.07,0.))<distance-.071){return 0.;}
 if(end<=start){return 1.;}let step=(end-start)/12.;var tau=0.;
 for(var i=0;i<12;i++){let at=x+ray*(start+(f32(i)+.5)*step);
  // The soot shadow bit has a full-brick interpolation halo. A zero bit
  // proves zero extinction, including faint soot below camera visibility.
  // Keep the exact twelve-point lattice and separate solid/mesh occlusion.
  let brick=clamp(vec3u((at-LO)*(32./6.)),vec3u(0),vec3u(31));
  if((occupied[brick.x+32u*(brick.y+32u*brick.z)]&2u)!=0u){tau+=extinction(field(at))*step;}}
 return exp(-tau);
}
fn shadow(x:vec3f,l:vec3f)->f32{return transmission(x,l,true);}
${tree?`fn meshVisibility(at:vec3f,pos:vec4f,dir:vec4f,layer:i32)->f32{
 if(abs(object.tint.w)<.5){return 1.;}
 let delta=at-pos.xyz;let z=dot(delta,dir.xyz);if(z<=.05){return 1.;}
 let right=normalize(cross(dir.xyz,vec3f(0,1,0)));let up=cross(right,dir.xyz);let tan=sqrt(max(1.-dir.w*dir.w,.00001))/dir.w;
 let uv=vec2f(.5+dot(delta,right)/(2.*z*tan),.5-dot(delta,up)/(2.*z*tan));if(any(uv<vec2f(0))||any(uv>vec2f(1))){return 1.;}
 let depth=100./99.95-.05*100./(99.95*z)-.00008;
 return textureSampleCompareLevel(meshShadows,meshCompare,uv,layer,depth);
}
`:''}
fn spot(at:vec3f,normal:vec3f,pos:vec4f,dir:vec4f,power:vec4f,surface:bool,layer:i32)->vec3f{
 if(all(power.xyz==vec3f(0))){return vec3f(0);}
 let d=pos.xyz-at;let r2=max(dot(d,d),.001);let l=d*inverseSqrt(r2);
 let cone=smoothstep(dir.w,power.w,dot(-l,dir.xyz));
 let cosine=select(1.,max(dot(normal,l),0.),surface);
 if(cone*cosine<.0001){return vec3f(0);}
 return power.xyz*cone*cosine/(r2+.2)*${tree?'transmission(at,pos.xyz,abs(object.tint.w)<.5)*meshVisibility(at,pos,dir,layer)':'transmission(at,pos.xyz,true)'};
}
fn directIncoming(at:vec3f,normal:vec3f,surface:bool)->vec3f{
 var light=cam.ambient.xyz*select(1.,.25+.75*max(normal.y,0.),surface);
 light+=spot(at,normal,cam.spotPos0,cam.spotDir0,cam.spotPower0,surface,0);
 light+=spot(at,normal,cam.spotPos1,cam.spotDir1,cam.spotPower1,surface,1);
 for(var i=0u;i<8u;i++){
  let power=lights[i].power.xyz;if(dot(power,power)<.00001){continue;}
  let d=lights[i].position.xyz-at;let r2=max(dot(d,d),.001);let cosine=select(1.,max(dot(normal,d*inverseSqrt(r2)),0.),surface);
  if(cosine>.001){light+=power*cosine/(r2+max(.08,lights[i].position.w))*shadow(at,lights[i].position.xyz);}
 }
 return light;
}
fn roomPatch(face:u32,uv:vec2f)->vec4f{
 if(face==0u||face==4u){return vec4f(mix(-7.4,7.4,uv.x),select(0.,7.2,face==4u),mix(-3.4,10.,uv.y),198.32);}
 if(face==1u){return vec4f(mix(-7.4,7.4,uv.x),uv.y*7.2,-3.4,106.56);}
 return vec4f(select(-7.4,7.4,face==3u),uv.y*7.2,mix(-3.4,10.,uv.x),96.48);
}
fn patchNormal(face:u32)->vec3f{if(face==0u){return vec3f(0,1,0);}if(face==4u){return vec3f(0,-1,0);}if(face==1u){return vec3f(0,0,1);}return vec3f(select(1.,-1.,face==3u),0,0);}
fn bounceIncoming(at:vec3f,normal:vec3f,surface:bool)->vec3f{
 if(cam.options.x<.5||cam.options.z<=0.){return vec3f(0);}var sum=vec3f(0);
 for(var f=0u;f<5u;f++){for(var j=0u;j<2u;j++){
  let uv=vec2f(.3+.4*f32(j),.4);let source=roomPatch(f,uv);let n=patchNormal(f);let d=source.xyz-at;let r2=max(dot(d,d),.001);let l=d*inverseSqrt(r2);
  let cosine=max(dot(n,-l),0.)*select(1.,max(dot(normal,l),0.),surface);if(cosine<.00001){continue;}
  let incident=textureSampleLevel(directRoom,smp,vec2f((f32(f)+uv.x)/5.,uv.y),0).xyz;
  let area=source.w*.5;sum+=incident*vec3f(.115,.12,.125)/3.14159*cosine*area/(r2+area/3.14159)*shadow(at,source.xyz+n*.01);
 }}return sum*cam.options.z;
}
fn incoming(at:vec3f,n:vec3f,surface:bool)->vec3f{return directIncoming(at,n,surface)+bounceIncoming(at,n,surface);}
fn woodLit(at:vec3f,n:vec3f,albedo:vec3f,roughness:f32,grain:vec3f)->vec3f{
 let view=normalize(cam.eye.xyz-at);let diffuse=albedo/3.14159265;
 var result=diffuse*(cam.ambient.xyz*(.25+.75*max(n.y,0.))+bounceIncoming(at,n,true));
 let s0=spot(at,n,cam.spotPos0,cam.spotDir0,cam.spotPower0,true,0);
 let s1=spot(at,n,cam.spotPos1,cam.spotDir1,cam.spotPower1,true,1);
 result+=s0*(diffuse+vec3f(woodSpecular(n,normalize(cam.spotPos0.xyz-at),view,grain,roughness)));
 result+=s1*(diffuse+vec3f(woodSpecular(n,normalize(cam.spotPos1.xyz-at),view,grain,roughness)));
 for(var i=0u;i<8u;i++){
  let power=lights[i].power.xyz;if(dot(power,power)<.00001){continue;}
  let d=lights[i].position.xyz-at;let r2=max(dot(d,d),.001);let l=d*inverseSqrt(r2);let cosine=max(dot(n,l),0.);
  if(cosine>.001){let incident=power*cosine/(r2+max(.08,lights[i].position.w))*shadow(at,lights[i].position.xyz);
   result+=incident*(diffuse+vec3f(woodSpecular(n,l,view,grain,roughness)));}
 }return result;
}
fn roomIrradiance(at:vec3f,n:vec3f)->vec3f{
 var face=1.;var uv=vec2f((at.x+7.4)/14.8,at.y/7.2);
 if(abs(n.y)>.5){face=select(4.,0.,n.y>0.);uv=vec2f((at.x+7.4)/14.8,(at.z+3.4)/13.4);}
 else if(abs(n.x)>.5){face=select(3.,2.,n.x>0.);uv=vec2f((at.z+3.4)/13.4,at.y/7.2);}
 uv=clamp(uv,vec2f(.5/ROOM_SIZE),vec2f(1.-.5/ROOM_SIZE));return textureSampleLevel(finalRoom,smp,vec2f((face+uv.x)/5.,uv.y),0).xyz;
}
fn roomHit(eye:vec3f,ray:vec3f)->vec4f{
 var t=1e4;var n=vec3f(0);
 if(ray.y<-.0001){let q=-eye.y/ray.y;if(q>0.&&q<t){t=q;n=vec3f(0,1,0);}}
 if(ray.z<-.0001){let q=(-3.4-eye.z)/ray.z;if(q>0.&&q<t){t=q;n=vec3f(0,0,1);}}
 if(abs(ray.x)>.0001){let q=(sign(ray.x)*7.4-eye.x)/ray.x;if(q>0.&&q<t){t=q;n=vec3f(-sign(ray.x),0,0);}}
 if(ray.y>.0001){let q=(7.2-eye.y)/ray.y;if(q>0.&&q<t){t=q;n=vec3f(0,-1,0);}}
 return vec4f(n,t);
}
fn objectHit(eye:vec3f,ray:vec3f,limit:f32)->f32{
 if(object.options.x<.5){return limit;}
 let half=vec3f(${tree?'1.5':'1.49'}*object.origin.w);let low=select(object.origin.xyz-half,LO,woodMoved());let high=select(object.origin.xyz+half,LO+EXT,woodMoved());
 let safe=select(vec3f(.000001),ray,abs(ray)>vec3f(.000001));let a=(low-eye)/safe;let b=(high-eye)/safe;
 let near=min(a,b);let far=max(a,b);var t=max(0.,max(near.x,max(near.y,near.z)));let end=min(limit,min(far.x,min(far.y,far.z)));
${tree?` if(abs(object.tint.w)>.5){
  // For internal fire/GI rays, traverse the collision voxels exactly. The
  // old small sphere-tracing steps repeatedly filtered the same foliage
  // cells. Foliage is porous fuel, not an opaque solid canopy shell.
  let h=select(3.*object.origin.w/64.,6./128.,woodMoved());
  for(var i=0;i<384;i++){
   if(t>=end){break;}let at=eye+ray*(t+.00001);let cell=clamp(vec3i(floor((at-low)/h)),vec3i(0),vec3i(select(63,127,woodMoved())));
   let m=select(textureLoad(solid,cell,0),objectSample(at),woodMoved());if(m.x<0.&&m.w<7.5){return t;}
   let edge=low+(vec3f(cell)+select(vec3f(0),vec3f(1),ray>vec3f(0)))*h;
   let cross=select(vec3f(1e20),(edge-eye)/safe,abs(ray)>vec3f(.000001));t=max(t+.00001,min(cross.x,min(cross.y,cross.z)));
  }return limit;
 }
`:''}
 for(var i=0;i<128;i++){if(t>=end){break;}let d=objectDistance(eye+ray*t);if(d<.007*object.origin.w){return t;}t+=max(d*.75,.005);}
 return limit;
}
fn objectAlbedo(mat:f32,char:f32)->vec3f{
 var c=vec3f(.24,.105,.045);
 if(mat>1.5){c=vec3f(.17,.08,.065);}if(mat>2.5){c=vec3f(.28,.25,.21);}
 if(mat>3.5){c=vec3f(.055,.16,.23);}if(mat>4.5){c=vec3f(.04,.037,.032);}
 if(mat>5.5){c=vec3f(.38);}if(mat>6.5){c=vec3f(.34,.27,.19);}if(mat>7.5){c=vec3f(.09,.18,.025);}
 return mix(c,vec3f(.022,.016,.012),clamp(char*3.,0.,.92));
}
struct Vert{@builtin(position) pos:vec4f,@location(0) uv:vec2f};
@vertex fn vertex(@builtin(vertex_index) i:u32)->Vert{let xy=vec2f(f32((i<<1u)&2u),f32(i&2u));var o:Vert;o.pos=vec4f(xy*2.-1.,0,1);o.uv=xy;return o;}
@fragment fn fragment(v:Vert)->@location(0) vec4f{
 let screen=v.uv*2.-1.;
 let eye=cam.eye.xyz;let ray=normalize(cam.forward.xyz+screen.x*(16./9.)*cam.eye.w*cam.right.xyz+screen.y*cam.eye.w*cam.up.xyz);
 // Capture quad ray differentials in uniform entry-point control flow.
 // Surface hits below may be conditional or found by divergent ray tracing.
 let rayDx=dpdx(ray);let rayDy=dpdy(ray);
 var surface=vec3f(0);var limit=1e4;
 if(cam.options.x>.5){let hit=roomHit(eye,ray);limit=hit.w;let at=eye+ray*limit;
  let roomDx=woodHitDifferential(ray,rayDx,hit.xyz,limit);let roomDy=woodHitDifferential(ray,rayDy,hit.xyz,limit);
  var uv=at.xy;var uvDx=roomDx.xy;var uvDy=roomDy.xy;
  if(abs(hit.y)>.5){uv=at.xz;uvDx=roomDx.xz;uvDy=roomDy.xz;}else if(abs(hit.x)>.5){uv=at.zy;uvDx=roomDx.zy;uvDy=roomDy.zy;}
  let edge=abs(fract(uv*2.+.5)-.5)*.5;let aa=max(abs(uvDx)+abs(uvDy),vec2f(.001));let line=clamp((.003+aa*.5-edge)/aa,vec2f(0),vec2f(1));
  var albedo=vec3f(.115,.12,.125)*(1.-.5*max(line.x,line.y));var bed=vec4f(0);
  if(cam.right.w>.5&&hit.y>.9){bed=floorFuelAt(at.xz);
   let mass=smoothstep(.005,.12,bed.x);let char=clamp(bed.w*5.,0.,1.);
   // Cold fuel is a dark material lit by the same room/fire irradiance.
   // Heat emission and irreversible char come from the evolving fuel bed.
   var material=mix(vec3f(.07,.033,.009),vec3f(.012,.011,.010),char);
   if(cam.up.w>.5){let wear=floorWearAt(at.xz);let initial=max(wear.x,.000001);material=woodRayMaterial(at.xzy,roomDx.xzy,roomDy.xzy,bed.y,bed.x/initial,bed.w/initial,wear.w,0.).rgb;}
   albedo=mix(albedo,material,max(mass,char));
  }
  surface=albedo*roomIrradiance(at,hit.xyz)/3.14159;
  surface+=colorEmission(vec3f(1,.14,.012))*pow(max(bed.y-.5,0.),3.)*min(1.,bed.x+bed.w)*.12;
 }
 let safe=select(vec3f(.000001),ray,abs(ray)>vec3f(.000001));let a=(LO-eye)/safe;let b=(LO+EXT-eye)/safe;
 let near=min(a,b);let far=max(a,b);let start=max(0.,max(near.x,max(near.y,near.z)));
${tree?` let mesh=textureLoad(meshPosition,vec2i(v.pos.xy),0);
 var solidHit=limit;if(abs(object.tint.w)<.5){solidHit=objectHit(eye,ray,limit);}
 if(mesh.w>.5&&abs(object.tint.w)>.5){
  let t=length(mesh.xyz-eye);if(t<limit){limit=t;let normalHeat=textureLoad(meshNormal,vec2i(v.pos.xy),0);let material=textureLoad(meshColor,vec2i(v.pos.xy),0);
   surface=woodLit(mesh.xyz+normalHeat.xyz*.018,normalHeat.xyz,material.xyz,material.w,vec3f(0,1,0));
   surface+=colorEmission(vec3f(1,.14,.012))*pow(max(normalHeat.w-.72,0.),3.)*.08;
  }
 }
`:' let solidHit=objectHit(eye,ray,limit);'}
 if(solidHit<limit){limit=solidHit;let at=eye+ray*limit;var n=objectNormal(at);let state=surfaceState(at);let material=objectSample(at).w;
  var diffuse=objectAlbedo(material,state.w)*incoming(at+n*.035,n,true)/3.14159;
  if(material>.5&&material<2.5){
   let wear=surfaceWear(at);let local=(at-object.origin.xyz)/object.origin.w;
   let worldDx=woodHitDifferential(ray,rayDx,n,limit);let worldDy=woodHitDifferential(ray,rayDy,n,limit);
   let localDx=worldDx/object.origin.w;let localDy=worldDy/object.origin.w;
   let pixel=woodRayPixel(local,localDx,localDy);
   let wood=woodMaterialFiltered(local,pixel.features,state.y,state.x,state.w,wear.z,0.);
   let height=woodHeightFiltered(local,pixel.features,pixel.footprint,wear.z,0.);
   let heightDx=woodHeightFiltered(local+localDx,pixel.neighborX,pixel.footprint,wear.z,0.)-height;
   let heightDy=woodHeightFiltered(local+localDy,pixel.neighborY,pixel.footprint,wear.z,0.)-height;
   n=woodSurfaceNormal(n,worldDx,worldDy,heightDx,heightDy);
   diffuse=woodLit(at+n*.02,n,wood.rgb,wood.w,vec3f(0,1,0));
  }
  let glow=colorEmission(vec3f(1,.14,.012))*pow(max(state.y-.5,0.),3.)*.22;
  surface=diffuse+glow;
 }
 let guide=sigilGuideHit(eye,ray,limit);
 if(guide.w<limit){limit=guide.w;let at=eye+ray*limit;let n=guide.xyz;
  let gas=field(at+n*.035);let char=clamp(gas.x*.7,0.,1.);
  let albedo=mix(vec3f(.105,.077,.038),vec3f(.023,.019,.014),char);
  surface=albedo*incoming(at+n*.035,n,true)/3.14159;
  // The charcoal substrate responds to the current gas temperature. It is
  // an optional source guide, not another flame or an animated emissive mask.
  surface+=colorEmission(vec3f(1,.14,.012))*pow(max(gas.y-.55,0.),3.)*.065;
 }
 let end=min(limit,min(far.x,min(far.y,far.z)));
 var sum=vec3f(0);var T=1.;
 if(end>start){let step=6./256.;let count=u32(ceil((end-start)/step));
  for(var i=0u;i<512u;i++){if(i>=count||T<.003){break;}let at=eye+ray*(start+(f32(i)+.5)*step);
   let brick=clamp(vec3i(floor((at-LO)*(32./6.))),vec3i(0),vec3i(31));
   if((occupied[u32(brick.x+32*(brick.y+32*brick.z))]&1u)==0u){
    // Skip to the next brick without changing the fine sampling lattice.
    // Occupancy already has a full-brick halo, including trilinear support.
    let edge=LO+(vec3f(brick)+select(vec3f(0),vec3f(1),ray>vec3f(0)))*(6./32.);
    let crossing=select(vec3f(1e20),(edge-at)/safe,abs(ray)>vec3f(.000001));
    let distance=min(crossing.x,min(crossing.y,crossing.z));
    i+=u32(max(0.,floor(distance/step)));continue;
   }
   let c=field(at);let sigma=extinction(c);
   if(sigma<.0001&&flameActivity(c)<.0001){continue;}
   let opacity=1.-exp(-sigma*step);
   let incident=textureSampleLevel(illumination,smp,(at-LO)/EXT,0).xyz;
   // Normalized isotropic scattering; physically separate from extinction.
   // Smoke inspection hides emission along the camera ray only.
   // The same live flame still illuminates the smoke and room.
   let source=select(emission(c),vec3f(0),cam.options.y>.5)+sigma*.18*incident/12.56637;
   sum+=T*source*select(step,opacity/max(sigma,.00001),sigma>.0001);T*=1.-opacity;
  }
 }
 let hdr=sum+T*surface;let x=hdr*1.15;let mapped=clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),vec3f(0),vec3f(1));
 return vec4f(pow(mapped,vec3f(1./2.2)),1);
}`;}

const lightSource=base=>base+`
@group(0) @binding(4) var lightOut:texture_storage_3d<rgba16float,write>;
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3u){
 if(any(id>=vec3u(64))){return;}let at=LO+(vec3f(id)+.5)*6./64.;
 let b=id/2u;let litRegion=(occupied[b.x+32u*(b.y+32u*b.z)]&1u)!=0u;
 var light=vec3f(0);if(litRegion){light=incoming(at,vec3f(0),false);}
 textureStore(lightOut,vec3i(id),vec4f(light,1));
}`;
const gatherSource=base=>base.replace('var<storage,read> lights:','var<storage,read_write> lights:')+`
var<workgroup> energy:array<vec4f,64>;var<workgroup> moment:array<vec4f,64>;var<workgroup> boundsLo:array<vec3f,64>;var<workgroup> boundsHi:array<vec3f,64>;
@compute @workgroup_size(64) fn main(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let tile=vec3u(group.x%2u,(group.x/2u)%2u,group.x/4u)*16u;var e=vec3f(0);var m=vec3f(0);var w=0.;var second=0.;var lo=vec3f(1e4);var hi=vec3f(-1e4);
 let origin=LO;let extent=EXT;
 for(var q=lane;q<4096u;q+=64u){let cell=tile+vec3u(q%16u,(q/16u)%16u,q/256u);let at=origin+(vec3f(cell)+.5)*extent/32.;let value=emission(field(at));let weight=dot(value,vec3f(.2126,.7152,.0722));e+=value;m+=at*weight;w+=weight;second+=dot(at,at)*weight;if(weight>.00001){lo=min(lo,at);hi=max(hi,at);}}
 energy[lane]=vec4f(e,w);moment[lane]=vec4f(m,second);boundsLo[lane]=lo;boundsHi[lane]=hi;workgroupBarrier();
 for(var stride=32u;stride>0u;stride/=2u){if(lane<stride){energy[lane]+=energy[lane+stride];moment[lane]+=moment[lane+stride];boundsLo[lane]=min(boundsLo[lane],boundsLo[lane+stride]);boundsHi[lane]=max(boundsHi[lane],boundsHi[lane+stride]);}workgroupBarrier();}
 if(lane==0u){let center=moment[0].xyz/max(energy[0].w,.00001);
 // The measured source spread regularizes near-field illumination. A growing
 // fire cluster must not retain the same tiny point-light core.
 let variance=max(moment[0].w/max(energy[0].w,.00001)-dot(center,center),0.);
 lights[group.x].position=vec4f(center,variance);lights[group.x].power=vec4f(energy[0].xyz*(extent.x*extent.y*extent.z/32768.)*cam.options.w,0);lights[group.x].lower=vec4f(boundsLo[0],0);lights[group.x].upper=vec4f(boundsHi[0],0);}
}`;

// First pass locates emission in the full domain. The second partitions its
// padded bounds into eight clusters, retaining the existing eight shadow rays.
// Bounds need only conservative emission support, not spectral power.
const coarseSource=base=>gatherSource(base).replace('let value=emission(field(at));','let c=field(at);let value=vec3f(select(0.,max(flameActivity(c),c.x*max(c.y-.55,0.)),c.y>.2));');
const adaptiveSource=base=>gatherSource(base).replace('var<workgroup> energy:', '@group(0) @binding(10) var<storage,read> seeds:array<FireLight>;\nvar<workgroup> energy:').replace('let origin=LO;let extent=EXT;', `
 var lower=vec3f(1e4);var upper=vec3f(-1e4);
 for(var j=0u;j<8u;j++){lower=min(lower,seeds[j].lower.xyz);upper=max(upper,seeds[j].upper.xyz);}
 let valid=all(lower<=upper);
 let origin=select(LO,max(LO,lower-vec3f(6./32.)),valid);
 let end=select(LO+EXT,min(LO+EXT,upper+vec3f(6./32.)),valid);
 let extent=max(end-origin,vec3f(6./32.));`);

const roomSource=base=>base+`
@group(0) @binding(8) var roomOut:texture_storage_2d<rgba16float,write>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=${ROOM_SIZE*5}u||id.y>=${ROOM_SIZE}u){return;}let face=id.x/${ROOM_SIZE}u;let uv=(vec2f(vec2u(id.x%${ROOM_SIZE}u,id.y))+.5)/${ROOM_SIZE}.;let at=roomPatch(face,uv).xyz;let n=patchNormal(face);
 textureStore(roomOut,vec2i(id.xy),vec4f(directIncoming(at,n,true),1));
}
@compute @workgroup_size(8,8) fn bounce(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=${ROOM_SIZE*5}u||id.y>=${ROOM_SIZE}u){return;}let face=id.x/${ROOM_SIZE}u;let uv=(vec2f(vec2u(id.x%${ROOM_SIZE}u,id.y))+.5)/${ROOM_SIZE}.;let at=roomPatch(face,uv).xyz;let n=patchNormal(face);
 let direct=textureLoad(directRoom,vec2i(id.xy),0).xyz;textureStore(roomOut,vec2i(id.xy),vec4f(direct+bounceIncoming(at,n,true),1));
}`;

// One shared dilation replaces repeated 27-neighbour searches in every light
// voxel, and gives camera rays a conservative empty-space mask.
export const dilateWGSL=`
@group(0) @binding(0) var<storage,read> source:array<u32>;
@group(0) @binding(1) var<storage,read_write> destination:array<u32>;
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3u){
 if(any(id>=vec3u(32))){return;}var alive=0u;
 for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
  let b=vec3i(id)+vec3i(x,y,z);if(all(b>=vec3i(0))&&all(b<vec3i(32))){alive|=source[u32(b.x+32*(b.y+32*b.z))];}
 }}}
 destination[id.x+32u*(id.y+32u*id.z)]=alive;
}`;

export const dilateReceiversWGSL=withLightingReceiverSupport(dilateWGSL);

// Build separate GPU pipelines. Ordinary fire never declares mesh targets,
// mesh shadow textures, or the tree's voxel traversal branch.
const families=new Map();
export function rendererShaders(tree=false,sparse=false,fastSeams=false){
 const key=`${tree}:${sparse}:${fastSeams}`;
 if(!families.has(key)){const render=renderSource(tree,sparse,fastSeams);families.set(key,{render,light:lightSource(render),lightWork:render+lightWorkEntryWGSL,lightReceivers:render+lightReceiverEntryWGSL,room:roomSource(render),gather:coarseSource(render),gatherAdaptive:adaptiveSource(render)});}
 return families.get(key);
}
export const {render:renderWGSL,light:lightWGSL,room:roomWGSL,gather:gatherWGSL,gatherAdaptive:gatherAdaptiveWGSL}=rendererShaders(true);
