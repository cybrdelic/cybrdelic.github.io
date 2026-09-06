import { THREE, Pass, target, uniform as U } from "./gpu.js";
import { waveDeclarations } from "./gpu-ocean.js";
/** Finite-volume linear free-surface response, in a fixed world-space region.
 * h,u,v live on a staggered grid. This is not a volumetric Navier-Stokes solver.
 * The sponge deliberately removes outgoing energy; it never follows the camera.
 */
export class InteractionField {
  constructor(renderer, n = 256, size = 128, depth = 1.1) {
    this.renderer = renderer;
    this.n = n;
    this.size = size;
    this.depth = depth;
    this.dx = size / n;
    this.count = 0;
    this.appliedImpulse = [0, 0];
    this.a = target(n, n, { linear: true });
    this.b = target(n, n, { linear: true });
    this.sources = target(n, n);
    const h = `precision highp float;precision highp int;in vec2 vUv;out vec4 fragColor;uniform sampler2D uState,uSources;uniform float uDt,uDx,uDepth,uN;uniform int uStage;vec4 get(ivec2 p){return texelFetch(uState,clamp(p,ivec2(0),ivec2(int(uN)-1)),0);}`;
    this.pass = new Pass(
      h +
        `void main(){ivec2 p=ivec2(gl_FragCoord.xy);vec4 q=get(p),s=texelFetch(uSources,p,0);float edge=min(min(vUv.x,1.-vUv.x),min(vUv.y,1.-vUv.y));float damping=exp(-uDt*(.035+12.*pow(max(0.,1.-edge/.12),2.)));
   if(uStage==0){q.y-=9.81*uDt/uDx*(get(p+ivec2(1,0)).x-q.x);q.z-=9.81*uDt/uDx*(get(p+ivec2(0,1)).x-q.x);q.yz+=s.yz;q.yz*=damping;}
   else{q.x-=uDepth*uDt/uDx*(q.y-get(p-ivec2(1,0)).y+q.z-get(p-ivec2(0,1)).z);q.x=(q.x+s.x)*damping;q.w=clamp(q.w*exp(-uDt/10.)+s.w,0.,2.);}
   fragColor=q;}`,
      {
        uState: U(this.a.texture),
        uSources: U(this.sources.texture),
        uDt: U(1 / 60),
        uDx: U(this.dx),
        uDepth: U(depth),
        uN: U(n),
        uStage: U(0),
      },
    );
    this.events = [];
    this.maxEvents = 1024;
    this.pos = new Float32Array(this.maxEvents * 3);
    this.data = new Float32Array(this.maxEvents * 4);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      "aData",
      new THREE.BufferAttribute(this.data, 4).setUsage(THREE.DynamicDrawUsage),
    );
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { uSize: U(size), uN: U(n) },
      vertexShader: `precision highp float;in vec3 position;in vec4 aData;uniform float uSize,uN;out vec4 vData;void main(){gl_Position=vec4(position.x/uSize*2.,position.z/uSize*2.,0.,1.);gl_PointSize=max(3.,position.y/uSize*uN*6.);vData=aData;}`,
      fragmentShader: `precision highp float;in vec4 vData;out vec4 fragColor;void main(){vec2 p=(gl_PointCoord-.5)*6.;float r2=dot(p,p);float e=exp(-r2*.5);fragColor=vec4(vData.x*(1.-.5*r2)*e,vData.yz*e,vData.w*e);}`,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquation: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.sourceScene = new THREE.Scene();
    this.sourceScene.add(new THREE.Points(this.geometry, this.material));
    this.camera = new THREE.Camera();
    this.reset();
  }
  get texture() {
    return this.a.texture;
  }
  reset() {
    this.events.length = 0;
    this.appliedImpulse = [0, 0];
    const r = this.renderer;
    for (const rt of [this.a, this.b, this.sources]) {
      r.setRenderTarget(rt);
      r.setClearColor(0, 0);
      r.clear();
    }
    r.setRenderTarget(null);
  }
  impulse(x, z, height = 0.12, radius = 0.6, foam = 0.08, momentum = [0, 0]) {
    if (Math.abs(x) > this.size * 0.45 || Math.abs(z) > this.size * 0.45)
      return false;
    this.events.push({ x, z, height, radius, foam, momentum });
    this.appliedImpulse[0] += momentum[0];
    this.appliedImpulse[1] += momentum[1];
    return true;
  }
  step(dt) {
    const maxdt = (0.4 * this.dx) / Math.sqrt(2 * 9.81 * this.depth),
      steps = Math.max(1, Math.ceil(dt / maxdt));
    if (steps > 1)
      throw new Error(
        "Interaction step violates configured fixed-step CFL budget",
      );
    const r = this.renderer,
      num = Math.min(this.maxEvents, this.events.length);
    for (let i = 0; i < num; i++) {
      const e = this.events[i],
        norm = 1 / (2 * Math.PI * e.radius * e.radius * 1025 * this.depth);
      this.pos.set([e.x, e.radius, e.z], i * 3);
      this.data.set(
        [e.height, e.momentum[0] * norm, e.momentum[1] * norm, e.foam],
        i * 4,
      );
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aData.needsUpdate = true;
    this.geometry.setDrawRange(0, num);
    r.setRenderTarget(this.sources);
    r.setClearColor(0, 0);
    r.clear();
    if (num) r.render(this.sourceScene, this.camera);
    this.events.length = 0;
    this.pass.uniforms.uDt.value = dt;
    for (let stage = 0; stage < 2; stage++) {
      this.pass.uniforms.uStage.value = stage;
      this.pass.uniforms.uState.value = this.a.texture;
      this.pass.run(r, this.b);
      [this.a, this.b] = [this.b, this.a];
    }
    r.setRenderTarget(null);
    this.count++;
  }
  diagnostics() {
    const a = new Float32Array(this.n * this.n * 4);
    this.renderer.readRenderTargetPixels(this.a, 0, 0, this.n, this.n, a);
    let volume = 0,
      max = 0,
      energy = 0,
      finite = true;
    for (let i = 0; i < a.length; i += 4) {
      volume += a[i];
      max = Math.max(max, Math.abs(a[i]));
      energy +=
        0.5 * 9.81 * a[i] ** 2 +
        0.5 * this.depth * (a[i + 1] ** 2 + a[i + 2] ** 2);
      finite = finite && Number.isFinite(a[i]);
    }
    return {
      grid: this.n,
      size: this.size,
      volumeResidual: volume * this.dx * this.dx,
      maxHeight: max,
      energy: energy * this.dx * this.dx,
      finite,
      appliedHorizontalImpulse: this.appliedImpulse,
    };
  }
}
/** Persistent foam density, age and entrainment proxy, driven by COMPOSED Jacobian.
 * All wave bands and their spectral derivatives are combined before foam is born.
 */
