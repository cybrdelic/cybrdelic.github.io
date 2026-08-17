import * as THREE from 'three/webgpu';
import {
  pass, mrt, output, diffuseColor, normalView, velocity,
  metalness, roughness, vec2, vec4, add,
  packNormalToRGB, unpackRGBToNormal, sample
} from 'three/tsl';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const $ = (id) => document.getElementById(id);
const toast = (text, ms = 2500) => {
  $('toast').textContent = text;
  $('toast').style.display = 'block';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => $('toast').style.display = 'none', ms);
};

// ---------------- Renderer / quality policy ----------------
const renderer = new THREE.WebGPURenderer({ antialias: true });
let renderScale = Math.min(devicePixelRatio, 1.35);
renderer.setPixelRatio(renderScale);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
await renderer.init();

const nativeGPU = renderer.backend?.isWebGPUBackend === true;
$('backend').textContent = nativeGPU ? 'NATIVE WEBGPU' : 'WEBGL2 FALLBACK';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030710);
scene.fog = new THREE.FogExp2(0x06111e, 0.0068);
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.08, 320);

// PMREM environment gives physically coherent specular fill instead of black materials.
const room = new RoomEnvironment();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(room, 0.04).texture;
scene.environmentIntensity = 0.92;
pmrem.dispose();

scene.add(new THREE.HemisphereLight(0x8095ad, 0x060708, 0.22));
const moon = new THREE.DirectionalLight(0xb6d2ff, 1.85);
moon.position.set(-30, 42, 18);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
moon.shadow.camera.left = -34;
moon.shadow.camera.right = 34;
moon.shadow.camera.top = 34;
moon.shadow.camera.bottom = -34;
moon.shadow.camera.near = 0.5;
moon.shadow.camera.far = 130;
moon.shadow.bias = -0.0003;
moon.shadow.normalBias = 0.03;
scene.add(moon);

// ---------------- Texture synthesis: breakup without fake metallic asphalt ----------------
function makeNoiseTexture(size = 256, contrast = 0.18, base = 0.52) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: false });
  const im = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const large = Math.sin(x * 0.085) * Math.sin(y * 0.067) * 0.12;
      const fine = (Math.random() - 0.5) * contrast;
      const v = Math.max(0, Math.min(1, base + large + fine));
      const b = Math.round(v * 255);
      im.data[i] = im.data[i + 1] = im.data[i + 2] = b;
      im.data[i + 3] = 255;
    }
  }
  ctx.putImageData(im, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities?.getMaxAnisotropy?.() || 8);
  return tex;
}
const asphaltRoughness = makeNoiseTexture(256, 0.22, 0.48);
asphaltRoughness.repeat.set(24, 24);
const concreteRoughness = makeNoiseTexture(256, 0.16, 0.66);
concreteRoughness.repeat.set(12, 8);

// ---------------- Track ----------------
const N = 720;
const roadHalfWidth = 7.2;
const track = [];
for (let i = 0; i < N; i++) {
  const a = i / N * Math.PI * 2;
  const r = 62 + Math.sin(a * 2.0) * 10 + Math.sin(a * 5.0 + 0.42) * 5.5 + Math.sin(a * 9.0) * 1.15;
  track.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
}
function frameAt(i) {
  const p0 = track[(i - 1 + N) % N];
  const p = track[i % N];
  const p1 = track[(i + 1) % N];
  const tangent = p1.clone().sub(p0).normalize();
  const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
  return { p, tangent, side, yaw: Math.atan2(tangent.x, tangent.z) };
}

const roadPos = [], roadUv = [], roadIdx = [];
for (let i = 0; i < N; i++) {
  const { p, side } = frameAt(i);
  const L = p.clone().addScaledVector(side, roadHalfWidth);
  const R = p.clone().addScaledVector(side, -roadHalfWidth);
  roadPos.push(L.x, 0.02, L.z, R.x, 0.02, R.z);
  roadUv.push(0, i / 7, 1, i / 7);
}
for (let i = 0; i < N; i++) {
  const j = (i + 1) % N;
  roadIdx.push(i * 2, j * 2, i * 2 + 1, j * 2, j * 2 + 1, i * 2 + 1);
}
const roadGeo = new THREE.BufferGeometry();
roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPos, 3));
roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUv, 2));
roadGeo.setIndex(roadIdx);
roadGeo.computeVertexNormals();

