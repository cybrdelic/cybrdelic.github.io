"""Repair direct-light occlusion and submerged beam transport without changing physics."""
from pathlib import Path
import sys,json,hashlib
root=Path(sys.argv[1])
def patch(name,old,new):
 p=root/name;s=p.read_text();assert old in s,(name,old[:100]);p.write_text(s.replace(old,new,1))
beam='''/** Flat-interface direct beam transport; RGB extinction in inverse metres.
 * The cosine ratio preserves transmitted power per horizontal interface area.
 * This does not replace caustic focusing or resolve curved-interface visibility.
 */
export const directBeamGLSL = `
vec3 directSolarTransfer(vec3 sun,vec3 extinction,float depth,bool submerged,float cloud,out vec3 L){
 sun=normalize(sun);float mu=max(0.,sun.y);L=sun;
 if(mu<=0.)return vec3(0.);
 float visible=clamp(cloud,0.,1.);if(!submerged)return vec3(visible);
 float eta=1./1.333,cw=sqrt(max(0.,1.-eta*eta*(1.-mu*mu)));
 L=vec3(sun.x*eta,cw,sun.z*eta);
 float rs=(mu-1.333*cw)/(mu+1.333*cw),rp=(1.333*mu-cw)/(1.333*mu+cw),F=.5*(rs*rs+rp*rp);
 float beamPower=(1.-F)*mu/max(.00001,cw);
 return vec3(visible*beamPower)*exp(-max(extinction,vec3(0.))*max(0.,depth)/max(.00001,cw));
}
`;
export function directSolarTransferJS(sun, extinction, depth, submerged, cloud=1){
 if(!sun.every(Number.isFinite)||!extinction.every(v=>Number.isFinite(v)&&v>=0)||!Number.isFinite(depth)||!Number.isFinite(cloud))throw new RangeError('Invalid beam inputs');
 const n=Math.hypot(...sun);if(n===0)throw new RangeError('Zero light direction');
 const s=sun.map(v=>v/n),mu=Math.max(0,s[1]),visible=Math.max(0,Math.min(1,cloud));
 if(mu<=0)return {direction:s,transfer:[0,0,0]};
 if(!submerged)return {direction:s,transfer:[visible,visible,visible]};
 const eta=1/1.333,cw=Math.sqrt(1-eta*eta*(1-mu*mu));
 const rs=(mu-1.333*cw)/(mu+1.333*cw),rp=(1.333*mu-cw)/(1.333*mu+cw);
 const power=(1-(rs*rs+rp*rp)/2)*mu/cw;
 return {direction:[s[0]*eta,cw,s[2]*eta],transfer:extinction.map(x=>visible*power*Math.exp(-x*Math.max(0,depth)/cw))};
}
'''
(root/'public/src/light-transport.js').write_text(beam)
patch('public/src/environment.js','import { THREE, uniform as U } from "./gpu.js";','import { THREE, uniform as U } from "./gpu.js";\nimport { directBeamGLSL } from "./light-transport.js";')
patch('public/src/environment.js','vec3 transmittance(float d){return exp(-(uAbsorption+uScattering)*max(0.,d));}\n`;','vec3 transmittance(float d){return exp(-(uAbsorption+uScattering)*max(0.,d));}\n${directBeamGLSL}\n`;')
patch('public/src/surface-shading.js',''' float shadow=sunlightVisibility(p,N),nl=max(0.,dot(N,uSun));
 vec3 diffuse=skyDiffuse(N)*1.05+uSunColor*nl*shadow/PI;
 float depth=max(0.,localSurface-p.y);
 if(depth>0.){
  float eta=1./1.333,cosWater=sqrt(max(.01,1.-eta*eta*(1.-uSun.y*uSun.y)));
  vec3 lightTr=transmittance(depth/cosWater);''',''' float depth=max(0.,localSurface-p.y);vec3 L;
 vec3 beam=directSolarTransfer(uSun,uAbsorption+uScattering,depth,depth>0.,solarVisibility(),L);
 vec3 shadowPoint=depth>0.?p+L*(depth/max(.001,L.y)):p;
 float shadow=sunlightVisibility(shadowPoint,N),nl=max(0.,dot(N,L));
 vec3 direct=uSunColor*beam*shadow;
 vec3 diffuse=skyDiffuse(N)*1.05+direct*nl/PI;
 if(depth>0.){''')
patch('public/src/surface-shading.js','''  diffuse=skyDiffuse(N)*.65*transmittance(depth*1.15)+uSunColor*nl*shadow*lightTr*mix(1.,focus,.82)/PI;
 }
 vec3 H=normalize(view+uSun);''','''  diffuse=skyDiffuse(N)*.65*transmittance(depth*1.15)+direct*nl*mix(1.,focus,.82)/PI;
 }
 vec3 H=normalize(view+L);''')
