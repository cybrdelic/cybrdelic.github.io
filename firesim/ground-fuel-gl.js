import {WOOD_THERMO,woodThermoGLSL} from './wood-thermo.js?v=467fdf306aa8ace5';

export function groundUpdateGLSL(shared){return `#version 300 es
${shared}
${woodThermoGLSL}
uniform sampler2D groundOld,groundWearOld,groundStamp;
uniform vec4 groundBounds;
uniform float groundDeposit,groundIgnition,groundCombustion,groundWood,woodTimeScale,delta;
layout(location=0) out vec4 state;
layout(location=1) out vec4 woodWear;
void main(){
 vec4 old=texelFetch(groundOld,ivec2(gl_FragCoord.xy),0);
 vec2 xz=mix(groundBounds.xy,groundBounds.zw,uv);
 vec3 at=vec3((xz.x-simMin.x)/simExtent.x,(.06-simMin.y)/simExtent.y,(xz.y-simMin.z)/simExtent.z);
 vec4 lowGas=field(chemTex,at);at.y=(.14-simMin.y)/simExtent.y;vec4 highGas=field(chemTex,at);float incoming=max(lowGas.b,highGas.b);
 float requested=groundDeposit*texelFetch(groundStamp,ivec2(gl_FragCoord.xy),0).r;
 float mass=min(4.,max(old.r,0.)+requested);
 if(groundWood>.5){
  vec4 oldWear=texelFetch(groundWearOld,ivec2(gl_FragCoord.xy),0);float remaining=max(old.r,0.),charMass=max(old.a,0.),added=max(0.,min(4.-remaining,requested));
  float previousInitial=max(oldWear.r,remaining+charMass),initial=previousInitial+added;
  if(initial<=0.){state=vec4(0);woodWear=vec4(0);return;}
  float moisture=(max(oldWear.g,0.)*previousInitial+added*${WOOD_THERMO.dryMoistureFraction})/initial;
  float surface=previousInitial>0.?gasHeatToWoodHeat(old.g):0.,core=max(oldWear.b,0.),water=max(oldWear.g,0.)*previousInitial;
  float freshCp=added*(woodCp(293.15,0.)+${WOOD_THERMO.dryMoistureFraction}*4180.);
  float Ts=293.15+500.*surface,Tc=293.15+500.*core;
  float surfaceCp=remaining*woodCp(Ts,0.)+charMass*woodCp(Ts,1.)+water*4180.,coreCp=remaining*woodCp(Tc,0.)+charMass*woodCp(Tc,1.)+water*4180.;
  vec4 stock=vec4((remaining+added)/initial,surface*surfaceCp/max(surfaceCp+freshCp,1e-20),0.,charMass/initial);
  vec4 wear=vec4(moisture,core*coreCp/max(coreCp+freshCp,1e-20),max(oldWear.a,0.),1.),nextStock,nextWear;
  float ignition=groundIgnition>.5&&mass>0.&&groundCombustion>.5?${WOOD_THERMO.starterFluxWm2}.:0.;
  woodThermoStep(stock,wear,gasHeatToWoodHeat(incoming),delta,ignition,min(lowGas.g,highGas.g),1.,initial/495.,1.,0.,groundCombustion>.5?woodTimeScale:0.,nextStock,nextWear);
  state=vec4(nextStock.r*initial,(293.15+500.*nextStock.g-300.)/1200.,nextStock.b*initial,nextStock.a*initial);
  woodWear=vec4(initial,nextWear.r,nextWear.g,nextWear.b);return;
 }
 float heat=max(0.,old.g+(max(incoming,0.)-old.g)*(1.-exp(-8.*delta)))*exp(-.22*delta);
 if(mass>0.&&groundIgnition>.5&&groundCombustion>.5)heat+=1.2;
 float burned=min(mass,mass*smoothstep(.32,.65,heat)*1.3*delta)*groundCombustion;
 state=vec4(mass-burned,heat,burned/max(delta,.000001),min(4.,old.a+burned));
 woodWear=vec4(0);
}`;}