// Wet asphalt is dielectric, not metallic. The old material was physically wrong.
const roadMat = new THREE.MeshPhysicalMaterial({
  color: 0x11161b,
  metalness: 0.0,
  roughness: 0.31,
  roughnessMap: asphaltRoughness,
  clearcoat: 0.48,
  clearcoatRoughness: 0.12,
  envMapIntensity: 0.82
});
const road = new THREE.Mesh(roadGeo, roadMat);
road.receiveShadow = true;
scene.add(road);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(175, 160),
  new THREE.MeshStandardMaterial({ color: 0x101711, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.035;
ground.receiveShadow = true;
scene.add(ground);

// Lane centerline and edge reflectors add scale cues and reduce the "floating ribbon" look.
const lineMat = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.5 });
const yellowMat = new THREE.MeshStandardMaterial({ color: 0xd9ab32, roughness: 0.48 });
for (let i = 0; i < N; i += 9) {
  const { p, yaw } = frameAt(i);
  const dash = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.018, 2.5), lineMat);
  dash.position.set(p.x, 0.045, p.z);
  dash.rotation.y = yaw;
  scene.add(dash);
}
for (let i = 0; i < N; i += 6) {
  const { p, side, yaw } = frameAt(i);
  for (const s of [-1, 1]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.018, 2.15), yellowMat);
    edge.position.copy(p).addScaledVector(side, s * (roadHalfWidth - 0.45));
    edge.position.y = 0.044;
    edge.rotation.y = yaw;
    scene.add(edge);
  }
}

// ---------------- Tunnel architecture ----------------
const concreteMat = new THREE.MeshStandardMaterial({
  color: 0x4a5056,
  roughness: 0.67,
  roughnessMap: concreteRoughness,
  metalness: 0,
  envMapIntensity: 0.35
});
const lowerWallMat = new THREE.MeshPhysicalMaterial({
  color: 0x252d34,
  roughness: 0.34,
  metalness: 0,
  clearcoat: 0.25,
  clearcoatRoughness: 0.18,
  envMapIntensity: 0.7
});
const darkMetal = new THREE.MeshStandardMaterial({ color: 0x151a1f, metalness: 0.78, roughness: 0.28 });
const emissiveWhite = new THREE.MeshStandardMaterial({ color: 0xdde4e8, emissive: 0xf3f8ff, emissiveIntensity: 5.2, roughness: 0.32 });
const emissiveCyan = new THREE.MeshStandardMaterial({ color: 0x0a617e, emissive: 0x35c9ff, emissiveIntensity: 8.0, roughness: 0.32 });
const emissiveAmber = new THREE.MeshStandardMaterial({ color: 0x8f5516, emissive: 0xffa53c, emissiveIntensity: 7.0, roughness: 0.35 });

const tunnelRanges = [[126, 270], [430, 560]];
const tunnelIndices = new Set();
for (const [a, b] of tunnelRanges) for (let i = a; i <= b; i++) tunnelIndices.add(i % N);

