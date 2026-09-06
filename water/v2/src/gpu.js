import * as THREE from "../vendor/three.module.js";
export { THREE };
export const quadVertex = `precision highp float;in vec3 position;out vec2 vUv;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}`;
const quad = new THREE.BufferGeometry();
quad.setAttribute(
  "position",
  new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
);
export function target(
  w,
  h,
  { count = 1, type = THREE.FloatType, linear = false, depth = false } = {},
) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    count,
    type,
    format: THREE.RGBAFormat,
    minFilter: linear ? THREE.LinearFilter : THREE.NearestFilter,
    magFilter: linear ? THREE.LinearFilter : THREE.NearestFilter,
    depthBuffer: depth,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  for (const t of rt.textures) {
    t.colorSpace = THREE.NoColorSpace;
    t.generateMipmaps = false;
  }
  if (depth) {
    rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    rt.depthTexture.format = THREE.DepthFormat;
  }
  return rt;
}
export class Pass {
  constructor(fragment, uniforms = {}) {
    this.uniforms = uniforms;
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: quadVertex,
      fragmentShader: fragment,
      uniforms,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.Mesh(quad, this.material));
    this.camera = new THREE.Camera();
  }
  run(renderer, rt, layer = 0) {
    renderer.setRenderTarget(rt, layer);
    renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.material.dispose();
  }
}
export function dataTexture(
  data,
  width,
  height,
  { linear = false, repeat = false } = {},
) {
  const t = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  t.minFilter = t.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}
export function uniform(value) {
  return { value };
}