export class WhitewaterField {
  constructor(renderer, ocean, interaction, n = 384, size = 256) {
    this.renderer = renderer;
    this.ocean = ocean;
    this.interaction = interaction;
    this.n = n;
    this.size = size;
    this.a = target(n, n, { linear: true, type: THREE.HalfFloatType });
    this.b = target(n, n, { linear: true, type: THREE.HalfFloatType });
    this.pass = new Pass(
      `precision highp float;in vec2 vUv;out vec4 fragColor;${waveDeclarations}
   uniform sampler2D uPrevious,uInteraction;uniform float uDt,uSize,uPatchSize,uThreshold,uGain,uLifetime;uniform vec2 uWind;
   void main(){vec2 q=(vUv-.5)*uSize;vec3 d,tx,tz,velocity;wave(q,d,tx,tz,velocity);float J=tx.x*tz.z-tx.z*tz.x;
    vec2 flow=velocity.xz*.25+uWind;vec2 uv=vUv-flow*uDt/uSize;vec4 old=texture(uPrevious,clamp(uv,vec2(0.),vec2(1.)));
    float source=clamp((uThreshold-J)*3.,0.,1.)*uGain;float birth=(1.-exp(-source*uDt*2.4));float foam=old.r*exp(-uDt/uLifetime);foam=clamp(foam+(1.-foam)*birth,0.,1.);
    float age=old.g+uDt;age=mix(age,0.,birth/max(foam,.001));float bubbles=old.b*exp(-uDt/3.)+birth*.25;
    float edge=min(min(vUv.x,1.-vUv.x),min(vUv.y,1.-vUv.y));foam*=smoothstep(0.,.02,edge);
    fragColor=vec4(foam,min(age,30.),clamp(bubbles,0.,1.),J);
   }`,
      {
        ...ocean.uniforms,
        uPrevious: U(this.a.texture),
        uInteraction: U(interaction.texture),
        uDt: U(1 / 60),
        uSize: U(size),
        uPatchSize: U(interaction.size),
        uThreshold: U(0.5),
        uGain: U(1),
        uLifetime: U(9),
        uWind: U(new THREE.Vector2()),
      },
    );
    this.reset();
  }
  get texture() {
    return this.a.texture;
  }
  reset() {
    for (const rt of [this.a, this.b]) {
      this.renderer.setRenderTarget(rt);
      this.renderer.setClearColor(0, 0);
      this.renderer.clear();
    }
    this.renderer.setRenderTarget(null);
  }
  step(dt, preset) {
    const u = this.pass.uniforms;
    u.uPrevious.value = this.a.texture;
    u.uInteraction.value = this.interaction.texture;
    u.uDt.value = dt;
    u.uThreshold.value = preset.foamThreshold;
    u.uGain.value = preset.foamGain;
    u.uLifetime.value = preset.foamLifetime;
    u.uWind.value.set(
      Math.cos(preset.direction) * preset.wind * 0.02,
      Math.sin(preset.direction) * preset.wind * 0.02,
    );
    this.pass.run(this.renderer, this.b);
    [this.a, this.b] = [this.b, this.a];
  }
}
