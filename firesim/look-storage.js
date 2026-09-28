import { FIRE_COLORS } from './pyro-gpu/fire-colors.js?v=studio-rc-3';
const KEY = 'cybr-pyro-library-v1';
const bounded = (value, min, max, fallback) =>
  Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;

export function cleanLook(value, presets) {
  if (!value || typeof value !== 'object' || typeof value.name !== 'string') return null;
  const preset = presets.find((p) => p.id === value.fire);
  const name = value.name.trim().slice(0, 80);
  if (!preset || !name) return null;
  const result = {
    name,
    fire: preset.id,
    lights:
      value.lights && typeof value.lights === 'object' && !Array.isArray(value.lights)
        ? value.lights
        : {},
    fireLight: bounded(value.fireLight ?? 24, 0, 80, 24),
    room: value.room !== false,
    smoke: !!value.smoke,
    fuel: ['wood', 'oil', 'gas'].includes(value.fuel) ? value.fuel : preset.fuel,
    color: FIRE_COLORS.some((c) => c.id === value.color) ? value.color : 'natural',
    embers: value.embers !== false,
  };
  if (value.camera) {
    const c = value.camera;
    result.camera = {
      zoom: bounded(c.zoom, 0.7, 3, 1.25),
      angle: bounded(c.angle, -75, 75, 16),
      pan:
        Array.isArray(c.pan) && c.pan.length === 2
          ? c.pan.map((v) => bounded(v, -5, 5, 0))
          : [0, 0],
    };
  }
  return result;
}

export function lookStore(storage, presets) {
  let items = [];
  try {
    const input = JSON.parse(storage?.getItem(KEY) || '[]');
    if (Array.isArray(input))
      items = input
        .map((v) => cleanLook(v, presets))
        .filter(Boolean)
        .slice(0, 40);
  } catch {}
  function commit(next) {
    try {
      if (!storage) throw new Error('Storage unavailable');
      storage.setItem(KEY, JSON.stringify(next));
    } catch {
      throw new Error('Browser storage is full or unavailable. Export your looks to keep them.');
    }
    items = next;
  }
  return {
    get items() {
      return items;
    },
    add(value) {
      if (items.length >= 40)
        throw new Error('Your library is full. Export or remove a look first.');
      const item = cleanLook(value, presets);
      if (!item) throw new Error('Give this look a name and select a fire source.');
      commit([...items, item]);
      return item;
    },
    remove(index) {
      commit(items.filter((_, i) => i !== index));
    },
    import(data) {
      if (data?.version !== 1 || !Array.isArray(data.looks))
        throw new Error('Choose a CYBR preset library.');
      const valid = data.looks.map((v) => cleanLook(v, presets)).filter(Boolean);
      if (!valid.length) throw new Error('No valid looks found.');
      const added = valid.slice(0, 40 - items.length);
      if (!added.length) throw new Error('Your library is full.');
      commit([...items, ...added]);
      return added.length;
    },
    export() {
      return { version: 1, looks: items };
    },
  };
}
