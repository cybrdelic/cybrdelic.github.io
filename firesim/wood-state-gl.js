import {WOOD_THERMO,woodThermoGLSL} from './wood-thermo.js?v=54c82352661e679d';

// Original uses a projected material inventory. A column shares its thermal
// state through depth; the gas and rendering remain three dimensional.
export function originalWoodSource(id,preset){
  if(['logs','house','cybr-tree','wood-sigil'].includes(preset?.object))return {kind:3,bark:preset.object==='cybr-tree'?1:0};
  if(['sigil','sigil-cybr','violet-sigil'].includes(id))return {kind:1,bark:0};
  if(['campfire','bonfire','hearth'].includes(id))return {kind:2,bark:0};
  return {kind:0,bark:0};
}

export const woodSamplingGLSL=`
uniform sampler2D woodStockTex,woodWearTex,woodCapacityTex;
uniform vec4 woodBounds;
uniform float woodEnabled,woodSigma,woodBark;
vec4 woodBilinear(sampler2D tex,vec2 p){
 ivec2 size=textureSize(tex,0);vec2 q=clamp(p*vec2(size)-.5,vec2(0),vec2(size-1));ivec2 lo=ivec2(floor(q)),hi=min(lo+1,size-1);vec2 f=fract(q);
 return mix(mix(texelFetch(tex,lo,0),texelFetch(tex,ivec2(hi.x,lo.y),0),f.x),mix(texelFetch(tex,ivec2(lo.x,hi.y),0),texelFetch(tex,hi,0),f.x),f.y);
}
vec2 woodUV(vec3 at){return (at.xy-woodBounds.xy)/(woodBounds.zw-woodBounds.xy);}
void woodStateAt(vec3 at,out vec4 stock,out vec4 cap){
 ivec2 size=textureSize(woodCapacityTex,0);vec2 q=clamp(woodUV(at)*vec2(size)-.5,vec2(0),vec2(size-1));ivec2 lo=ivec2(floor(q)),hi=min(lo+1,size-1);vec2 f=fract(q);
 vec4 weights=vec4((1.-f.x)*(1.-f.y),f.x*(1.-f.y),(1.-f.x)*f.y,f.x*f.y);
 ivec2 points[4]=ivec2[4](lo,ivec2(hi.x,lo.y),ivec2(lo.x,hi.y),hi);stock=vec4(0);cap=vec4(0);
 for(int j=0;j<4;j++){vec4 c=texelFetch(woodCapacityTex,points[j],0);cap.r+=c.r*weights[j];cap.gba+=c.gba*c.r*weights[j];stock+=texelFetch(woodStockTex,points[j],0)*c.r*weights[j];}
 cap.gba=cap.r>0.?cap.gba/cap.r:vec3(0);
 stock=cap.r>0.?stock/cap.r:vec4(1,0,0,0);
}
vec4 woodStockAt(vec3 at){vec4 stock,cap;woodStateAt(at,stock,cap);return stock;}
vec4 woodWearAt(vec3 at){
 ivec2 size=textureSize(woodCapacityTex,0);vec2 q=clamp(woodUV(at)*vec2(size)-.5,vec2(0),vec2(size-1));ivec2 lo=ivec2(floor(q)),hi=min(lo+1,size-1);vec2 f=fract(q);
 vec4 weights=vec4((1.-f.x)*(1.-f.y),f.x*(1.-f.y),(1.-f.x)*f.y,f.x*f.y);ivec2 points[4]=ivec2[4](lo,ivec2(hi.x,lo.y),ivec2(lo.x,hi.y),hi);vec4 wear=vec4(0);float mass=0.;
 for(int j=0;j<4;j++){float weight=texelFetch(woodCapacityTex,points[j],0).r*weights[j];mass+=weight;wear+=texelFetch(woodWearTex,points[j],0)*weight;}
 return mass>0.?wear/mass:vec4(0,0,0,1);
}
vec4 woodCapacityAt(vec3 at){return woodBilinear(woodCapacityTex,woodUV(at));}
float woodGasRest(vec3 at,int piece,float dt,inout float fuel,inout float oxygen,inout float temp){
 if(any(lessThan(woodUV(at),vec2(0)))||any(greaterThan(woodUV(at),vec2(1))))return 0.;
 vec4 cap,stock;woodStateAt(at,stock,cap);if(cap.r<=0.)return 0.;
 if(woodMechanicsEnabled>.5){vec3 local=(vec3(at.xy,cap.g)-woodRestOrigin)/woodRestScale;if(woodPiece(woodColumnOwner(local))!=piece)return 0.;}
 float kernel=exp(-.5*pow((at.z-cap.g)/woodSigma,2.))*cap.b;
 // cap.r is initial dry mass per projected area; the gas concentration unit
 // is 1 kg/m^3. Kernel quadrature integrates to one over the gas depth grid.
 float added=max(stock.b,0.)*cap.r*dt*kernel/${WOOD_THERMO.gasFuelDensityKgM3}.;
 float incoming=max(0.,(${WOOD_THERMO.ambientK}+${WOOD_THERMO.heatScaleK}.*stock.g-${WOOD_THERMO.gasAmbientK}.)/${WOOD_THERMO.gasHeatScaleK}.);
 float gasMass=max(fuel,0.)+1.;temp=(temp*gasMass+incoming*added)/(gasMass+added);
 fuel+=added;oxygen/=1.+added;return added;
}
float woodFuelGas(vec3 at,float dt,inout float fuel,inout float oxygen,inout float temp){
 if(woodEnabled<.5)return 0.;float total=woodGasRest(at,-1,dt,fuel,oxygen,temp);
 if(woodMechanicsEnabled>.5){int count=int(woodRootData(0,0).r);
  for(int j=0;j<count;j++){vec4 root=woodRootData(j+1,0);float radius=woodRootData(j+1,1).r+woodSigma*3.;if(distance(at,root.yzw)>radius)continue;
   int id=int(root.x)-1;vec3 rest=woodRestOrigin+woodInversePose(id,(at-woodRestOrigin)/woodRestScale)*woodRestScale;
   total+=woodGasRest(rest,id,dt,fuel,oxygen,temp);
  }
 }return total;
}
`;

