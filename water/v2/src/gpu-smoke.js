import { THREE } from "./gpu.js";
import { GPUOcean } from "./gpu-ocean.js";
try {
  const r = new THREE.WebGLRenderer({
    canvas: document.querySelector("canvas"),
  });
  r.autoClear = false;
  const ocean = new GPUOcean(r, 64);
  ocean.reset({
    hs: 3.4,
    period: 7.4,
    depth: 30,
    direction: -0.25,
    chop: 0.65,
  });
  const stats = ocean.verify();
  window.result = { stats, programs: r.info.programs.length };
  console.log(JSON.stringify(window.result));
} catch (e) {
  window.result = { error: String(e), stack: e.stack };
  console.error(e);
}