export function sourceGuideUpdateGLSL(shared){return `#version 300 es
${shared}
uniform sampler2D guideOld,sourceTex;
uniform float delta;
layout(location=0) out vec4 damage;
void main(){
 float old=texelFetch(guideOld,ivec2(gl_FragCoord.xy),0).r;
 float mask=texture(sourceTex,uv).r;
 vec3 at=vec3(uv,(.035-simMin.z)/simExtent.z);
 float heat=field(chemTex,at).b;at.z=(-.045-simMin.z)/simExtent.z;heat=max(heat,field(chemTex,at).b);
 float charred=min(1.,old+delta*max(heat-.28,0.)*.12*step(.28,mask));
 damage=vec4(charred,0,0,1);
}`;}

export const groundSamplingGLSL=`
uniform sampler2D groundFuelTex;
uniform vec4 groundBounds;
uniform float groundEnabled;
vec4 groundSample(vec2 p){
 ivec2 size=textureSize(groundFuelTex,0);vec2 q=clamp(p*vec2(size)-.5,vec2(0),vec2(size-1));ivec2 lo=ivec2(floor(q)),hi=min(lo+1,size-1);vec2 f=fract(q);
 return mix(mix(texelFetch(groundFuelTex,lo,0),texelFetch(groundFuelTex,ivec2(hi.x,lo.y),0),f.x),mix(texelFetch(groundFuelTex,ivec2(lo.x,hi.y),0),texelFetch(groundFuelTex,hi,0),f.x),f.y);
}
`;
export const groundInjectionGLSL=`
${groundSamplingGLSL}
void groundFuelGas(vec3 world,float dt,inout float fuel,inout float temp){
 if(groundEnabled<.5||world.y<0.||world.y>.24||any(lessThan(world.xz,groundBounds.xy))||any(greaterThan(world.xz,groundBounds.zw)))return;
 vec4 surface=groundSample((world.xz-groundBounds.xy)/(groundBounds.zw-groundBounds.xy));
 float profile=exp(-world.y/.055)/(.055*(1.-exp(-.24/.055)));
 float injected=surface.b*dt*profile;
 // The reservoir's sensible heat comes exclusively from adjacent simulated
 // gas. Deposits never add ignition, reaction, soot, or artificial hot pixels.
 float gasMass=max(fuel,0.)+1.;temp=(temp*gasMass+max(surface.g,0.)*injected)/(gasMass+injected);
 fuel+=injected;
}
`;