export function woodCapacityGLSL(shared){return `#version 300 es
${shared}
uniform sampler2D sourceTex;
uniform highp sampler3D objectTex;
uniform int woodKind;
uniform float woodScale,woodMoisture;
uniform vec2 woodCentre;
layout(location=0) out vec4 capacity;
layout(location=1) out vec4 stock;
layout(location=2) out vec4 wear;
float woodCapsule(vec3 p,vec3 a,vec3 b,float radius){vec3 q=p-a,d=b-a;return length(q-d*clamp(dot(q,d)/dot(d,d),0.,1.))-radius;}
float woodDensity(vec3 at,out float material){
 material=1.;
 vec3 q=vec3((at.xy-woodCentre)/woodScale,at.z/woodScale);
 if(woodKind==2){
  float d=min(woodCapsule(q,vec3(-.95,-.17,-.34),vec3(.95,-.17,.34),.18),min(woodCapsule(q,vec3(-.90,-.17,.37),vec3(.90,-.17,-.37),.18),woodCapsule(q,vec3(-.65,.05,-.42),vec3(.65,.05,.42),.16)));
  return step(d,0.);
 }
 if(any(greaterThan(abs(q),vec3(1.5))))return 0.;ivec3 cell=clamp(ivec3(floor((q+1.5)*64./3.)),ivec3(0),ivec3(63));vec4 mat=texelFetch(objectTex,cell,0);material=mat.w;
 // Corrected thermal assets have zero capacity outside real material cells.
 // Authored capacity1.5 denotes495kg/m3; the collision distance is unchanged.
 return max(mat.y,0.)/1.5;
}
void main(){
 vec2 xy=mix(woodBounds.xy,woodBounds.zw,uv);float mass=0.,moment=0.,materialSum=0.;
 float dz=woodKind==2?simExtent.z/64.:woodScale*3./64.,zMin=woodKind==2?simMin.z:-woodScale*1.5;
 for(int j=0;j<64;j++){float z=zMin+(float(j)+.5)*dz;float material;float m=woodDensity(vec3(xy,z),material)*${WOOD_THERMO.dryDensityKgM3}.*dz;mass+=m;moment+=m*z;materialSum+=m*material;}
 float centre=mass>0.?moment/mass:0.,normalizer=0.;
 float gasDZ=simExtent.z/(DEPTHf-1.);
 for(int j=0;j<int(DEPTHf);j++){float z=simMin.z+float(j)*gasDZ;float w=j==0||j==int(DEPTHf)-1?.5:1.;normalizer+=w*exp(-.5*pow((z-centre)/woodSigma,2.))*gasDZ;}
 capacity=vec4(mass,centre,normalizer>0.?1./normalizer:0.,mass>0.?materialSum/mass:1.);
 stock=vec4(mass>0.?1.:0.,0,0,0);wear=vec4(mass>0.?woodMoisture:0.,0,0,mass>0.?1.:0.);
}`;}

