import {THREE,target,uniform as U} from './gpu.js';
import {environmentGLSL} from './environment.js';
import {waveDeclarations} from './gpu-ocean.js';
/** Refracted sunlight photon splats. Light samples and surface normals come from
 * the same evolving ocean field; the receiver is the actual analytic bed surface.
 * This is a raster photon-density estimate, not a volume/path-traced caustic solver.
 */
export class Caustics {
 constructor(renderer,ocean,shared,n=256,size=96){
  this.renderer=renderer;this.size=size;this.n=n;this.target=target(512,512,{type:THREE.HalfFloatType,linear:true});this.uniforms={...shared,...ocean.uniforms,uCausticSize:U(size),uPhotonScale:U((512/n)**2)};
  const pos=new Float32Array(n*n*3);for(let y=0;y<n;y++)for(let x=0;x<n;x++){let i=(y*n+x)*3;pos[i]=((x+.5)/n-.5)*size;pos[i+2]=((y+.5)/n-.5)*size;}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
  const mat=new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,uniforms:this.uniforms,depthTest:false,depthWrite:false,transparent:true,blending:THREE.AdditiveBlending,
   vertexShader:`precision highp float;in vec3 position;out float vFlux;uniform float uCausticSize,uPhotonScale;${environmentGLSL}${waveDeclarations}
    void main(){vec3 d,tx,tz,vel;wave(position.xz,d,tx,tz,vel);vec3 p=position+d;vec3 area=cross(tz,tx),N=normalize(area);vec3 ray=refract(-uSun,N,1./1.333);float t=max(0.,(bedHeight(p.xz)-p.y)/min(-.05,ray.y));for(int i=0;i<3;i++)t=max(0.,(bedHeight(p.xz+ray.xz*t)-p.y)/min(-.05,ray.y));vec3 hit=p+ray*t;float F=dielectric(dot(N,uSun),1.,1.333);vFlux=max(0.,dot(area,uSun))/max(.1,uSun.y)*(1.-F)*uPhotonScale/2.55;gl_Position=vec4(hit.x/uCausticSize*2.,hit.z/uCausticSize*2.,0.,1.);gl_PointSize=3.0;}`,
   fragmentShader:`precision highp float;in float vFlux;out vec4 fragColor;void main(){vec2 p=(gl_PointCoord-.5)*2.;float r2=dot(p,p);if(r2>1.)discard;float weight=exp(-r2*2.4);fragColor=vec4(vFlux*weight,0.,0.,1.);}`});
  this.scene=new THREE.Scene();const mesh=new THREE.Points(geo,mat);mesh.frustumCulled=false;this.scene.add(mesh);this.camera=new THREE.Camera();
 }
 render(){this.renderer.setRenderTarget(this.target);this.renderer.setClearColor(0,0);this.renderer.clear();this.renderer.render(this.scene,this.camera);this.renderer.setRenderTarget(null);}
}
