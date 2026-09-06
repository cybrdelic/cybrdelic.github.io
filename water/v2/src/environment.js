import { THREE, uniform as U } from "./gpu.js";
export const environmentGLSL = `
const float PI=3.141592653589793;
uniform sampler2D uSky,uMicro;uniform vec3 uSun,uSunColor,uEye;uniform float uTime,uExposure;
uniform vec3 uAbsorption,uScattering,uWaterLight;uniform vec4 uBed;
vec2 environmentUV(vec3 d){d=normalize(d);return vec2(atan(d.z,d.x)/(2.*PI)+.5,acos(clamp(d.y,-1.,1.))/PI);}
vec3 environment(vec3 d){return texture(uSky,environmentUV(d)).rgb;}
vec3 environmentRough(vec3 d,float rough){return textureLod(uSky,environmentUV(d),clamp(rough*9.,0.,6.)).rgb;}
float solarVisibility(){return texture(uSky,environmentUV(uSun)).a;}
float noise2(vec2 p){return texture(uMicro,p).r;}
float bedHeight(vec2 p){float h=-uBed.x-uBed.y*35.*tanh(p.x/35.)-uBed.z*35.*tanh(p.y/35.);
 if(uBed.w>.5){h+=.18*sin(p.x*.27+sin(p.y*.1))+.14*sin(p.y*.36);float bank=1.-smoothstep(-66.,-25.,p.y);float headlands=exp(-pow((p.x+29.)/16.,2.))+exp(-pow((p.x-33.)/19.,2.));h+=bank*(3.+11.*headlands);}
 return h;}
float dielectric(float ci,float ni,float nt){ci=clamp(abs(ci),0.,1.);float s2=pow(ni/nt,2.)*(1.-ci*ci);if(s2>=1.)return 1.;float ct=sqrt(1.-s2);float rs=(ni*ci-nt*ct)/(ni*ci+nt*ct);float rp=(nt*ci-ni*ct)/(nt*ci+ni*ct);return .5*(rs*rs+rp*rp);}
vec3 transmittance(float d){return exp(-(uAbsorption+uScattering)*max(0.,d));}
`;
export function bedHeightJS(x, z, p) {
  let h = -p[0] - p[1] * 35 * Math.tanh(x / 35) - p[2] * 35 * Math.tanh(z / 35);
  if (p[3] > 0.5) {
    h +=
      0.18 * Math.sin(x * 0.27 + Math.sin(z * 0.1)) + 0.14 * Math.sin(z * 0.36);
    let b = Math.max(0, Math.min(1, (z + 66) / 41));
    b = 1 - b * b * (3 - 2 * b);
    h +=
      b *
      (3 +
        11 *
          (Math.exp(-(((x + 29) / 16) ** 2)) +
            Math.exp(-(((x - 33) / 19) ** 2))));
  }
  return h;
}
export async function assetBytes(path) {
  if (window.__ASSETS__?.[path] || window.__LOAD_ASSET__) {
    const e = window.__ASSETS__?.[path] || (await window.__LOAD_ASSET__(path));
    const raw = Uint8Array.from(atob(e.data), (c) => c.charCodeAt(0));
    return e.gzip
      ? new Uint8Array(
          await new Response(
            new Blob([raw])
              .stream()
              .pipeThrough(new DecompressionStream("gzip")),
          ).arrayBuffer(),
        )
      : raw;
  }
  const base = window.__ASSET_BASE__ || "";
  const r = await fetch(base + path);
  if (!r.ok) throw new Error(`Cannot load ${path}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
export async function loadEnvironment() {
  const skies = {};
  for (const name of ["dawn", "blue", "storm"]) {
    const raw = await assetBytes("assets/" + name + ".rgba16f");
    const data = new Uint16Array(
      raw.buffer,
      raw.byteOffset,
      raw.byteLength / 2,
    );
    const tex = new THREE.DataTexture(
      data,
      2048,
      1024,
      THREE.RGBAFormat,
      THREE.HalfFloatType,
    );
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    skies[name] = tex;
  }
  const read = async (name) => {
    const data = await assetBytes("assets/" + name);
    const im = await createImageBitmap(
      new Blob([data], {
        type: name.endsWith(".jpg") ? "image/jpeg" : "image/png",
      }),
    );
    const tex = new THREE.Texture(im);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    return tex;
  };
  return {
    skies,
    micro: await read("micro.png"),
    foam: await read("foam.png"),
    rockDiffuse: await read("rock_face_diff.jpg"),
    rockNormal: await read("rock_face_nor_gl.jpg"),
    sandDiffuse: await read("damp_sand_diff.jpg"),
    sandNormal: await read("damp_sand_nor_gl.jpg"),
  };
}
export function sharedEnvironment(assets) {
  return {
    uRockDiffuse: U(assets.rockDiffuse),
    uRockNormal: U(assets.rockNormal),
    uSandDiffuse: U(assets.sandDiffuse),
    uSandNormal: U(assets.sandNormal),
    uSky: U(assets.skies.blue),
    uMicro: U(assets.micro),
    uSun: U(new THREE.Vector3(-0.4, 0.48, -0.78).normalize()),
    uSunColor: U(new THREE.Vector3(2.3, 2.25, 2.12)),
    uEye: U(new THREE.Vector3()),
    uTime: U(0),
    uExposure: U(1.05),
    uAbsorption: U(new THREE.Vector3(0.19, 0.047, 0.021)),
    uScattering: U(new THREE.Vector3(0.009, 0.017, 0.021)),
    uWaterLight: U(new THREE.Vector3(0.1, 0.4, 0.48)),
    uBed: U(new THREE.Vector4(5, 0.07, 0.035, 0)),
  };
}
