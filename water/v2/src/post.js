import { THREE, Pass, target, uniform as U } from "./gpu.js";
import { environmentGLSL } from "./environment.js";
export class PostProcessor {
  constructor(renderer, shared, width, height) {
    this.renderer = renderer;
    this.a = target(width, height, { type: THREE.HalfFloatType, linear: true });
    this.b = target(width, height, { type: THREE.HalfFloatType, linear: true });
    this.valid = false;
    this.uniforms = {
      ...shared,
      uCurrent: U(null),
      uMotion: U(null),
      uDepth: U(null),
      uHistory: U(this.a.texture),
      uInvVP: U(new THREE.Matrix4()),
      uPrevVP: U(new THREE.Matrix4()),
      uResolution: U(new THREE.Vector2(width, height)),
      uHistoryValid: U(0),
      uUnderwater: U(0),
      uTAA: U(1),
      uDt: U(1 / 24),
    };
    this.resolve = new Pass(
      `precision highp float;in vec2 vUv;out vec4 fragColor;${environmentGLSL}
   uniform sampler2D uCurrent,uMotion,uDepth,uHistory;uniform mat4 uInvVP,uPrevVP;uniform vec2 uResolution;uniform float uHistoryValid,uUnderwater,uTAA,uDt;
   vec3 world(vec2 uv,float d){vec4 p=uInvVP*vec4(uv*2.-1.,d*2.-1.,1.);return p.xyz/p.w;}
   vec3 volumeColor(vec2 uv){vec3 c=texture(uCurrent,uv).rgb;float depth=texture(uDepth,uv).r;
    if(uUnderwater>.001){vec3 p=world(uv,depth),ray=normalize(p-uEye);float len=min(95.,length(p-uEye));vec3 tr=transmittance(len);float g=.72,mu=dot(ray,uSun);float phase=(1.-g*g)/pow(1.+g*g-2.*g*mu,1.5)*.085;vec3 scatter=uWaterLight*(.19+phase*.1);c=mix(c,c*tr+scatter*(1.-tr),uUnderwater);}
    return c;
   }
   void main(){float depth=texture(uDepth,vUv).r;vec3 p=world(vUv,depth);vec4 motion=texture(uMotion,vUv);vec3 previousPosition=p-motion.xyz*uDt*motion.a;vec4 prev=uPrevVP*vec4(previousPosition,1.);vec2 uv=prev.xy/prev.w*.5+.5;
    vec3 current=volumeColor(vUv),lo=current,hi=current;vec2 px=1./uResolution;for(int i=0;i<4;i++){vec2 off=i==0?vec2(px.x,0.):(i==1?vec2(-px.x,0.):(i==2?vec2(0.,px.y):vec2(0.,-px.y)));vec3 c=volumeColor(clamp(vUv+off,vec2(0.),vec2(1.)));lo=min(lo,c);hi=max(hi,c);}
    vec4 history=texture(uHistory,clamp(uv,.001,.999));float valid=uHistoryValid*uTAA;float material=texture(uCurrent,vUv).a;if(material>.05&&material<.95)valid=0.;
    if(any(lessThan(uv,vec2(.001)))||any(greaterThan(uv,vec2(.999))))valid=0.;
    float z=length(p-uEye);float tolerance=.08+z*.025;if(abs(history.a-z)>tolerance)valid=0.;
    vec3 clamped=clamp(history.rgb,lo-.008,hi+.008);float lumDelta=length(clamped-current)/(length(current)+.05);float weight=valid*.68*exp(-lumDelta*3.);
    fragColor=vec4(mix(current,clamped,weight),min(z,60000.));
   }`,
      this.uniforms,
    );
    this.display = new Pass(
      `precision highp float;in vec2 vUv;out vec4 fragColor;uniform sampler2D uInput;uniform float uExposure;uniform vec2 uResolution;
   float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
   void main(){vec3 c=max(texture(uInput,vUv).rgb*uExposure,0.);c=clamp((c*(2.51*c+.03))/(c*(2.43*c+.59)+.14),0.,1.);c=pow(c,vec3(1./2.2));float vig=1.-.065*pow(length((vUv-.5)*vec2(1.1,1.)),1.5);c=c*vig+(hash(gl_FragCoord.xy)-.5)/1024.;fragColor=vec4(c,1.);}`,
      {
        uInput: U(this.b.texture),
        uExposure: shared.uExposure,
        uResolution: this.uniforms.uResolution,
      },
    );
  }
  reset() {
    this.valid = false;
  }
  resize(w, h) {
    this.a.setSize(w, h);
    this.b.setSize(w, h);
    this.uniforms.uResolution.value.set(w, h);
    this.reset();
  }
  render(sceneRT, viewProjection, underwater, time) {
    const u = this.uniforms;
    u.uCurrent.value = sceneRT.texture;
    u.uMotion.value = sceneRT.textures[1];
    u.uDt.value =
      this.lastTime === undefined ? 0 : Math.max(0, time - this.lastTime);
    this.lastTime = time;
    u.uDepth.value = sceneRT.depthTexture;
    u.uHistory.value = this.a.texture;
    u.uInvVP.value.copy(viewProjection).invert();
    u.uHistoryValid.value = this.valid ? 1 : 0;
    u.uUnderwater.value = underwater;
    this.resolve.run(this.renderer, this.b);
    this.display.uniforms.uInput.value = this.b.texture;
    this.display.run(this.renderer, null);
    [this.a, this.b] = [this.b, this.a];
    u.uPrevVP.value.copy(viewProjection);
    this.valid = true;
  }
}