export const groundSurfaceGLSL=`
${groundSamplingGLSL}
uniform sampler2D sourceTex,sourceGuideTex;
uniform float sourceGuide,groundWood;
vec3 groundFloorSurface(vec3 at,vec3 base){
 if(groundEnabled<.5||any(lessThan(at.xz,groundBounds.xy))||any(greaterThan(at.xz,groundBounds.zw)))return base;
 vec4 state=groundSample((at.xz-groundBounds.xy)/(groundBounds.zw-groundBounds.xy));
 float coverage=smoothstep(.004,.08,state.r+state.a),charred=state.a/max(state.r+state.a,.0001);
 if(groundWood>.5){
  // Deposited fuel retains its floor-reservoir physics. Its solid residue uses
  // the same wood appearance; this ratio replaces the room's base albedo
  // while preserving the incident lighting already evaluated for the floor.
  vec3 materialPoint=at.xzy;
  vec4 wood=woodMaterial(materialPoint,vec3(0,0,1),state.g,1.-charred,charred*.25,0.,0.);
  return base*mix(vec3(1),wood.rgb/vec3(.115,.12,.125),coverage);
 }
 return base*mix(vec3(1),mix(vec3(.40,.25,.13),vec3(.13,.12,.10),charred),coverage);
}
float guideMask(vec3 at){return texture(sourceTex,(at.xy-simMin.xy)/simExtent.xy).r;}
bool sourceGuideSurface(vec3 eye,vec3 ray,inout float nearest,out vec3 color){
 color=vec3(0);if(sourceGuide<.5||abs(ray.z)<.00001)return false;
 float front=(.035-eye.z)/ray.z,back=(-.045-eye.z)/ray.z;
 if(front>back){float swap=front;front=back;back=swap;}
 if(back<=0.||front>=nearest)return false;front=max(front,.00001);back=min(back,nearest);
 vec3 at=eye+ray*front;vec2 p=(at.xy-simMin.xy)/simExtent.xy;
 if(any(lessThan(p,vec2(0)))||any(greaterThan(p,vec2(1))))return false;
 bool side=guideMask(at)<.28;
 if(side){
  if(guideMask(eye+ray*back)<.28)return false;
  // A finite slab and binary search expose the cut sides at oblique angles.
  // This is an extruded static substrate, separate from the simulated flame.
  float lo=front,hi=back;for(int j=0;j<5;j++){float t=(lo+hi)*.5;if(guideMask(eye+ray*t)>.28)hi=t;else lo=t;}front=hi;at=eye+ray*front;p=(at.xy-simMin.xy)/simExtent.xy;
 }
 vec2 h=simExtent.xy/vec2(896.,504.);
 vec2 gradient=vec2(guideMask(at+vec3(h.x,0,0))-guideMask(at-vec3(h.x,0,0)),guideMask(at+vec3(0,h.y,0))-guideMask(at-vec3(0,h.y,0)));
 vec3 n=side?normalize(vec3(-gradient,.00001)):normalize(vec3(-gradient*.18,ray.z<0.?1.:-1.));
 vec4 stock=woodEnabled>.5?woodStockAt(at):vec4(1,0,0,texture(sourceGuideTex,p).r*.25);
 vec4 wear=woodEnabled>.5?woodWearAt(at):vec4(0,0,0,1);
 vec4 material=woodMaterial(at,n,stock.g,stock.r,stock.a,wear.z,0.);vec3 albedo=material.rgb;
 n=woodNormal(at,n,stock.r,stock.a,wear.z,0.);
 for(int i=0;i<32;i++){vec3 light,power;roomLight(i,light,power);vec3 d=light-at;float r2=max(dot(d,d),.001);vec3 l=d*inversesqrt(r2);float nl=max(dot(n,l),0.);color+=(albedo+vec3(woodSpecular(n,l,normalize(eye-at),vec3(0,1,0),material.a)))*power*nl/(r2+.12);}
 color+=albedo*ambientLight*(.25+.75*max(n.y,0.))/3.14159;
 for(int i=0;i<2;i++){vec3 direction,power;spotSample(i,at,direction,power);float nl=max(dot(n,direction),0.);color+=albedo*power*nl/3.14159+power*woodSpecular(n,direction,normalize(eye-at),vec3(0,1,0),material.a)*nl;}
 color+=inspectionLight*albedo*.20*max(dot(n,normalize(vec3(-.5,1.,1.5))),0.);
 nearest=front;return true;
}
`;

