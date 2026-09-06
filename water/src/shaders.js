/** Shared GLSL: used unchanged by Three.js RawShaderMaterial and WebGL2 fallback. */
export const skyVertex=`#version 300 es
precision highp float;
in vec3 position;
out vec2 vUv;
void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,1.,1.);}`;
export const common=`
const float PI=3.141592653589793;
uniform sampler2D uSky;
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform float uExposure;
uniform float uTime;
uniform vec2 uResolution;
vec3 environment(vec3 d){d=normalize(d);vec2 uv=vec2(atan(d.z,d.x)/(2.*PI)+.5,acos(clamp(d.y,-1.,1.))/PI);return texture(uSky,uv).rgb;}
float solarVisibility(){vec3 d=normalize(uSun);return texture(uSky,vec2(atan(d.z,d.x)/(2.*PI)+.5,acos(clamp(d.y,-1.,1.))/PI)).a;}
vec3 aces(vec3 c){c=max(c*uExposure,0.);c=(c*(2.51*c+.03))/(c*(2.43*c+.59)+.14);return pow(clamp(c,0.,1.),vec3(1./2.2));}
float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
vec3 film(vec3 c){vec2 uv=gl_FragCoord.xy/uResolution;float vignette=1.-.13*pow(length((uv-.5)*vec2(1.1,1.)),1.5);vec3 outc=aces(c)*vignette;outc+=(hash21(gl_FragCoord.xy+floor(uTime*24.)*.37)-.5)/420.;return clamp(outc,0.,1.);}
`;
export const skyFragment=`#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform vec3 uForward,uRight,uUp;
uniform float uTanFov,uAspect;
${common}
void main(){vec2 uv=vUv*2.-1.;vec3 d=normalize(uForward+uRight*uv.x*uAspect*uTanFov+uUp*uv.y*uTanFov);vec3 sky=environment(d);float angle=acos(clamp(dot(d,uSun),-1.,1.));float disk=1.-smoothstep(.0041,.0049,angle);sky+=uSunColor*disk*18.*solarVisibility();sky+=uSunColor*.025*exp(-angle*23.);fragColor=vec4(film(sky),1.);}`;
export const waterVertex=`#version 300 es
precision highp float;
in vec3 position;
uniform mat4 uViewProjection;
uniform vec3 uEye;
uniform sampler2D uDisplacement0,uDisplacement1,uDisplacement2;
uniform sampler2D uRipple;
uniform vec2 uRippleCenter;
uniform float uRippleSize;
uniform float uTime;
out vec3 vWorld;
out vec2 vQ;
out float vDistance;
void main(){
 vec2 q=position.xz+uEye.xz;
 float r=length(position.xz);
 vec4 d0=texture(uDisplacement0,q/768.+vec2(0.5/128.));
 vec4 d1=texture(uDisplacement1,q/96.+vec2(0.5/128.));
 vec4 d2=texture(uDisplacement2,q/12.+vec2(0.5/128.));
 float f1=1.-smoothstep(500.,1800.,r),f2=1.-smoothstep(70.,300.,r);
 vec3 displacement=d0.xyz+d1.xyz*f1+d2.xyz*f2;
 vec2 ruv=(q-uRippleCenter)/uRippleSize+.5;
 if(all(greaterThan(ruv,vec2(0.)))&&all(lessThan(ruv,vec2(1.))))displacement.y+=texture(uRipple,ruv).r;
 vec3 world=vec3(q.x,0.,q.y)+displacement;
 // Earth curvature makes a genuine geometric horizon instead of a visible plane edge.
 world.y-=r*r/(2.*6371000.);
 vWorld=world;vQ=q;vDistance=length(world-uEye);
 gl_Position=uViewProjection*vec4(world,1.);
}`;
export const waterFragment=`#version 300 es
precision highp float;
in vec3 vWorld;
in vec2 vQ;
in float vDistance;
out vec4 fragColor;
uniform vec3 uEye,uWater,uBuoyPosition;
uniform float uBuoyRadius,uBuoyVisible;
uniform float uDepth,uRoughness,uWind,uDebug;
uniform sampler2D uDisplacement0,uDisplacement1,uDisplacement2;
uniform sampler2D uDerivativeX0,uDerivativeX1,uDerivativeX2;
uniform sampler2D uDerivativeZ0,uDerivativeZ1,uDerivativeZ2;
uniform sampler2D uMicro;
uniform sampler2D uRipple;
uniform vec2 uRippleCenter;
uniform float uRippleSize;
${common}
float fresnel(float ci){float eta=1./1.333;float ct=sqrt(max(0.,1.-eta*eta*(1.-ci*ci)));float rs=(ci-1.333*ct)/(ci+1.333*ct);float rp=(1.333*ci-ct)/(1.333*ci+ct);return .5*(rs*rs+rp*rp);}
float smith(float nd,float a2){return 2.*nd/(nd+sqrt(a2+(1.-a2)*nd*nd));}
vec3 ground(vec2 p){float grains=texture(uMicro,p*.045).r;float ripples=.5+.5*sin(p.x*2.5+.6*sin(p.y*.24));return vec3(.38,.32,.21)*(.7+.18*grains+.12*ripples);}
float sphereHit(vec3 origin,vec3 direction){
 if(uBuoyVisible<.5)return -1.;
 vec3 oc=origin-uBuoyPosition;float b=dot(oc,direction),c=dot(oc,oc)-uBuoyRadius*uBuoyRadius;
 float disc=b*b-c;if(disc<0.)return -1.;float t=-b-sqrt(disc);return t>.003?t:-1.;
}
vec3 sphereRadiance(vec3 position,vec3 view){
 vec3 n=normalize(position-uBuoyPosition);vec3 albedo=abs(n.y)<.18?vec3(.012,.017,.021):vec3(.48,.065,.015);
 float diffuse=max(0.,dot(n,uSun));vec3 h=normalize(view+uSun);
 return albedo*(environment(n)*.55+uSunColor*diffuse*.45)+uSunColor*pow(max(0.,dot(n,h)),56.)*.12;
}
void main(){
 float radius=length(vQ-uEye.xz);
 float f1=1.-smoothstep(500.,1800.,radius);
 float f2=1.-smoothstep(70.,300.,radius);
 vec4 ax0=texture(uDerivativeX0,vQ/768.+vec2(0.5/128.)),az0=texture(uDerivativeZ0,vQ/768.+vec2(0.5/128.));
 vec4 ax1=texture(uDerivativeX1,vQ/96.+vec2(0.5/128.)),az1=texture(uDerivativeZ1,vQ/96.+vec2(0.5/128.));
 vec4 ax2=texture(uDerivativeX2,vQ/12.+vec2(0.5/128.)),az2=texture(uDerivativeZ2,vQ/12.+vec2(0.5/128.));
 vec3 tx=vec3(1.,0.,0.)+ax0.xyz+ax1.xyz*f1+ax2.xyz*f2;
 vec3 tz=vec3(0.,0.,1.)+az0.xyz+az1.xyz*f1+az2.xyz*f2;
 vec2 ruv=(vQ-uRippleCenter)/uRippleSize+.5;
 if(all(greaterThan(ruv,vec2(.01)))&&all(lessThan(ruv,vec2(.99)))){vec4 r=texture(uRipple,ruv);tx.y+=r.g;tz.y+=r.b;}
 float microFade=1.-smoothstep(2.,18.,vDistance);
 // Analytic gravity-capillary detail; wavelengths are 4-20 cm, amplitudes sub-mm.
 for(int i=0;i<5;i++){
  float fi=float(i),wl=.045+fi*.033,k=2.*PI/wl;
  vec2 direction=vec2(cos(fi*2.399),sin(fi*2.399));
  float omega=sqrt(9.81*k+.000074*k*k*k);
  float slope=.010*cos(dot(direction,vQ)*k-uTime*omega)*microFade;
  tx.y+=direction.x*slope;tz.y+=direction.y*slope;
 }
 vec3 N=normalize(cross(tz,tx));
 vec3 V=normalize(uEye-vWorld);
 if(N.y<0.)N=-N;
 float NoV=max(.002,dot(N,V));
 // Prevent inverted reflection normals on unresolved near-grazing slopes.
 if(dot(N,V)<.015)N=normalize(N+V*(.015-dot(N,V)));
 vec3 R=reflect(-V,N);
 R.y=max(R.y,.003);
 float F=fresnel(clamp(dot(N,V),0.,1.));
 vec3 reflected=environment(R);
 float reflectedHit=sphereHit(vWorld+N*.006,R);
 if(reflectedHit>0.)reflected=sphereRadiance(vWorld+R*reflectedHit,V);
 vec3 refractedDir=refract(-V,N,1./1.333);
 float rayLength=min(120.,(uDepth+vWorld.y)/max(.1,-refractedDir.y));
 vec3 bottom=ground(vWorld.xz+refractedDir.xz*rayLength)*.65;
 // Exact ray/sphere intersections for the diagnostic buoy, not a generic scene-refraction pass.
 float transmittedHit=sphereHit(vWorld-N*.006,refractedDir);
 if(transmittedHit>0.&&transmittedHit<rayLength){rayLength=transmittedHit;bottom=sphereRadiance(vWorld+refractedDir*transmittedHit,-refractedDir);}
 vec3 attenuation=exp(-vec3(.19,.052,.035)*rayLength);
 vec3 scatter=uWater*(.7+.3*max(0.,dot(N,uSun)));
 // Crest transmission is a bounded single-scattering approximation.
 float forward=pow(max(0.,dot(-V,uSun)),4.)*pow(max(0.,1.-N.y),.5);
 scatter+=vec3(.008,.06,.047)*forward*smoothstep(-.4,1.5,vWorld.y);
 vec3 transmitted=bottom*attenuation+scatter*(1.-attenuation);
 vec3 color=reflected*F+transmitted*(1.-F);
 vec3 H=normalize(V+uSun);float NoH=max(dot(N,H),0.),NoL=max(dot(N,uSun),0.);
 float variance=.5*(dot(dFdx(N),dFdx(N))+dot(dFdy(N),dFdy(N)));
 float alpha=clamp(uRoughness*uRoughness+variance*.65+.004, .004,.3),a2=alpha*alpha;
 float denom=NoH*NoH*(a2-1.)+1.;
 float D=a2/(PI*denom*denom);
 float spec=D*smith(NoV,a2)*smith(max(.001,NoL),a2)*fresnel(max(0.,dot(V,H)))/(4.*NoV+.0001);
 color+=uSunColor*min(spec*NoL,65.)*.11*solarVisibility();
 float foam0=texture(uDisplacement0,vQ/768.+vec2(0.5/128.)).a;
 float foam1=texture(uDisplacement1,vQ/96.+vec2(0.5/128.)).a;
 float foam2=texture(uDisplacement2,vQ/12.+vec2(0.5/128.)).a;
 float foam=clamp(foam0+foam1*.8+foam2*.30,0.,1.);
 vec4 tex=texture(uMicro,vQ*.12);
 float detail=texture(uMicro,vQ*1.4).g;
 // Material-coordinate foam is persistent; texture only breaks up its optical coverage.
 float cover=smoothstep(.22,.70,foam*1.8+tex.r*.40-.10);
 float bubbles=mix(.7,1.,detail);
 cover*=bubbles;
 vec3 foamColor=environment(vec3(0.,1.,0.))*.45+vec3(.57,.60,.60)+uSunColor*NoL*.06;
 color=mix(color,foamColor,cover);
 float mist=1.-exp(-vDistance*(uWind>15.?.00020:.000047));
 vec3 haze=environment(normalize(vec3(vWorld.x-uEye.x,.01,vWorld.z-uEye.z)));
 color=mix(color,haze,mist);
 if(uDebug>1.5){float jac=tx.x*tz.z-tx.z*tz.x;color=mix(vec3(.1,.25,.55),vec3(1.,.14,.02),clamp((1.-jac)*2.,0.,1.));}
 else if(uDebug>.5){color=N*.5+.5;}
 fragColor=vec4(film(color),1.);
}`;
export const objectVertex=`#version 300 es
precision highp float;
in vec3 position;
in vec3 normal;
in vec3 color;
uniform mat4 uViewProjection;
out vec3 vNormal,vColor,vWorld;
void main(){vNormal=normal;vColor=color;vWorld=position;gl_Position=uViewProjection*vec4(position,1.);}`;
export const objectFragment=`#version 300 es
precision highp float;
in vec3 vNormal,vColor,vWorld;
out vec4 fragColor;
uniform vec3 uEye;
${common}
void main(){vec3 N=normalize(vNormal);float diffuse=max(0.,dot(N,uSun));vec3 V=normalize(uEye-vWorld);vec3 H=normalize(V+uSun);float spec=pow(max(0.,dot(N,H)),56.);vec3 radiance=vColor*(environment(N)*.55+uSunColor*diffuse*.45)+uSunColor*spec*.12;fragColor=vec4(film(radiance),1.);}`;
export const sprayVertex=`#version 300 es
precision highp float;
in vec3 position;
in vec2 aInfo;
uniform mat4 uViewProjection;
uniform vec3 uEye;
uniform float uPointScale;
out float vAlpha;
void main(){gl_Position=uViewProjection*vec4(position,1.);float d=length(position-uEye);gl_PointSize=clamp(aInfo.y*uPointScale/max(d,1.),1.,18.);vAlpha=aInfo.x;}`;
export const sprayFragment=`#version 300 es
precision highp float;
in float vAlpha;
out vec4 fragColor;
void main(){float r=length(gl_PointCoord-.5)*2.;float a=exp(-r*r*4.)*vAlpha;if(r>1.||a<.01)discard;fragColor=vec4(.84,.86,.86,a*.48);}`;
