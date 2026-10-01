// Anatomical solid coordinates stay with the material when it is cut or moved.
// Reduced procedural model after Liu et al. 2015/2016 and Larsson et al. 2022.
// It is not a fitted specimen, neural reconstruction, or reproduction of their BSDF.
export const woodMaterialWGSL = `
fn woodHash(p:vec3f)->f32{return fract(sin(dot(p,vec3f(127.1,311.7,74.7)))*43758.5453);}
fn woodNoise(p:vec3f)->f32{
 let i=floor(p);let f=fract(p);let u=f*f*(3.-2.*f);
 return mix(mix(mix(woodHash(i),woodHash(i+vec3f(1,0,0)),u.x),mix(woodHash(i+vec3f(0,1,0)),woodHash(i+vec3f(1,1,0)),u.x),u.y),mix(mix(woodHash(i+vec3f(0,0,1)),woodHash(i+vec3f(1,0,1)),u.x),mix(woodHash(i+vec3f(0,1,1)),woodHash(i+vec3f(1)),u.x),u.y),u.z);
}
fn woodCoordinates(p:vec3f)->vec3f{
 // Smooth growth distortion and a branch knot alter the whole solid field,
 // including end grain. No independently projected side/end textures.
 let bend=.035*sin(p.y*2.3)+.018*sin(p.y*7.1);
 let knot=exp(-dot(p.yz-vec2f(.23,.06),p.yz-vec2f(.23,.06))*18.);
 return vec3f(p.x+bend+.12*knot,p.y,p.z+.018*sin(p.y*3.7)+.065*knot);
}
fn woodFeatures(p:vec3f)->vec4f{
 let q=woodCoordinates(p);let radial=length(q.xz*vec2f(1,.87));
 // Authoring scale: roughly 5.6 mm rings and submillimetre pore spacing in
 // model coordinates. World scaling follows the authored piece; not a
 // specimen fit. Coarse decorative bands exaggerated the small timbers.
 let growth=radial*180.+woodNoise(q*vec3f(3,.22,3))*1.8;
 let phase=fract(growth);let late=smoothstep(.64,.87,phase)*(1.-smoothstep(.94,1.,phase));
 // Fine cellular channels run along the grain; rays cross the rings.
 let poreCell=floor(q*vec3f(1900,8,1900));let pore=pow(woodHash(poreCell),18.);
 let rays=pow(.5+.5*sin(atan2(q.z,q.x)*53.+radial*3.),18.);
 let longPhase=q.y*8.+woodNoise(q*vec3f(12,.8,12))*2.4;
 let acrossPhase=radial*35.+woodNoise(q*vec3f(4,5,4))*1.8;
 let a=abs(fract(longPhase)-.5);let b=abs(fract(acrossPhase)-.5);
 // Irregular transverse checking and longitudinal fissures, not a painted grid.
 let check=1.-smoothstep(.012,.07,a);let split=1.-smoothstep(.006,.025,b);
 // Integrate unresolved details into their mean instead of sparkling as the
 // camera or a fragment moves. The underlying solid field remains unchanged.
 let footprint=max(length(dpdx(p)),length(dpdy(p)));
 let ringWidth=max(abs(dpdx(growth)),abs(dpdy(growth)));
 let crackWidth=max(max(abs(dpdx(longPhase)),abs(dpdy(longPhase))),max(abs(dpdx(acrossPhase)),abs(dpdy(acrossPhase))));
 let ringFilter=1.-smoothstep(.12,.65,ringWidth);
 let crackFilter=1.-smoothstep(.10,.55,crackWidth);
 let poreFilter=1.-smoothstep(.0002,.0008,footprint);
 let rayFilter=1.-smoothstep(.009,.045,footprint);
 return vec4f(mix(.16,late,ringFilter),mix(.05,pore,poreFilter),mix(.1,rays,rayFilter),mix(.04,max(check,split*.7),crackFilter));
}
fn woodMaterial(p:vec3f,n:vec3f,heat:f32,virgin:f32,charMass:f32,crack:f32,bark:f32)->vec4f{
 let f=woodFeatures(p);let variation=woodNoise(p*vec3f(4,.6,4));
 var fresh=mix(vec3f(.31,.153,.057),vec3f(.115,.047,.015),f.x*.8);
 fresh*=.78+.35*variation;fresh*=1.-f.y*.5;fresh+=vec3f(.028,.014,.004)*f.z;
 if(bark>.5){fresh=mix(vec3f(.078,.034,.013),vec3f(.22,.112,.047),variation);}
 let converted=clamp(1.-virgin,0.,1.);let carbon=smoothstep(.008,.13,charMass);
 let scorch=smoothstep(.03,.24,converted);
 let fissure=f.w*smoothstep(.015,.4,crack);
 var color=mix(fresh,fresh*vec3f(.4,.21,.11),scorch);
 color=mix(color,vec3f(.012,.010,.008)*(.65+.55*variation),carbon);
 color*=1.-fissure*.86;
 let ash=smoothstep(.9,1.,converted)*(1.-smoothstep(.002,.035,charMass));
 color=mix(color,vec3f(.20,.19,.17)*(.75+.4*variation),ash);
 let roughness=clamp(mix(select(.72,.88,bark>.5),.94,carbon)+f.y*.04,.38,.98);
 return vec4f(color,roughness);
}
fn woodWorldNormal(p:vec3f,world:vec3f,n:vec3f,virgin:f32,charMass:f32,crack:f32,bark:f32)->vec3f{
 let f=woodFeatures(p);let footprint=max(length(dpdx(p)),length(dpdy(p)));
 let barkRelief=(woodNoise(p*vec3f(23,2,23))-.5)*.006*(1.-smoothstep(.015,.05,footprint));
 let height=f.x*.00012-f.y*.00008-f.w*crack*.005+barkRelief*bark;
 let px=dpdx(world);let py=dpdy(world);let r1=cross(py,n);let r2=cross(n,px);let det=dot(px,r1);
 return normalize(abs(det)*n-sign(det)*(dpdx(height)*r1+dpdy(height)*r2)+n*.0000001);
}
fn woodNormal(p:vec3f,n:vec3f,virgin:f32,charMass:f32,crack:f32,bark:f32)->vec3f{return woodWorldNormal(p,p,n,virgin,charMass,crack,bark);}
fn woodSpecular(n:vec3f,l:vec3f,v:vec3f,grain:vec3f,roughness:f32)->f32{
 let nl=max(dot(n,l),0.);let nv=max(dot(n,v),.0001);if(nl<=0.){return 0.;}
 let sum=l+v;let h=sum/max(length(sum),.0001);let nh=max(dot(n,h),0.);let vh=max(dot(v,h),0.);
 let a=roughness*roughness;let a2=a*a;let denom=nh*nh*(a2-1.)+1.;
 let distribution=a2/(3.14159265*max(denom*denom,.0001));
 let k=(roughness+1.)*(roughness+1.)/8.;let visibility=nl/(nl*(1.-k)+k)*nv/(nv*(1.-k)+k);
 let fresnel=.035+.965*pow(1.-vh,5.);
 // Weak fiber-cone sheen for unfinished wood. Suppressed for rough char/bark.
 let psi=asin(clamp(dot(l,grain),-.999,.999))+asin(clamp(dot(v,grain),-.999,.999));
 let fiber=exp(-psi*psi/ .10)*.028*max(1.-roughness,0.);
 return min(distribution*visibility*fresnel/(4.*max(nl*nv,.0001))+fiber,.8);
}
`;