export function woodUpdateGLSL(shared){return `#version 300 es
${shared}
${woodThermoGLSL}
uniform sampler2D sourceTex;
uniform float delta,woodAge,woodClock,woodStarter,woodTimeScale;
uniform int woodKind,woodVariation;
uniform vec2 woodCentre;
uniform float woodScale;
layout(location=0) out vec4 nextStock;
layout(location=1) out vec4 nextWear;
void main(){
 ivec2 id=ivec2(gl_FragCoord.xy);vec4 cap=texelFetch(woodCapacityTex,id,0),old=texelFetch(woodStockTex,id,0),wear=texelFetch(woodWearTex,id,0);
 if(cap.r<=0.){nextStock=old;nextWear=wear;return;}
 vec2 xy=mix(woodBounds.xy,woodBounds.zw,uv);float heat=0.,oxygen=1.;
 int owner=woodMechanicsEnabled>.5?woodColumnOwner((vec3(xy,cap.g)-woodRestOrigin)/woodRestScale):0;
 for(int j=0;j<4;j++){vec3 at=vec3(xy,cap.g+(float(j)-1.5)*woodSigma);if(woodMechanicsEnabled>.5)at=woodRestOrigin+woodTransformRest(owner,(at-woodRestOrigin)/woodRestScale)*woodRestScale;vec4 gas=field(chemTex,(at-simMin)/simExtent);heat=max(heat,gasHeatToWoodHeat(gas.b));oxygen=min(oxygen,gas.g);}
 float starter=0.;
 if(woodKind==1){float age=woodClock-texture(sourceTex,(xy-simMin.xy)/simExtent.xy).g*10.;starter=woodStarter*step(0.,age)*(1.-step(.15,age));}
 else if(woodAge>=0.&&woodAge<(woodBark>.5?2.5:1.2)){
  vec2 p=(xy-woodCentre)/woodScale;vec2 ignition=woodBark>.5?vec2(0,woodVariation==3?.95:-1.10):woodKind==3?vec2(-.45,-.85):vec2(0,-.17);
  starter=woodStarter*(woodVariation==1?1.:exp(-dot(p-ignition,p-ignition)*(woodBark>.5?22.:6.)));
 }
 // Effective column thickness preserves its areal heat capacity. Surface
 // penetration and the core exchange use the same common material equations.
 woodThermoStep(old,wear,heat,delta,starter,oxygen,1.,max(cap.r/${WOOD_THERMO.dryDensityKgM3}.,${WOOD_THERMO.surfaceDepthM}),cap.a,0.,woodTimeScale,nextStock,nextWear);
}`;}