// Segment length is short; ribs deliberately cover joints so there are no unexplained cracks.
for (const [start, end] of tunnelRanges) {
  for (let i = start; i <= end; i += 5) {
    const { p, side, yaw } = frameAt(i);
    const segLen = 4.55;

    const roof = new THREE.Mesh(new THREE.BoxGeometry(roadHalfWidth * 2 + 2.2, 0.34, segLen + 0.45), concreteMat);
    roof.position.set(p.x, 5.2, p.z);
    roof.rotation.y = yaw;
    roof.castShadow = roof.receiveShadow = true;
    scene.add(roof);

    for (const s of [-1, 1]) {
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.38, 4.65, segLen + 0.45), concreteMat);
      upper.position.copy(p).addScaledVector(side, s * (roadHalfWidth + 0.93));
      upper.position.y = 2.52;
      upper.rotation.y = yaw;
      upper.castShadow = upper.receiveShadow = true;
      scene.add(upper);

      const lower = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.55, segLen + 0.26), lowerWallMat);
      lower.position.copy(p).addScaledVector(side, s * (roadHalfWidth + 0.70));
      lower.position.y = 1.02;
      lower.rotation.y = yaw;
      lower.receiveShadow = true;
      scene.add(lower);

      const conduit = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, segLen * 0.93, 8), darkMetal);
      conduit.rotation.x = Math.PI / 2;
      conduit.rotation.z = -yaw;
      conduit.position.copy(p).addScaledVector(side, s * (roadHalfWidth + 0.64));
      conduit.position.y = 3.70;
      scene.add(conduit);
    }

    // Rib / expansion joint hides slab boundaries and gives believable construction rhythm.
    const rib = new THREE.Mesh(new THREE.BoxGeometry(roadHalfWidth * 2 + 2.4, 0.16, 0.18), darkMetal);
    rib.position.set(p.x, 4.96, p.z);
    rib.rotation.y = yaw;
    scene.add(rib);

    // Large luminous ceiling panel + actual broad spill approximated with spot lights.
    const panel = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.055, 1.65), emissiveWhite);
    panel.position.set(p.x, 4.86, p.z);
    panel.rotation.y = yaw;
    scene.add(panel);

    if (((i - start) / 5) % 2 === 0) {
      const down = new THREE.SpotLight(0xe8f2ff, 31, 10, 0.95, 0.8, 1.5);
      down.position.set(p.x, 4.60, p.z);
      down.target.position.set(p.x, 0, p.z);
      down.castShadow = false;
      scene.add(down, down.target);
    }

    // Colored side practicals are spaced sparsely; no alternating neon every slab.
    if (((i - start) / 5) % 5 === 2) {
      for (const s of [-1, 1]) {
        const fixture = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 1.55), emissiveCyan);
        fixture.position.copy(p).addScaledVector(side, s * (roadHalfWidth + 0.64));
        fixture.position.y = 1.65;
        fixture.rotation.y = yaw;
        scene.add(fixture);
        const spill = new THREE.PointLight(0x36c7ff, 10, 7.5, 2);
        spill.position.copy(fixture.position).addScaledVector(side, -s * 0.15);
        scene.add(spill);
      }
    }
  }

  // Portal structures.
  for (const i of [start - 4, end + 4]) {
    const { p, side, yaw } = frameAt(i);
    for (const s of [-1, 1]) {
      const column = new THREE.Mesh(new THREE.BoxGeometry(0.85, 5.9, 0.9), concreteMat);
      column.position.copy(p).addScaledVector(side, s * (roadHalfWidth + 0.9));
      column.position.y = 2.95;
      column.rotation.y = yaw;
      column.castShadow = column.receiveShadow = true;
      scene.add(column);

      const amber = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.9, 0.18), emissiveAmber);
      amber.position.copy(column.position).addScaledVector(side, -s * 0.48);
      amber.position.y = 3.0;
      scene.add(amber);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(roadHalfWidth * 2 + 2.55, 0.82, 0.9), concreteMat);
    beam.position.set(p.x, 5.35, p.z);
    beam.rotation.y = yaw;
    beam.castShadow = true;
    scene.add(beam);
  }
}

// Guard barriers and sparse roadside reflectors for believable scale outside tunnels.
const barrierMat = new THREE.MeshStandardMaterial({ color: 0x7e8589, metalness: 0.72, roughness: 0.38 });
const reflectorMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xb9d7ff, emissiveIntensity: 2.4, roughness: 0.5 });
for (let i = 0; i < N; i += 10) {
  if (tunnelIndices.has(i)) continue;
  const { p, side, yaw } = frameAt(i);
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.30, 3.5), barrierMat);
    rail.position.copy(p).addScaledVector(side, s * (roadHalfWidth + 1.05));
    rail.position.y = 0.62;
    rail.rotation.y = yaw;
    scene.add(rail);

    const refl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.035), reflectorMat);
    refl.position.copy(rail.position).addScaledVector(side, -s * 0.07);
    refl.position.y = 0.72;
    refl.rotation.y = yaw;
    scene.add(refl);
  }
}

// ---------------- Car / Ferrari ----------------
const carRoot = new THREE.Group();
scene.add(carRoot);
const fallback = new THREE.Group();
const fallbackBody = new THREE.Mesh(
  new THREE.BoxGeometry(1.82, 0.50, 4.05),
  new THREE.MeshPhysicalMaterial({ color: 0x6d0812, metalness: 0.72, roughness: 0.17, clearcoat: 1, clearcoatRoughness: 0.025, envMapIntensity: 1.2 })
);
fallbackBody.position.y = 0.62;
fallbackBody.castShadow = true;
fallback.add(fallbackBody);
const fallbackCabin = new THREE.Mesh(
  new THREE.BoxGeometry(1.48, 0.5, 1.7),
  new THREE.MeshPhysicalMaterial({ color: 0x13222d, roughness: 0.045, metalness: 0, transmission: 0.42, transparent: true, opacity: 0.9 })
);
fallbackCabin.position.set(0, 1.02, -0.18);
fallback.add(fallbackCabin);
for (const x of [-0.92, 0.92]) for (const z of [-1.25, 1.25]) {
  const w = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.28, 20), new THREE.MeshStandardMaterial({ color: 0x060709, roughness: 0.72 }));
  w.rotation.z = Math.PI / 2;
  w.position.set(x, 0.42, z);
  fallback.add(w);
}
carRoot.add(fallback);

