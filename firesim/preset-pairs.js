import { FIRE_PRESETS } from './pyro-gpu/presets.js?v=95fcf488354ba45d';

// Shared authored IDs have independent implementations in both solvers.
const originalToVolume = Object.freeze({
  sigil: 'sigil-cybr',
  campfire: 'hearth',
  bonfire: 'bonfire',
  hearth: 'hearth',
  torch: 'torch',
  ring: 'ring',
  sphere: 'sphere',
  wall: 'curtain',
  explosion: 'explosion',
});

const volumeToOriginal = Object.freeze({
  'sigil-cybr': 'sigil-cybr',
  hearth: 'hearth',
  bonfire: 'bonfire',
  torch: 'torch',
  ring: 'ring',
  sphere: 'sphere',
  curtain: 'curtain',
  explosion: 'explosion',
});

export function matchingPreset(targetEngine, currentFire) {
  if (targetEngine === 'volume' && currentFire?.startsWith('legacy:'))
    return originalToVolume[currentFire.slice(7)] ||
      (FIRE_PRESETS.some(p => p.id === currentFire.slice(7)) ? currentFire.slice(7) : null);
  if (targetEngine === 'legacy' && currentFire && !currentFire.startsWith('legacy:')) {
    const original = volumeToOriginal[currentFire] ||
      (FIRE_PRESETS.some(p => p.id === currentFire) ? currentFire : null);
    return original ? 'legacy:' + original : null;
  }
  return null;
}