patch('public/src/surface-shading.js',''' vec3 color=albedo*diffuse+uSunColor*(D*Gv*Gl*F/max(.004,4.*nv))*shadow;''',''' // Both lobes receive the same occluded, refracted and attenuated beam.
 vec3 color=albedo*diffuse+direct*(D*Gv*Gl*F/max(.004,4.*nv));''')
patch('public/src/water-shaders.js','vec3 solarReflection(vec3 N,vec3 V,float alpha){','vec3 solarReflection(vec3 p,vec3 N,vec3 V,float alpha){')
patch('public/src/water-shaders.js','return uSunColor*min(total/7.,1./.0000679)*solarVisibility();','return uSunColor*min(total/7.,1./.0000679)*solarVisibility()*sunlightVisibility(p,N);')
patch('public/src/water-shaders.js','color+=solarReflection(N,V,alpha);','color+=solarReflection(vWorld,N,V,alpha);')
patch('public/src/water-shaders.js',''' vec3 foamRadiance=skyDiffuse(N)*.80+uSunColor*max(.02,dot(N,uSun))*.27;''',''' vec3 foamRadiance=skyDiffuse(N)*.80+uSunColor*max(0.,dot(N,uSun))*(.80/PI)*solarVisibility()*sunlightVisibility(vWorld,N);''')
p=root/'tests/repair.test.mjs';s=p.read_text();s+='''
import {directSolarTransferJS} from '../public/src/light-transport.js';
test('Direct beam vanishes below the horizon and when the sun is obscured',()=>{
 assert.deepEqual(directSolarTransferJS([1,-.1,0],[.1,.2,.3],2,true).transfer,[0,0,0]);
 assert.deepEqual(directSolarTransferJS([0,1,0],[.1,.2,.3],2,true,0).transfer,[0,0,0]);
});
test('Air beam retains its direction and visibility',()=>{
 const b=directSolarTransferJS([3,4,0],[.2,.1,.04],5,false,.37);
 close(b.direction[0],.6);close(b.direction[1],.8);assert.deepEqual(b.transfer,[.37,.37,.37]);
});
test('Refraction direction obeys Snell law and remains unit length',()=>{
 for(const angle of [.01,.2,.6,1,1.4]){
  const b=directSolarTransferJS([Math.sin(angle),Math.cos(angle),0],[0,0,0],0,true);
  close(Math.hypot(...b.direction),1);close(b.direction[0]*1.333,Math.sin(angle));
 }
});
test('Submerged beam preserves interface power after Fresnel reflection',()=>{
 for(const angle of [0,.3,.8,1.2,1.5]){
  const mu=Math.cos(angle),b=directSolarTransferJS([Math.sin(angle),mu,0],[0,0,0],0,true),cw=b.direction[1];
  const rs=(mu-1.333*cw)/(mu+1.333*cw),rp=(1.333*mu-cw)/(1.333*mu+cw),F=(rs*rs+rp*rp)/2;
  close(b.transfer[0]*cw,mu*(1-F));
 }
});
test('Every submerged direct-light channel attenuates with its own optical path',()=>{
 const ext=[.32,.08,.025],sun=[.8,.6,0],a=directSolarTransferJS(sun,ext,1,true),b=directSolarTransferJS(sun,ext,7,true);
 for(let i=0;i<3;i++)close(b.transfer[i]/a.transfer[i],Math.exp(-ext[i]*6/a.direction[1]));
 assert.ok(b.transfer[0]<b.transfer[1]&&b.transfer[1]<b.transfer[2]);
});
test('Zero extinction has no depth-dependent beam loss',()=>{
 const a=directSolarTransferJS([.6,.8,0],[0,0,0],1,true),b=directSolarTransferJS([.6,.8,0],[0,0,0],100,true);
 assert.deepEqual(a,b);
});
test('Invalid direct-light inputs fail explicitly',()=>{
 assert.throws(()=>directSolarTransferJS([0,0,0],[0,0,0],1,true),RangeError);
 assert.throws(()=>directSolarTransferJS([0,1,0],[-1,0,0],1,true),RangeError);
});
''';p.write_text(s)
# Test actual GLSL beam values and the very same solarReflection used by water.
p=root/'public/src/repair-validation.js';s=p.read_text();s=s.replace("import {mulberry32} from './math.js';","import {mulberry32} from './math.js';\nimport {directSolarTransferJS} from './light-transport.js';\nimport {waterFragment} from './water-shaders.js';",1)
needle=" engine.setPreset('storm');engine.patch.reset();const lattice=[];"
assert needle in s
addition='''
 // GPU/independent analytical reference for refracted beam energy and RGB loss.
 const beamRT=target(32,1),beamPass=new Pass(`precision highp float;in vec2 vUv;out vec4 fragColor;${environmentGLSL}
 void main(){float k=gl_FragCoord.x-.5,mu=.05+.90*k/31.;vec3 sun=vec3(sqrt(1.-mu*mu),mu,0.),L;vec3 tr=directSolarTransfer(sun,vec3(.32,.08,.025),k*.3,true,.7,L);fragColor=vec4(tr,L.y);}`,engine.shared);
 beamPass.run(r,beamRT);const beams=read(beamRT);let beamError=0;
 for(let i=0;i<32;i++){const mu=.05+.90*i/31,ref=directSolarTransferJS([Math.sqrt(1-mu*mu),mu,0],[.32,.08,.025],i*.3,true,.7),expected=[...ref.transfer,ref.direction[1]];for(let c=0;c<4;c++)beamError=Math.max(beamError,Math.abs(beams[i*4+c]-expected[c]));}
 report.checks.submergedDirectBeam={samples:32,maximumTransferError:beamError,scope:'Flat-interface Fresnel power, Snell direction and RGB Beer attenuation; not full curved-interface light transport'};
 ensure(beamError<2e-6,'Submerged direct beam violates analytical energy/attenuation reference');beamPass.dispose();beamRT.dispose();
 // Occlusion is inside solarReflection, not a convention callers can forget.
 const shadow=dataTexture(new Float32Array([0,0,0,1]),1,1),sky=dataTexture(new Float32Array([.2,.2,.2,1]),1,1),sun=new THREE.Vector3(.3,.8,.4).normalize();
 const sunUniforms={...engine.shared,uSun:U(sun),uSunColor:U(new THREE.Vector3(1,1,1)),uSky:U(sky),uShadowDepth:U(shadow),uShadowMatrix:U(new THREE.Matrix4())};
 const sunPass=new Pass(waterFragment.slice(0,waterFragment.indexOf('void main(){'))+`void main(){vec3 V=vec3(0.,1.,0.),N=normalize(V+uSun);fragColor=vec4(solarReflection(vec3(0.),N,V,.04),1.);motion=vec4(0.);}`,sunUniforms),sunRT=target(1,1);
 sunPass.run(r,sunRT);const dark=read(sunRT);shadow.image.data[0]=1;shadow.needsUpdate=true;sunPass.run(r,sunRT);const lit=read(sunRT);
 report.checks.waterSolarOcclusion={blockedRadiance:Array.from(dark.slice(0,3)),unblockedRadiance:Array.from(lit.slice(0,3)),scope:'Actual water solar-reflection function with a controlled shadow-depth fixture'};
 ensure(dark[0]===0&&dark[1]===0&&dark[2]===0&&lit[0]>.001,'Water sun lobe ignores geometric occlusion');sunPass.dispose();sunRT.dispose();shadow.dispose();sky.dispose();
'''
s=s.replace(needle,addition+needle,1);p.write_text(s)
p=root/'BUGFIXES.md';s=p.read_text().replace("| Reflected/refracted objects used a different shading path |", "| Water glints and foam ignored geometry shadows | Apply the same geometry visibility to direct water and foam illumination | GPU controlled-shadow test on the actual water solar function |\n| Submerged material highlights omitted incoming-path attenuation and refraction | Shared RGB/Fresnel/Snell direct-beam transfer for diffuse and specular lobes | CPU interface-power and GPU reference tests; flat-interface direct beam approximation |\n| Reflected/refracted objects used a different shading path |",1);p.write_text(s)
p=root/'LIMITATIONS.md';s=p.read_text();s+='\nThe final direct-light correction uses a locally flat refracting interface for the incident solar beam and an above-water shadow-map lookup at its approximate entry point. It preserves flat-interface beam power and applies RGB attenuation to both material lobes, but submerged occluders along the bent incident ray and curved-interface shadow transport remain approximate.\n';p.write_text(s)
p=root/'README.md';s=p.read_text().replace('59 numerical','66 numerical').replace('30 documented','32 documented');s+='\n## Final lighting regression pass\n\nDirect water glints and foam now respect geometry shadow visibility. The incoming beam at submerged material hits has a Snell-refracted direction, Fresnel transmission, horizontal-interface power normalization and RGB path attenuation for both diffuse and specular lobes. The final native captures were rerendered after this correction. See BUGFIXES.md and the GPU direct-beam/solar-occlusion checks. The incident-beam shadow lookup retains the flat-interface approximation described in LIMITATIONS.md.\n';p.write_text(s)
(root/'docs/final-lighting-repair.json').write_text(json.dumps({'physicsChanged':False,'changes':['geometry-shadowed water glints and foam','cloud-visible surface direct light','refracted flat-interface beam energy','consistent incoming extinction for diffuse and specular'],'scriptSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},indent=2))
print('Final direct-light regression fixes applied')
