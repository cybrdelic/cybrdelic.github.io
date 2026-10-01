import { isExperimental } from './demo-presets.js?v=0d1cf64e7f96e456';
import { FIRE_PRESETS, LEGACY_PRESETS } from './pyro-gpu/presets.js?v=0d1cf64e7f96e456';

const FAMILIES = ['Fire', 'Powers', 'Shapes', 'Sigils', 'Jets', 'Smoke', 'Objects', 'Other'];
function familyFor(preset) {
  const key = preset.id.replace(/^legacy:/, '');
  if (key.includes('smoke')) return 'Smoke';
  if (key.startsWith('sigil')) return 'Sigils';
  if (FAMILIES.includes(preset.family)) return preset.family;
  if (key === 'wall') return 'Shapes';
  if (['free', 'campfire'].includes(key)) return 'Fire';
  return 'Other';
}

// Each engine has its own implementation of the shared source IDs. The menu
// stays on the selected simulation instead of silently switching engines.
export function sourceGroups(engine, includeExperiments = false, selected = '') {
  const groups = [];
  const catalog = engine === 'legacy' ? LEGACY_PRESETS : FIRE_PRESETS;
  for (const family of FAMILIES) {
    for (const experimental of [false, true]) {
      const items = catalog.filter((preset) =>
        familyFor(preset) === family &&
        isExperimental(preset) === experimental &&
        (!experimental || includeExperiments || preset.id.replace(/^legacy:/, '') === selected),
      );
      if (!items.length) continue;
      groups.push({
        label: family + (experimental ? ' · experimental' : ''),
        options: items.map((preset) => ({
          value: preset.id.replace(/^legacy:/, ''),
          name: preset.name,
        })),
      });
    }
  }
  return groups;
}

export function sourceSelection(engine, value) {
  return { kind: engine, key: value };
}
