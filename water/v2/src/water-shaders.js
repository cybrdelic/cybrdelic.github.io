import { environmentGLSL } from "./environment.js";
import { waveDeclarations } from "./gpu-ocean.js";
export const waterVertex = `precision highp float;in vec3 position;uniform mat4 projectionMatrix,modelViewMatrix;uniform mat4 uViewProjection;uniform float uPatchSize;uniform sampler2D uInteraction;out vec3 vWorld;out vec2 vQ;
${environmentGLSL}
${waveDeclarations}
void main(){vec2 q=position.xz+uEye.xz;vec3 d=displace(q);vec2 uv=q/uPatchSize+.5;if(all(greaterThan(uv,vec2(.003)))&&all(lessThan(uv,vec2(.997))))d.y+=texture(uInteraction,uv).x;
 vec3 p=vec3(q.x,0.,q.y)+d;float r=length(position.xz);p.y-=r*r/(2.*6371000.);vWorld=p;vQ=q;gl_Position=uViewProjection*vec4(p,1.);}`;
export const waterFragment = `precision highp float;precision highp int;in vec3 vWorld;in vec2 vQ;layout(location=0) out vec4 fragColor;layout(location=1) out vec4 motion;
${environmentGLSL}
${waveDeclarations}
uniform sampler2D uSceneColor,uSceneDepth,uReflection,uInteraction,uWhitewater,uFloorRadiance;uniform mat4 uFloorMatrix;
uniform mat4 uViewProjection,uInverseViewProjection,uViewMatrix,uReflectionMatrix,uHullInverse;
uniform vec2 uResolution;uniform float uPatchSize,uFoamSize,uRoughness,uWind,uUnderwater,uTerrain,uObjects,uCausticEnable,uBoat,uFoamEnable,uSprayEnable,uReflections;
uniform sampler2D uRainRing;uniform float uRainRingSize,uRainEnable;uniform int uDebug;
vec3 worldFromDepth(vec2 uv,float depth){vec4 p=uInverseViewProjection*vec4(uv*2.-1.,depth*2.-1.,1.);return p.xyz/p.w;}
bool inScreen(vec2 uv){return all(greaterThan(uv,vec2(.001)))&&all(lessThan(uv,vec2(.999)));}
vec3 offscreenFloor(vec3 origin,vec3 direction,out float len){
 len=max(0.,origin.y-bedHeight(origin.xz))/max(.08,-direction.y);
 for(int i=0;i<5;i++){vec3 q=origin+direction*len;len=max(0.,origin.y-bedHeight(q.xz))/max(.08,-direction.y);}
 len=min(240.,len);vec3 hit=origin+direction*len;vec4 p=uFloorMatrix*vec4(hit,1.);vec2 uv=p.xy/p.w*.5+.5;
 return texture(uFloorRadiance,clamp(uv,.001,.999)).rgb;
}
// Refracted/reflected ray tracing against actual scene geometry in its depth buffer.
// Off-screen geometry is absent: the fallback is explicitly the environment/medium.
bool traceScene(vec3 origin,vec3 direction,out vec3 color,out float distance){
 float previous=0.;for(int j=0;j<15;j++){
  float t=.16*(pow(1.54,float(j+1))-1.);vec3 p=origin+direction*t;vec4 clip=uViewProjection*vec4(p,1.);if(clip.w<=0.)break;
  vec2 uv=clip.xy/clip.w*.5+.5;if(!inScreen(uv))break;
  float depth=texture(uSceneDepth,uv).r;vec3 actual=worldFromDepth(uv,depth);float actualZ=-(uViewMatrix*vec4(actual,1.)).z;
  if(depth<.999999&&clip.w>=actualZ&&!(direction.y<0.&&actual.y>origin.y+.08)){
   float lo=previous,hi=t;for(int k=0;k<4;k++){float mid=(lo+hi)*.5;vec4 c=uViewProjection*vec4(origin+direction*mid,1.);vec2 pUV=c.xy/c.w*.5+.5;float dd=texture(uSceneDepth,pUV).r;vec3 w=worldFromDepth(pUV,dd);float zz=-(uViewMatrix*vec4(w,1.)).z;if(c.w>zz)hi=mid;else lo=mid;}
   distance=(lo+hi)*.5;vec4 c=uViewProjection*vec4(origin+direction*distance,1.);vec2 hitUV=c.xy/c.w*.5+.5;vec3 hitWorld=worldFromDepth(hitUV,texture(uSceneDepth,hitUV).r);if((direction.y<0.&&hitWorld.y>origin.y+.08)||length(hitWorld-(origin+direction*distance))>.22+distance*.03){previous=t;continue;}color=texture(uSceneColor,clamp(hitUV,.001,.999)).rgb;return true;
  }previous=t;
 }return false;
}
float smith(float n,float a2){return 2.*n/(n+sqrt(a2+(1.-a2)*n*n));}
void main(){
 if(uTerrain>.5&&vWorld.y<bedHeight(vWorld.xz)-.025)discard;
 if(uBoat>.5){vec3 h=(uHullInverse*vec4(vWorld,1.)).xyz;float width=.99*sqrt(max(0.,1.-pow((h.x+.20)/3.65,2.)));if(abs(h.x)<3.35&&abs(h.z)<width&&h.y>-.31&&h.y<.95)discard;}
 float footprint=max(length(dFdx(vQ)),length(dFdy(vQ)));vec3 lod=max(vec3(0.),log2(max(vec3(.001),footprint*uN/vec3(768.,96.,12.))));
 vec3 d,tx,tz,velocity;waveAt(vQ,lod,d,tx,tz,velocity);vec2 puv=vWorld.xz/uPatchSize+.5;vec4 response=vec4(0.);float patchWindow=0.;
 if(all(greaterThan(puv,vec2(.005)))&&all(lessThan(puv,vec2(.995)))){
  response=texture(uInteraction,puv);float eps=1./256.;float dx=uPatchSize*eps;
  tx.y+=(texture(uInteraction,puv+vec2(eps,0.)).x-texture(uInteraction,puv-vec2(eps,0.)).x)/(2.*dx);
  tz.y+=(texture(uInteraction,puv+vec2(0.,eps)).x-texture(uInteraction,puv-vec2(0.,eps)).x)/(2.*dx);patchWindow=1.;
 }
 float rainReactive=0.;
 if(uRainEnable>.5){vec2 ruv=vWorld.xz/uRainRingSize+.5;if(inScreen(ruv)){vec4 rings=texture(uRainRing,ruv);tx.y+=rings.x;tz.y+=rings.y;rainReactive=length(rings.xy);}}
 float dist=length(vWorld-uEye);float microFade=1.-smoothstep(4.,45.,dist);
 // Physical gravity-capillary dispersion for unresolved sub-millimetric detail.
 for(int i=0;i<5;i++){float fi=float(i),wl=.055+fi*.031,k=6.28318530718/wl;vec2 dir=vec2(cos(fi*2.399),sin(fi*2.399));float omega=sqrt(9.81*k+.000074*k*k*k);float a=.009*(.3+min(uWind/9.,1.))*cos(dot(dir,vQ)*k-uTime*omega)*microFade;tx.y+=dir.x*a;tz.y+=dir.y*a;}
 vec3 N=normalize(cross(tz,tx)),V=normalize(uEye-vWorld);if(dot(N,V)<0.)N=-N;
 bool under=uUnderwater>.5;float etaI=under?1.333:1.,etaT=under?1.:1.333;
 float NoV=max(.001,dot(N,V)),F=dielectric(NoV,etaI,etaT);vec3 R=reflect(-V,N),T=refract(-V,N,etaI/etaT);
 float variance=.5*(dot(dFdx(N),dFdx(N))+dot(dFdy(N),dFdy(N)));
 float alpha=clamp(uRoughness*uRoughness+.003+variance*.65+.018*smoothstep(.15,3.,footprint),.003,.28),rough=sqrt(alpha);
 vec3 reflected=environmentRough(R,rough);float reflectedLength=0.;
 if(!under){
  // Below-horizon reflection directions are not falsely bent up into the sky.
  // Unresolved multiple water-surface bounces: continuous horizon closure,
  // not a discontinuous black mask or a reflected ray bent into the sky.
  if(R.y<0.){vec3 horizon=textureLod(uSky,vec2(environmentUV(R).x,.495),rough*6.+1.).rgb;reflected=mix(horizon,uWaterLight*.22,smoothstep(0.,.45,-R.y));}
  if(uObjects>.5&&uReflections>.5){vec4 rp=uReflectionMatrix*vec4(vWorld.x,0.,vWorld.z,1.);vec2 ruv=rp.xy/rp.w*.5+.5;ruv+=N.xz*.011*(1.-F);if(inScreen(ruv))reflected=mix(reflected,texture(uReflection,ruv).rgb,.87);}
 }else if(uTerrain>.5||uObjects>.5){vec3 hit;float len;if(traceScene(vWorld+N*.035,R,hit,len)){reflected=hit*transmittance(len)+uWaterLight*.12*(1.-transmittance(len));}}
 vec3 transmitted;float opticalDistance=110.;bool hit=false;vec3 hitColor=vec3(0.);
 if(under){transmitted=environmentRough(length(T)>.01?T:vec3(0.,1.,0.),rough*.3);if(length(T)>.01&&uObjects>.5){float len;if(traceScene(vWorld-N*.025,T,hitColor,len))transmitted=hitColor;}opticalDistance=0.;}
 else{
  if((uTerrain>.5||uObjects>.5)&&length(T)>.01)hit=traceScene(vWorld-N*.025,T,hitColor,opticalDistance);
  if(!hit){float depth=max(0.,vWorld.y-bedHeight(vWorld.xz));opticalDistance=min(160.,depth/max(.12,-T.y));hitColor=uTerrain>.5?offscreenFloor(vWorld,T,opticalDistance):vec3(0.);}
  vec3 tr=transmittance(opticalDistance);float phase=pow(max(0.,dot(-V,uSun)),5.);vec3 scatter=uWaterLight*(.16+.035*max(0.,dot(N,uSun))+.07*phase);
  // Bounded crest-transmission closure; actual path attenuation is geometric.
  scatter+=uWaterLight*.06*phase*smoothstep(-.5,1.8,vWorld.y)*(1.-N.y*N.y);
  transmitted=hitColor*tr+scatter*(1.-tr);
 }
 vec3 color=reflected*F+transmitted*(1.-F);
 if(!under){vec3 H=normalize(V+uSun);float nh=max(0.,dot(N,H)),nl=max(0.,dot(N,uSun)),a2=alpha*alpha,den=nh*nh*(a2-1.)+1.;float D=a2/(PI*den*den);float spec=D*smith(NoV,a2)*smith(max(.001,nl),a2)*dielectric(max(0.,dot(V,H)),1.,1.333)/(4.*NoV+.0001);color+=uSunColor*min(spec*nl,80.)*.14*solarVisibility();}
 float jac=tx.x*tz.z-tx.z*tz.x;vec4 white=texture(uWhitewater,clamp(vQ/uFoamSize+.5,.001,.999));float foam=white.r;
 float offshore=smoothstep(uFoamSize*.42,uFoamSize*.48,max(abs(vQ.x),abs(vQ.y)));foam=mix(foam,clamp((.42-jac)*1.2,0.,.4),offshore);
 foam=clamp(foam+response.w*.65,0.,1.);
 float shore=(uTerrain>.5&&!under)?exp(-opticalDistance*4.)*.48*(.65+.35*sin(vWorld.x*.9+uTime*.4)):0.;foam=clamp(foam+shore,0.,1.);
 vec4 grain=texture(uMicro,vQ*.17+velocity.xz*.002);vec4 cells=texture(uMicro,vQ*1.9);float torn=texture(uMicro,vec2(vQ.x*.055,vQ.y*.22)).r;
 // Density -> porous coverage. Old foam fragments; cell rims and fine bubbles remain.
 float density=foam*(.55+grain.r*1.2);float perforation=smoothstep(.12,.78,density*2.7-(1.-grain.r)*.48-torn*.12);
 float age=clamp(white.g/12.,0.,1.);float cover=perforation*(.48+.32*cells.b+.20*cells.g);cover*=uFoamEnable*(1.-age*.2);
 vec3 foamRadiance=environment(vec3(0.,1.,0.))*.45+uSunColor*max(.05,dot(N,uSun))*.24+vec3(.16,.17,.18);
 foamRadiance*=.83+.17*grain.r;if(under)foamRadiance*=.42;
 color=mix(color,foamRadiance,clamp(cover,0.,.97));
 if(!under){float haze=1.-exp(-dist*(uWind>15.?.00018:.00004));color=mix(color,environment(normalize(vec3(vWorld.x-uEye.x,.015,vWorld.z-uEye.z))),haze);}
 if(uDebug==1)color=N*.5+.5;
 if(uDebug==2)color=jac<0.?vec3(1.,0.,1.):mix(vec3(.015,.09,.30),vec3(1.,.28,.018),clamp(1.-jac,0.,1.));
 if(uDebug==3)color=vec3(1.-exp(-opticalDistance*.13),exp(-opticalDistance*.08),exp(-opticalDistance*.02))*.65;
 if(uDebug==4)color=vec3(foam,clamp(white.g/15.,0.,1.)*foam,white.b*3.);
 if(uDebug==5)color=vec3(.2)+abs(velocity)*.14;
 if(uDebug==6)color=vec3(.03,.12,.2)+vec3(max(0.,response.x)*2.,response.w*.8,max(0.,-response.x)*2.);
 fragColor=vec4(max(color,vec3(0.)),rainReactive>.002?.5:1.);motion=vec4(velocity+vec3(response.y,0.,response.z),1.);
}`;
export const skyVertex = `precision highp float;in vec3 position;uniform mat4 projectionMatrix,modelViewMatrix,modelMatrix;out vec3 vWorld;void main(){vWorld=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
export const skyFragment = `precision highp float;in vec3 vWorld;out vec4 fragColor;${environmentGLSL}
void main(){vec3 d=normalize(vWorld-uEye);vec3 c=environment(d);float angle=acos(clamp(dot(d,uSun),-1.,1.));float disk=1.-smoothstep(.0041,.005,angle);c+=uSunColor*disk*18.*solarVisibility();c+=uSunColor*.018*exp(-angle*23.);fragColor=vec4(c,0.);}`;
export const objectVertex = `precision highp float;in vec3 position,normal;uniform mat4 projectionMatrix,modelViewMatrix,modelMatrix,viewMatrix;uniform mat3 normalMatrix;out vec3 vWorld,vNormal;void main(){vWorld=(modelMatrix*vec4(position,1.)).xyz;vNormal=normalize(mat3(transpose(viewMatrix))*normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
export const objectFragment = `precision highp float;in vec3 vWorld,vNormal;out vec4 fragColor;${environmentGLSL}
uniform sampler2D uRockDiffuse,uRockNormal,uSandDiffuse,uSandNormal;uniform vec3 uAlbedo;uniform float uKind,uClip,uCausticEnable,uUnderwater;uniform sampler2D uCaustics,uShadowDepth;uniform mat4 uShadowMatrix;uniform float uCausticSize;
float sunlightVisibility(vec3 p,vec3 n){vec4 sc=uShadowMatrix*vec4(p+n*.025,1.);vec3 q=sc.xyz/sc.w*.5+.5;if(any(lessThan(q,vec3(.001)))||any(greaterThan(q,vec3(.999))))return 1.;float visibility=0.;for(int i=0;i<4;i++){vec2 off=vec2((i%2)==0?-.7:.7,i<2?-.7:.7)/1536.;float depth=texture(uShadowDepth,q.xy+off).r;visibility+=q.z-.00045<depth?1.:0.;}return visibility*.25;}
float rockNoise(vec3 p){vec3 w=pow(abs(normalize(vNormal)),vec3(4.));w/=w.x+w.y+w.z;return noise2(p.yz)*w.x+noise2(p.zx)*w.y+noise2(p.xy)*w.z;}
void main(){if(uClip>.5&&vWorld.y<-.03)discard;vec3 N=normalize(vNormal),V=normalize(uEye-vWorld);float a=noise2(vWorld.xz*.045),b=noise2(vWorld.xy*.26),c=noise2(vWorld.zy*2.1);vec3 albedo=uAlbedo;
 if(uKind<.5){float fade=exp(-length(vWorld-uEye)*.012);float ripple=.5+.5*sin(vWorld.x*5.5+sin(vWorld.z*.7)*2.1);vec3 sand=pow(texture(uSandDiffuse,vWorld.xz*.5).rgb,vec3(2.2));albedo=sand*.87+uAlbedo*.26;albedo*=.90+.09*ripple*fade;vec3 bump=texture(uSandNormal,vWorld.xz*.5).rgb*2.-1.;N=normalize(N+vec3(bump.x,0.,bump.y)*.36);}
 else if(uKind<1.5){float grain=rockNoise(vWorld*1.8),detail=rockNoise(vWorld*13.7),macro=rockNoise(vWorld*.081);vec3 w=pow(abs(N),vec3(4.));w/=dot(w,vec3(1.));vec3 tex=texture(uRockDiffuse,vWorld.yz/2.4).rgb*w.x+texture(uRockDiffuse,vWorld.zx/2.4).rgb*w.y+texture(uRockDiffuse,vWorld.xy/2.4).rgb*w.z;albedo=pow(tex,vec3(2.2))*.88+uAlbedo*.19;albedo*=.83+.3*macro;vec3 bx=texture(uRockNormal,vWorld.yz/2.4).rgb*2.-1.,by=texture(uRockNormal,vWorld.zx/2.4).rgb*2.-1.,bz=texture(uRockNormal,vWorld.xy/2.4).rgb*2.-1.;vec3 detailNormal=vec3(bx.z*sign(N.x),bx.x,bx.y)*w.x+vec3(by.y,by.z*sign(N.y),by.x)*w.y+vec3(bz.x,bz.y,bz.z*sign(N.z))*w.z;N=normalize(mix(N,detailNormal,.42));}
 else if(uKind>2.5&&uKind<3.5){float grain=.5+.5*sin(vWorld.x*53.+a*19.);albedo*=.55+.26*grain+.2*b;}
 float wet=1.-smoothstep(.0,.65,vWorld.y);if(uKind<1.5)albedo*=mix(1.,.48,wet);
 float shadow=sunlightVisibility(vWorld,N);float nl=max(0.,dot(N,uSun));vec3 sky=environmentRough(N,.8)*.55+vec3(.03,.033,.035);vec3 illumination=sky+uSunColor*nl*shadow*.39;
 float depth=max(0.,-vWorld.y);vec3 lightAtten=exp(-(uAbsorption+uScattering)*depth/max(.15,uSun.y));
 if(vWorld.y<0.){illumination*=lightAtten;vec2 cuv=vWorld.xz/uCausticSize+.5;if(uCausticEnable>.5&&all(greaterThan(cuv,vec2(0.)))&&all(lessThan(cuv,vec2(1.)))){float caustic=texture(uCaustics,cuv).r;illumination+=uSunColor*lightAtten*nl*max(0.,caustic)*shadow*.48;}}
 vec3 H=normalize(V+uSun);float rough=uKind>3.5?.14:(uKind>1.5?.28:mix(.8,.25,wet));float spec=pow(max(dot(N,H),0.),mix(10.,210.,1.-rough))*(uKind>3.5?.6:.10);vec3 color=albedo*illumination+uSunColor*spec*nl*shadow;
 if(uKind>3.5)color=mix(color,environmentRough(reflect(-V,N),rough)*albedo,.46);
 // Attenuate the submerged portion of geometry along the viewing path in the underwater post pass.
 fragColor=vec4(color,.5);}`;
