// Presentation identity is independent of the shared Volume source IDs.
export function modeForFire(fire, preferred) {
  if (fire?.startsWith('legacy:')) return 'legacy';
  return preferred === 'sparse' ? 'sparse' : 'volume';
}

export function runtimeFamily(mode) {
  return mode === 'legacy' ? 'legacy' : 'volume';
}

export function readSimulation(params) {
  const mode = params.get('simulation');
  if (mode === 'sparse' || (mode === 'volume' && params.get('bricks') === '1')) return 'sparse';
  return mode === 'volume' ? 'volume' : 'legacy';
}

export function volumeOptions(params, mode) {
  if (mode === 'sparse') return {
    adaptive: false, pressureWork: false, brickPool: true,
    lightWork: false, lightReceivers: false,
  };
  return {
    adaptive: params.get('solver') === 'adaptive',
    pressureWork: params.get('pressureWork') === '1',
    brickPool: false,
    lightWork: params.get('lightWork') === '1',
    lightReceivers: params.get('receivers') === '1',
  };
}