// This common subset is translated once, keeping both runtime materials identical.
export const woodMaterialGLSL = woodMaterialWGSL
  .replace(/fn (\w+)\(([^)]*)\)->(vec[234]f|f32)\{/g,(_,name,args,type)=>
    (type==='f32'?'float':type.replace('f',''))+' '+name+'('+args.split(',').map(a=>a.trim().replace(/(\w+):(vec[234]f|f32)/,(_,n,t)=>(t==='f32'?'float':t.replace('f',''))+' '+n)).join(',')+'){')
  .replace(/\blet (\w+)=/g,'float $1=')
  .replace(/\bvar (\w+)=/g,'vec3 $1=')
  .replace(/\bvec([234])f\b/g,'vec$1')
  .replace(/\bdpdx\b/g,'dFdx').replace(/\bdpdy\b/g,'dFdy').replace(/atan2\(/g,'atan(')
  .replace('float i=floor(p);float f=fract(p);float u=f*f*(3.-2.*f);','vec3 i=floor(p);vec3 f=fract(p);vec3 u=f*f*(3.-2.*f);')
  .replace('float q=woodCoordinates(p);','vec3 q=woodCoordinates(p);')
  .replace('float poreCell=floor(q*vec3(1900,8,1900));','vec3 poreCell=floor(q*vec3(1900,8,1900));')
  .replaceAll('float f=woodFeatures(p);','vec4 f=woodFeatures(p);')
  .replace('float px=dFdx(world);float py=dFdy(world);float r1=cross(py,n);float r2=cross(n,px);','vec3 px=dFdx(world);vec3 py=dFdy(world);vec3 r1=cross(py,n);vec3 r2=cross(n,px);')
  .replace('float sum=l+v;float h=sum/max(length(sum),.0001);','vec3 sum=l+v;vec3 h=sum/max(length(sum),.0001);')
  .replace('select(.72,.88,bark>.5)','(bark>.5?.88:.72)');