// Headlights are attached to carRoot so they remain after Ferrari swap.
for (const x of [-0.53, 0.53]) {
  const spot = new THREE.SpotLight(0xe4f1ff, 44, 44, 0.31, 0.55, 1.25);
  spot.position.set(x, 0.74, -1.62);
  spot.target.position.set(x, 0.10, -24);
  carRoot.add(spot, spot.target);
}
const tailGlow = new THREE.PointLight(0xff1e3d, 5.5, 4.5, 2);
tailGlow.position.set(0, 0.72, 1.9);
carRoot.add(tailGlow);

const draco = new DRACOLoader();
draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/libs/draco/');
const gltf = new GLTFLoader();
gltf.setDRACOLoader(draco);
const ferrariURLs = [
  'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r185/examples/models/gltf/ferrari.glb',
  'https://threejs.org/examples/models/gltf/ferrari.glb',
  'https://rawcdn.githack.com/mrdoob/three.js/r185/examples/models/gltf/ferrari.glb'
];
let ferrariAttempt = 0;
function loadFerrari() {
  if (ferrariAttempt >= ferrariURLs.length) {
    $('asset').textContent = 'Ferrari unavailable — fallback body active';
    return;
  }
  const attempt = ++ferrariAttempt;
  $('asset').textContent = `Ferrari loading ${attempt}/${ferrariURLs.length}`;
  gltf.load(ferrariURLs[attempt - 1], (g) => {
    const car = g.scene.children[0] || g.scene;
    car.scale.setScalar(1.03);
    car.rotation.y = Math.PI;
    car.position.y = 0.02;
    car.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const body = car.getObjectByName('body');
    if (body) body.material = new THREE.MeshPhysicalMaterial({
      color: 0xa80712,
      metalness: 0.78,
      roughness: 0.17,
      clearcoat: 1,
      clearcoatRoughness: 0.028,
      envMapIntensity: 1.22
    });
    const glass = car.getObjectByName('glass');
    if (glass) glass.material = new THREE.MeshPhysicalMaterial({
      color: 0x8eabc0,
      metalness: 0,
      roughness: 0.035,
      transmission: 0.76,
      transparent: true,
      opacity: 0.92,
      ior: 1.48,
      envMapIntensity: 1.0
    });
    carRoot.remove(fallback);
    carRoot.add(car);
    $('asset').textContent = `Ferrari loaded · mirror ${attempt}`;
  }, (xhr) => {
    if (xhr.total) $('asset').textContent = `Ferrari ${attempt}/${ferrariURLs.length} · ${Math.round(xhr.loaded / xhr.total * 100)}%`;
  }, () => setTimeout(loadFerrari, 100));
}
loadFerrari();