export function createWoodStateGL(gl,{shared,program,uniform,bind,width=256,height=256}){
 const resources=[],programs=[];let current=0,config={kind:0},resetPending=true;
 function tex(){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.NEAREST);for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,width,height,0,gl.RGBA,gl.FLOAT,null);resources.push(t);return t;}
 const states=[{stock:tex(),wear:tex()},{stock:tex(),wear:tex()}],capacity=tex(),fbos=states.map(s=>{const f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);for(const [i,t]of[s.stock,s.wear].entries())gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0+i,gl.TEXTURE_2D,t,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Wood inventory framebuffer incomplete');return f;});
 const capacityFBO=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,capacityFBO);for(const[i,t]of[capacity,states[0].stock,states[0].wear].entries())gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0+i,gl.TEXTURE_2D,t,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1,gl.COLOR_ATTACHMENT0+2]);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Wood capacity framebuffer incomplete');
 const capacityProgram=program(woodCapacityGLSL(shared)),updateProgram=program(woodUpdateGLSL(shared));programs.push(capacityProgram,updateProgram);
 function common(p){gl.uniform4fv(uniform(p,'woodBounds'),config.bounds);gl.uniform1f(uniform(p,'woodSigma'),config.sigma);gl.uniform1f(uniform(p,'woodBark'),config.bark);gl.uniform2f(uniform(p,'woodCentre'),...config.centre);gl.uniform1f(uniform(p,'woodScale'),config.scale);gl.uniform1i(uniform(p,'woodKind'),config.kind);}
 function bindState(p,render=false){bind(states[current].stock,render?5:8,uniform(p,'woodStockTex'));bind(states[current].wear,render?6:9,uniform(p,'woodWearTex'));bind(capacity,render?7:10,uniform(p,'woodCapacityTex'));gl.uniform1f(uniform(p,'woodEnabled'),config.kind&&!resetPending?1:0);if(config.kind)common(p);}
 return {
  get enabled(){return config.kind>0;},get stockTexture(){return states[current].stock;},get wearTexture(){return states[current].wear;},get capacityTexture(){return capacity;},
  configure(next){if(next.key!==config.key)resetPending=true;config=next;},reset(){resetPending=true;},
  step(chem,source,object,dt,{clock=0,age=0,starter=true,timeScale=12,mechanics=null}={}){
   if(!config.kind)return false;
   if(resetPending){gl.useProgram(capacityProgram);gl.bindFramebuffer(gl.FRAMEBUFFER,capacityFBO);gl.viewport(0,0,width,height);common(capacityProgram);bind(source,2,uniform(capacityProgram,'sourceTex'));gl.activeTexture(gl.TEXTURE14);gl.bindTexture(gl.TEXTURE_3D,object);gl.uniform1i(uniform(capacityProgram,'objectTex'),14);gl.uniform1f(uniform(capacityProgram,'woodMoisture'),config.moisture);gl.drawArrays(gl.TRIANGLES,0,3);current=0;resetPending=false;}
   gl.useProgram(updateProgram);gl.bindFramebuffer(gl.FRAMEBUFFER,fbos[1-current]);gl.viewport(0,0,width,height);common(updateProgram);bindState(updateProgram);mechanics?.bind(updateProgram);bind(chem,1,uniform(updateProgram,'chemTex'));bind(source,2,uniform(updateProgram,'sourceTex'));gl.uniform1f(uniform(updateProgram,'delta'),dt);gl.uniform1f(uniform(updateProgram,'woodAge'),age);gl.uniform1f(uniform(updateProgram,'woodClock'),clock);gl.uniform1f(uniform(updateProgram,'woodStarter'),starter?WOOD_THERMO.starterFluxWm2:0);gl.uniform1i(uniform(updateProgram,'woodVariation'),config.variation);gl.uniform1f(uniform(updateProgram,'woodTimeScale'),timeScale);gl.drawArrays(gl.TRIANGLES,0,3);current=1-current;return true;
  },bind:bindState,
  destroy(){for(const t of resources)gl.deleteTexture(t);for(const f of [...fbos,capacityFBO])gl.deleteFramebuffer(f);for(const p of programs)gl.deleteProgram(p);},
 };
}