export function createGroundFuelGL(gl,{width=128,height=128,minX=-7,maxX=7,minZ=-.9,maxZ=.9,shared,program,uniform,bind,linear=true}){
 const bounds=[minX,minZ,maxX,maxZ],targets=[],programs=[];
 function texture(w,h,internal,format,data=null,float32=false){
  const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,linear&&!float32?gl.LINEAR:gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,linear&&!float32?gl.LINEAR:gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D,0,internal,w,h,0,format,float32?gl.FLOAT:gl.HALF_FLOAT,data);return t;
 }
 function target(w,h,float32=false){
  const tex=texture(w,h,float32?gl.RGBA32F:gl.RGBA16F,gl.RGBA,null,float32),fbo=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
  if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Ground inventory framebuffer incomplete');
  const t={texture:tex,fbo,width:w,height:h};targets.push(t);return t;
 }
 const inventory=[target(width,height,true),target(width,height,true)],wear=[target(width,height,true),target(width,height,true)],guide=[target(256,144),target(256,144)];
 for(let i=0;i<2;i++){gl.bindFramebuffer(gl.FRAMEBUFFER,inventory[i].fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT1,gl.TEXTURE_2D,wear[i].texture,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Ground wood framebuffer incomplete');}
 const stamp=texture(width,height,gl.R16F,gl.RED,new Uint16Array(width*height));
 const groundProgram=program(groundUpdateGLSL(shared)),guideProgram=program(sourceGuideUpdateGLSL(shared));programs.push(groundProgram,guideProgram);
 let current=0,guideCurrent=0,active=false,ignition=false;
 function begin(p,t){gl.useProgram(p);gl.bindFramebuffer(gl.FRAMEBUFFER,t.fbo);gl.viewport(0,0,t.width,t.height);}
 function clear(){
  for(const t of targets){gl.bindFramebuffer(gl.FRAMEBUFFER,t.fbo);gl.clearBufferfv(gl.COLOR,0,new Float32Array([0,0,0,0]));}
  current=0;guideCurrent=0;active=false;ignition=false;
 }
 clear();
 return {
  get active(){return active;},get texture(){return inventory[current].texture;},get guideTexture(){return guide[guideCurrent].texture;},bounds,
  step(chem,dt,packet,combustionEnabled=true,{wood=false,timeScale=WOOD_THERMO.demoTimeScale}={}){
   if(packet){if(packet.width!==width||packet.height!==height||packet.data.length!==width*height)throw Error('Fuel upload size mismatch');
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,stamp);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,width,height,gl.RED,gl.HALF_FLOAT,packet.data);active=true;
   }
   if(!active){ignition=false;return false;}
   begin(groundProgram,inventory[1-current]);bind(inventory[current].texture,0,uniform(groundProgram,'groundOld'));bind(stamp,1,uniform(groundProgram,'groundStamp'));bind(chem,2,uniform(groundProgram,'chemTex'));bind(wear[current].texture,3,uniform(groundProgram,'groundWearOld'));
   gl.uniform4fv(uniform(groundProgram,'groundBounds'),bounds);gl.uniform1f(uniform(groundProgram,'groundDeposit'),packet?1:0);gl.uniform1f(uniform(groundProgram,'groundIgnition'),ignition&&dt>0&&combustionEnabled?1:0);gl.uniform1f(uniform(groundProgram,'groundCombustion'),combustionEnabled?1:0);gl.uniform1f(uniform(groundProgram,'groundWood'),wood?1:0);gl.uniform1f(uniform(groundProgram,'woodTimeScale'),timeScale);gl.uniform1f(uniform(groundProgram,'delta'),dt);gl.drawArrays(gl.TRIANGLES,0,3);current=1-current;if(dt>0)ignition=false;return true;
  },
  updateGuide(chem,source,dt){
   begin(guideProgram,guide[1-guideCurrent]);bind(guide[guideCurrent].texture,0,uniform(guideProgram,'guideOld'));bind(source,1,uniform(guideProgram,'sourceTex'));bind(chem,2,uniform(guideProgram,'chemTex'));
   gl.uniform1f(uniform(guideProgram,'delta'),dt);gl.drawArrays(gl.TRIANGLES,0,3);guideCurrent=1-guideCurrent;
  },
  bind(p,{render=false,guideVisible=false,wood=false}={}){
   bind(inventory[current].texture,13,uniform(p,'groundFuelTex'));gl.uniform4fv(uniform(p,'groundBounds'),bounds);gl.uniform1f(uniform(p,'groundEnabled'),active?1:0);
   if(render){bind(guide[guideCurrent].texture,4,uniform(p,'sourceGuideTex'));gl.uniform1f(uniform(p,'sourceGuide'),guideVisible?1:0);gl.uniform1f(uniform(p,'groundWood'),wood?1:0);}
  },
  ignite(){ignition=true;},
  clearFuel(){for(const t of [...inventory,...wear]){gl.bindFramebuffer(gl.FRAMEBUFFER,t.fbo);gl.clearBufferfv(gl.COLOR,0,new Float32Array([0,0,0,0]));}current=0;active=false;ignition=false;},
  clear,
  destroy(){for(const t of targets){gl.deleteTexture(t.texture);gl.deleteFramebuffer(t.fbo);}gl.deleteTexture(stamp);for(const p of programs)gl.deleteProgram(p);}
 };
}