// ---------------- Official hybrid graph + temporal AA ----------------
let renderPipeline = null;
let hybridActive = false;
let hybridDisabled = false;
function buildHybridPipeline() {
  if (!nativeGPU || hybridDisabled) return;
  try {
    const pipeline = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera);
    scenePass.setMRT(mrt({
      output,
      diffuseColor,
      normal: packNormalToRGB(normalView),
      velocity,
      metalrough: vec2(metalness, roughness)
    }));

    const colorTex = scenePass.getTextureNode('output');
    const diffuseTex = scenePass.getTextureNode('diffuseColor');
    const depthTex = scenePass.getTextureNode('depth');
    const normalPacked = scenePass.getTextureNode('normal');
    const velocityTex = scenePass.getTextureNode('velocity');
    const mrTex = scenePass.getTextureNode('metalrough');

    scenePass.getTexture('diffuseColor').type = THREE.UnsignedByteType;
    scenePass.getTexture('normal').type = THREE.UnsignedByteType;
    scenePass.getTexture('metalrough').type = THREE.UnsignedByteType;

    const normalTex = sample((uv) => unpackRGBToNormal(normalPacked.sample(uv)));
    const giPass = ssgi(colorTex, depthTex, normalTex, camera);
    giPass.sliceCount.value = 1;
    giPass.stepCount.value = 6;
    giPass.radius.value = 5.5;
    giPass.giIntensity.value = 1.05;
    giPass.aoIntensity.value = 0.75;
    giPass.useTemporalFiltering = true;

    const ao = giPass.getAONode();
    const gi = giPass.getGINode();
    const indirectComposite = vec4(add(colorTex.rgb.mul(ao.r), diffuseTex.rgb.mul(gi.rgb)), colorTex.a);

    const reflections = ssr(indirectComposite, depthTex, normalTex, {
      metalnessNode: mrTex.r,
      roughnessNode: mrTex.g
    });
    reflections.quality.value = 0.42;
    reflections.maxDistance.value = 0.48;
    reflections.intensity.value = 0.58;
    reflections.thickness.value = 0.028;

    // TRAA is the key anti-shimmer fix. It consumes velocity/depth and temporally stabilizes geometry + SSR.
    const temporal = traa(indirectComposite.add(reflections.rgb), depthTex, velocityTex, camera);
    pipeline.outputNode = temporal;
    renderPipeline = pipeline;
    hybridActive = true;
    $('hybrid').textContent = 'SSGI + AO + SSR + TRAA';
  } catch (e) {
    hybridDisabled = true;
    $('hybrid').textContent = 'PBR + MSAA fallback';
    console.warn('Hybrid pipeline disabled:', e);
  }
}

// ---------------- Driving physics ----------------
let px = track[0].x, pz = track[0].z, yaw = 0, speed = 0, steer = 0, steerInput = 0;
let throttle = 0, brake = 0, nearest = 0;
function resetCar() {
  const p = track[0], q = track[1];
  px = p.x; pz = p.z;
  yaw = Math.atan2(q.x - p.x, q.z - p.z);
  speed = 0; steer = 0; steerInput = 0; nearest = 0;
  carRoot.position.set(px, 0.04, pz);
  carRoot.rotation.y = yaw;
}
$('reset').onclick = resetCar;
function bindHold(id, on, off) {
  const e = $(id);
  e.addEventListener('pointerdown', (ev) => { ev.preventDefault(); on(); navigator.vibrate?.(5); try { e.setPointerCapture(ev.pointerId); } catch {} });
  e.addEventListener('pointerup', (ev) => { ev.preventDefault(); off(); });
  e.addEventListener('pointercancel', (ev) => { ev.preventDefault(); off(); });
}
bindHold('gas', () => throttle = 1, () => throttle = 0);
bindHold('brake', () => brake = 1, () => brake = 0);
function nearestRoad(x, z, start) {
  let best = start, bestD = Infinity;
  for (let k = -28; k <= 28; k++) {
    const i = (start + k + N) % N;
    const p = track[i];
    const dx = p.x - x, dz = p.z - z, d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return [best, Math.sqrt(bestD)];
}

// ---------------- Gyro ----------------
let gyro = false, alpha = null, baseAlpha = null, sensorEvents = 0;
function wrapDeg(v) { while (v > 180) v -= 360; while (v < -180) v += 360; return v; }
addEventListener('deviceorientation', (e) => {
  if (e.alpha == null) return;
  alpha = e.alpha;
  sensorEvents++;
  if (gyro) {
    if (baseAlpha == null) baseAlpha = alpha;
    steerInput = THREE.MathUtils.clamp(wrapDeg(alpha - baseAlpha) / 40, -1, 1);
  }
}, true);
$('gyro').onclick = async () => {
  if (gyro) {
    baseAlpha = alpha;
    steerInput = 0;
    toast('Gyro recentered', 900);
    return;
  }
  try {
    if (typeof DeviceOrientationEvent === 'undefined') throw new Error('orientation API unavailable');
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') throw new Error('permission denied');
    }
    gyro = true;
    baseAlpha = alpha;
    $('gyro').textContent = 'RECENTER GYRO';
    toast(alpha == null ? 'Permission granted; waiting for sensor data' : 'Rotate phone like a steering wheel', 1800);
  } catch (e) { toast(`Gyro unavailable: ${e.message}`, 3000); }
};

let steerPointer = null, lastX = 0;
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.clientY < innerHeight * 0.72) { steerPointer = e.pointerId; lastX = e.clientX; }
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!gyro && e.pointerId === steerPointer) {
    steerInput = THREE.MathUtils.clamp(steerInput + (e.clientX - lastX) / 92, -1, 1);
    lastX = e.clientX;
  }
});
renderer.domElement.addEventListener('pointerup', (e) => { if (e.pointerId === steerPointer) steerPointer = null; });

