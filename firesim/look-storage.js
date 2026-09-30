import { FIRE_COLORS } from './pyro-gpu/fire-colors.js?v=0c4b630ed586cdec';
import { modeForFire } from './simulation-modes.js?v=0c4b630ed586cdec';
const KEY = 'cybr-pyro-library-v1';
const bounded = (value, min, max, fallback) =>
  value !== null && value !== '' && Number.isFinite(Number(value))
    ? Math.max(min, Math.min(max, Number(value))) : fallback;

// The saved library and shared URLs use the same light schema as the controls.
// Imported metadata never reaches the GPU or gets copied into another export.
const LIGHT_LIMITS = {
  ambient: [0, 2], bounce: [0, 2], key: [0, 350], rim: [0, 350],
  keyAz: [-180, 180], rimAz: [-180, 180],
  keyHeight: [1, 7], rimHeight: [1, 7],
  keyBeam: [10, 85], rimBeam: [10, 85], aimX: [-5, 5], aimY: [0, 6],
};
export function cleanLights(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const result = {};
  for (const [key, [min, max]] of Object.entries(LIGHT_LIMITS)) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value))
      result[key] = bounded(value, min, max, min);
  }
  for (const key of ['tint', 'keyColor', 'rimColor'])
    if (typeof input[key] === 'string' && /^#[0-9a-f]{6}$/i.test(input[key]))
      result[key] = input[key].toLowerCase();
  return result;
}

export function cleanLook(value, presets) {
  if (!value || typeof value !== 'object' || typeof value.name !== 'string') return null;
  const preset = presets.find((p) => p.id === value.fire);
  const name = value.name.trim().slice(0, 80);
  if (!preset || !name) return null;
  const result = {
    name,
    fire: preset.id,
    simulation: modeForFire(preset.id, value.simulation),
    lights: cleanLights(value.lights),
    fireLight: bounded(value.fireLight ?? 24, 0, 80, 24),
    room: value.room !== false,
    sourceGuide: value.sourceGuide !== false,
    smoke: !!value.smoke,
    fuel: ['wood', 'oil', 'gas'].includes(value.fuel) ? value.fuel : preset.fuel,
    color: FIRE_COLORS.some((c) => c.id === value.color) ? value.color : 'natural',
    embers: value.embers !== false,
  };
  if (value.camera && typeof value.camera === 'object' && !Array.isArray(value.camera)) {
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
      return items.map((item) => cleanLook(item, presets));
    },
    add(value) {
      if (items.length >= 40)
        throw new Error('Your library is full. Export or remove a look first.');
      const item = cleanLook(value, presets);
      if (!item) throw new Error('Give this look a name and select a fire source.');
      commit([...items, item]);
      return cleanLook(item, presets);
    },
    remove(index) {
      if (!Number.isInteger(index) || index < 0 || index >= items.length)
        throw new Error('This saved look is no longer in the library.');
      commit(items.filter((_, i) => i !== index));
    },
    import(data) {
      if (data?.version !== 1 || !Array.isArray(data.looks))
        throw new Error('Choose a CYBR preset library.');
      const valid = data.looks.map((v) => cleanLook(v, presets)).filter(Boolean);
      if (!valid.length) throw new Error('No valid looks found.');
      if (valid.length > 40 - items.length)
        throw new Error('Not enough library space. Remove saved looks before importing this file.');
      commit([...items, ...valid]);
      return valid.length;
    },
    export() {
      return { version: 1, looks: items.map((item) => cleanLook(item, presets)) };
    },
  };
}
