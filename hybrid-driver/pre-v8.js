import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// v6 normalizes every authored city to an arbitrary 155-unit span.
// Mark the Source City scene at load time, then make the one Box3#getSize()
// call used by that normalization report a 155-unit max span. This makes
// v6's computed scale exactly 1.0 while preserving the real bounding box,
// center, and minimum Y used for placement.
const originalLoad = GLTFLoader.prototype.load;
GLTFLoader.prototype.load = function(url, onLoad, onProgress, onError) {
  const isSourceCity = typeof url === 'string' && url.includes('Main_Intersection_v2.glb');
  if (!isSourceCity) return originalLoad.call(this, url, onLoad, onProgress, onError);
  return originalLoad.call(this, url, (gltf) => {
    if (gltf?.scene) gltf.scene.userData.__preserveNativeMeters = true;
    onLoad?.(gltf);
  }, onProgress, onError);
};

const originalSetFromObject = THREE.Box3.prototype.setFromObject;
THREE.Box3.prototype.setFromObject = function(object, precise) {
  const result = originalSetFromObject.call(this, object, precise);
  this.__preserveNativeMeters = !!object?.userData?.__preserveNativeMeters;
  return result;
};

const originalGetSize = THREE.Box3.prototype.getSize;
THREE.Box3.prototype.getSize = function(target) {
  const result = originalGetSize.call(this, target);
  if (this.__preserveNativeMeters) {
    const maxXZ = Math.max(result.x, result.z, 1e-6);
    const k = 155 / maxXZ;
    // Only spoof the size returned to the old normalizer. The Box3 itself is
    // untouched, so center/min remain the authored asset's native coordinates.
    result.x *= k;
    result.z *= k;
  }
  return result;
};

window.__HYBRID_SCALE_FIX_V8__ = true;