// ---------------- Camera / dynamics / adaptive resolution ----------------
const camPos = new THREE.Vector3();
const look = new THREE.Vector3();
let last = performance.now(), fpsStamp = last, frames = 0, stableFrames = 0;
let fpsEMA = 60, qualityTimer = 0;
function updatePhysics(dt) {
  const [ni, dist] = nearestRoad(px, pz, nearest);
  nearest = ni;
  const off = Math.max(0, dist - roadHalfWidth);
  const engine = throttle * (18.5 * (1 - Math.max(0, speed) / 72));
  const brakes = brake * 32;
  const drag = 0.18 + 0.0098 * speed * speed + (off > 0 ? 7.5 + off * 2.3 : 0);
  speed += (engine - drag - brakes) * dt;
  speed = THREE.MathUtils.clamp(speed, 0, 72);

  if (!gyro && steerPointer === null) steerInput *= Math.exp(-dt * 4.5);
  steer += (steerInput - steer) * (1 - Math.exp(-dt * 9.5));
  const steerGain = 1 / (1 + speed * 0.019);
  yaw += steer * 0.72 * steerGain * speed * 0.060 * dt;
  px += Math.sin(yaw) * speed * dt;
  pz += Math.cos(yaw) * speed * dt;

  if (off > 5) {
    const p = track[nearest];
    px += (p.x - px) * dt * 0.75;
    pz += (p.z - pz) * dt * 0.75;
    speed *= Math.pow(0.48, dt);
  }

  carRoot.position.set(px, 0.04, pz);
  carRoot.rotation.y = yaw;

  const landscape = innerWidth > innerHeight;
  const back = landscape ? 7.2 : 8.0;
  const height = landscape ? 2.35 : 2.95;
  const lateral = steer * Math.min(0.22, speed * 0.0035);
  const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const target = new THREE.Vector3(px - Math.sin(yaw) * back, height, pz - Math.cos(yaw) * back).addScaledVector(side, lateral);
  camPos.lerp(target, 1 - Math.exp(-dt * 6.5));
  camera.position.copy(camPos);
  look.set(px + Math.sin(yaw) * 5.3, 0.78, pz + Math.cos(yaw) * 5.3);
  camera.lookAt(look);

  $('speed').textContent = `${Math.round(speed * 2.237)} MPH`;
  $('sensor').textContent = `gyro ${gyro ? 'ON' : 'OFF'} · alpha ${alpha == null ? '--' : alpha.toFixed(1)}° · events ${sensorEvents}`;
}

function setRenderScale(next) {
  const clamped = Math.max(1.0, Math.min(Math.min(devicePixelRatio, 1.45), next));
  if (Math.abs(clamped - renderScale) < 0.04) return;
  renderScale = clamped;
  renderer.setPixelRatio(renderScale);
  renderer.setSize(innerWidth, innerHeight);
  $('quality').textContent = `${renderScale.toFixed(2)}× DPR`;
}

function animate(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  updatePhysics(dt);

  try {
    if (hybridActive && renderPipeline) renderPipeline.render();
    else renderer.render(scene, camera);
  } catch (e) {
    hybridActive = false;
    hybridDisabled = true;
    renderPipeline = null;
    $('hybrid').textContent = 'PBR + MSAA fallback';
    renderer.render(scene, camera);
  }

  stableFrames++;
  if (stableFrames === 5 && nativeGPU) buildHybridPipeline();

  frames++;
  const instantFPS = dt > 0 ? 1 / dt : 60;
  fpsEMA = fpsEMA * 0.95 + instantFPS * 0.05;
  qualityTimer += dt;
  if (qualityTimer > 2.5) {
    qualityTimer = 0;
    if (fpsEMA < 34 && renderScale > 1.02) setRenderScale(renderScale - 0.10);
    else if (fpsEMA > 55 && renderScale < Math.min(devicePixelRatio, 1.45) - 0.04) setRenderScale(renderScale + 0.08);
  }
  if (now - fpsStamp > 900) {
    $('fps').textContent = `${Math.round(frames * 1000 / (now - fpsStamp))} FPS`;
    frames = 0;
    fpsStamp = now;
  }
}

resetCar();
camPos.set(px, 2.5, pz - 7.2);
$('quality').textContent = `${renderScale.toFixed(2)}× DPR`;
renderer.setAnimationLoop(animate);

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
