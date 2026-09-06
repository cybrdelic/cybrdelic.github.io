import { THREE, uniform as U } from "./gpu.js";
import { environmentGLSL } from "./environment.js";
import { mulberry32, clamp } from "./math.js";
/** Seeded Lagrangian secondary particles with gravity, air drag and a bubble state.
 * Birth and re-entry are unresolved whitewater closures, not entrained-air CFD.
 */
export class SecondaryParticles {
  constructor(shared, max = 10000) {
    this.max = max;
    this.shared = shared;
    this.position = new Float32Array(max * 3);
    this.velocity = new Float32Array(max * 3);
    this.info = new Float32Array(max * 4);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.surface = new Float32Array(max);
    this.cursor = 0;
    this.rng = mulberry32(871243);
    this.counts = { spray: 0, bubbles: 0 };
    const g = (this.geometry = new THREE.BufferGeometry());
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(this.position, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    g.setAttribute(
      "aInfo",
      new THREE.BufferAttribute(this.info, 4).setUsage(THREE.DynamicDrawUsage),
    );
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        ...shared,
        uPointScale: U(1080),
        uUnderwater: shared.uUnderwater,
      },
      transparent: true,
      depthTest: true,
      depthWrite: false,
      vertexShader: `precision highp float;in vec3 position;in vec4 aInfo;uniform mat4 projectionMatrix,modelViewMatrix;uniform float uPointScale;out vec4 vInfo;out float vDistance;void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(aInfo.y*uPointScale/max(.2,-p.z),.8,36.);vInfo=aInfo;vDistance=-p.z;}`,
      fragmentShader: `precision highp float;in vec4 vInfo;in float vDistance;layout(location=0) out vec4 fragColor;layout(location=1) out vec4 motion;uniform float uUnderwater;${environmentGLSL}
    void main(){motion=vec4(0.);vec2 p=(gl_PointCoord-.5)*2.;float r=length(p);if(r>1.||vInfo.x<.002)discard;bool bubble=vInfo.z>1.5;
     float a=bubble?(.13*exp(-r*r*5.)+.75*exp(-pow((r-.76)*10.,2.))):exp(-r*r*3.6);
     vec3 c=environment(vec3(0.,1.,0.))*.6+uSunColor*.15+vec3(.18,.2,.21);if(bubble){c=vec3(.2,.55,.62)+uSunColor*.11;if(uUnderwater<.5)a*=.12;}
     fragColor=vec4(c,a*vInfo.x*(bubble?.65:.55));}`,
    });
    this.mesh = new THREE.Points(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
  }
  reset() {
    this.life.fill(0);
    this.info.fill(0);
    this.age.fill(0);
    this.rng = mulberry32(871243);
    this.cursor = 0;
  }
  emitSpray(p, v, n, wind, jac) {
    const i = this.cursor++ % this.max,
      k = i * 3,
      q = i * 4;
    this.position.set(p, k);
    this.surface[i] = p[1];
    const strength = clamp(1 - jac, 0.1, 1.5);
    this.velocity.set(
      [
        v[0] + (this.rng() - 0.5) * 1.4,
        v[1] + 0.7 + strength * 3.5 + this.rng() * 1.5,
        v[2] + (this.rng() - 0.5) * 1.4,
      ],
      k,
    );
    this.life[i] = 1.3 + this.rng() * 1.8;
    this.age[i] = 0;
    this.info.set([0, 0.015 + this.rng() * 0.046, 1, wind], q);
  }
  emitWake(p, v, side) {
    const i = this.cursor++ % this.max,
      k = i * 3,
      q = i * 4;
    this.position.set(p, k);
    this.surface[i] = p[1];
    this.velocity.set(
      [
        v[0] * 0.2 + (this.rng() - 0.5) * 0.5,
        0.4 + this.rng() * 0.8,
        v[2] * 0.2 + side * 0.9,
      ],
      k,
    );
    this.life[i] = 0.5 + this.rng() * 0.6;
    this.age[i] = 0;
    this.info.set([0, 0.009 + this.rng() * 0.02, 1, 4], q);
  }
  emitBubble(p) {
    const i = this.cursor++ % this.max,
      k = i * 3,
      q = i * 4;
    this.position.set(p, k);
    this.surface[i] = 0;
    this.velocity.set(
      [
        (this.rng() - 0.5) * 0.1,
        0.23 + this.rng() * 0.22,
        (this.rng() - 0.5) * 0.1,
      ],
      k,
    );
    this.life[i] = 5 + this.rng() * 9;
    this.age[i] = 0;
    this.info.set([0, 0.016 + this.rng() * 0.025, 2, 0], q);
  }
  step(dt, time, preset) {
    this.counts = { spray: 0, bubbles: 0 };
    for (let i = 0; i < this.max; i++) {
      const q = i * 4,
        k = i * 3;
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.info[q] = 0;
        continue;
      }
      let type = this.info[q + 2];
      if (type < 1.5) {
        const drag = 0.32;
        this.velocity[k] +=
          (Math.cos(preset.direction) * preset.wind * 0.2 - this.velocity[k]) *
          drag *
          dt;
        this.velocity[k + 2] +=
          (Math.sin(preset.direction) * preset.wind * 0.2 -
            this.velocity[k + 2]) *
          drag *
          dt;
        this.velocity[k + 1] -= 9.81 * dt;
      } else {
        this.velocity[k + 1] += (0.34 - this.velocity[k + 1]) * 1.8 * dt;
        this.velocity[k] += Math.sin(time * 2 + i) * 0.025 * dt;
        this.velocity[k + 2] += Math.cos(time * 1.7 + i) * 0.025 * dt;
      }
      for (let j = 0; j < 3; j++)
        this.position[k + j] += this.velocity[k + j] * dt;
      if (
        type < 1.5 &&
        this.age[i] > 0.2 &&
        this.velocity[k + 1] < 0 &&
        this.position[k + 1] < this.surface[i] - 0.035
      ) {
        if (i % 4 === 0) {
          this.info[q + 2] = 2;
          this.info[q + 1] *= 0.65;
          this.position[k + 1] = Math.min(this.position[k + 1], -0.08);
          this.velocity[k + 1] = -0.25;
          this.age[i] = 0;
          this.life[i] = 3 + this.rng() * 4;
        } else {
          this.life[i] = 0;
          this.info[q] = 0;
          continue;
        }
      }
      if (type > 1.5 && this.position[k + 1] > 0.1) {
        this.life[i] = 0;
        this.info[q] = 0;
        continue;
      }
      this.info[q] =
        Math.min(1, this.age[i] / 0.12) *
        Math.min(1, (this.life[i] - this.age[i]) / 0.5);
      this.counts[type < 1.5 ? "spray" : "bubbles"]++;
    }
    if (preset.terrain && Math.floor(time * 60) % 3 === 0) {
      const origin = preset.bubbleEmitter || [-10, -3.6, -8];
      this.emitBubble([
        origin[0] + (this.rng() - 0.5) * 2,
        origin[1],
        origin[2] + (this.rng() - 0.5) * 2,
      ]);
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aInfo.needsUpdate = true;
  }
}
/** Actual falling line segments; surface contacts create impulses in the field.
 * The nearly calm rain scene uses mean-surface contact, rather than per-drop GPU readbacks.
 */
