// Original's simulation-specific emitter IDs for the shared authored sources.
export function emitterKindFor(preset) {
  if (!preset) throw new Error('Missing Original source preset');
  const type = preset.effect[0];
  if (type >= 22 && type <= 27) return type;
  if (type === 0) return 6;
  if (type === 1) return preset.id === 'torch' ? 2 : 1;
  if (type === 2) return 3;
  if (type === 3) return 5;
  if (type === 4) return 4;
  if (type >= 5 && type <= 9) return type + 2;
  if (type === 10) return 0;
  if (type >= 11 && type <= 14) return type + 1;
  if (type === 15) return preset.object === 'house' ? 17 : 16;
  if (type === 16) return 18;
  if (type === 17) return 19;
  if (type === 18) return 20;
  if (type >= 19 && type <= 21) return 21;
  throw new Error('No Original emitter for source effect ' + type);
}