export class Rain {
  constructor(shared, max = 5500) {
    this.max = max;
    this.rng = mulberry32(861783);
    this.coords = new Float32Array(max * 3);
    this.velocity = new Float32Array(max * 3);
    this.vertices = new Float32Array(max * 6);
    this.impacts = 0;
    const g = (this.geometry = new THREE.BufferGeometry());
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(this.vertices, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { ...shared },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      vertexShader: `precision highp float;in vec3 position;uniform mat4 projectionMatrix,modelViewMatrix;out float vD;void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;vD=-p.z;}`,
      fragmentShader: `precision highp float;in float vD;layout(location=0) out vec4 fragColor;layout(location=1) out vec4 motion;void main(){motion=vec4(0.);float fade=exp(-max(0.,vD)*.017);fragColor=vec4(.47,.59,.64,.16*fade);}`,
    });
    this.mesh = new THREE.LineSegments(g, this.material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.reset();
  }
  reset() {
    this.rng = mulberry32(861783);
    this.impacts = 0;
    for (let i = 0; i < this.max; i++) {
      this.coords.set(
        [(this.rng() - 0.5) * 46, this.rng() * 26, (this.rng() - 0.5) * 46],
        i * 3,
      );
      this.velocity.set([0.45, -7 - this.rng() * 3, -0.25], i * 3);
    }
    this.pack();
  }
  pack() {
    for (let i = 0; i < this.max; i++) {
      const k = i * 3,
        j = i * 6;
      this.vertices[j] = this.coords[k];
      this.vertices[j + 1] = this.coords[k + 1];
      this.vertices[j + 2] = this.coords[k + 2];
      this.vertices[j + 3] = this.coords[k] - this.velocity[k] * 0.02;
      this.vertices[j + 4] = this.coords[k + 1] - this.velocity[k + 1] * 0.02;
      this.vertices[j + 5] = this.coords[k + 2] - this.velocity[k + 2] * 0.02;
    }
    this.geometry.attributes.position.needsUpdate = true;
  }
  step(dt, patch, preset, rings, time) {
    if (!preset.rain) return;
    let events = 0;
    for (let i = 0; i < this.max; i++) {
      const k = i * 3;
      for (let j = 0; j < 3; j++)
        this.coords[k + j] += this.velocity[k + j] * dt;
      if (this.coords[k + 1] <= 0) {
        if (events < 70) {
          patch.impulse(
            this.coords[k],
            this.coords[k + 2],
            -0.003,
            0.32,
            0.002,
          );
          rings?.birth(this.coords[k], this.coords[k + 2], time);
          events++;
          this.impacts++;
        }
        this.coords[k] = (this.rng() - 0.5) * 46;
        this.coords[k + 1] = 22 + this.rng() * 4;
        this.coords[k + 2] = (this.rng() - 0.5) * 46;
      }
    }
    this.pack();
  }
}
