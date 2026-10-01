// Fixed-resolution simulation presets. Values change the source and physics,

// never the simulation grid or ray-march resolution.

import { POWER_DEFINITIONS } from '../fire-power-definitions.js?v=7dfac6909b1f2622';

const preset = (id, name, description, fuel, effect, dynamics, chemistry, options = {}) => ({
  id,
  name,
  description,
  fuel,
  effect,
  dynamics,
  chemistry,
  preview:
    effect[0] >= 5 && effect[0] <= 12
      ? new URL('./source-previews/' + id + '.jpg?v=7dfac6909b1f2622', import.meta.url).href
      : undefined,
  family: effect[0] >= 8 ? 'Sigils' : effect[0] >= 2 ? 'Shapes' : 'Fire',
  ...options,
});
export const sourceOrigin = (p) => [
  ...(p.source || [0, p.effect[3] > 0.5 ? (p.effect[0] === 4 ? 1 : 0.18) : 0.58, 0]),
];

const CORE_POWER_PRESETS = [
  // Powers use authored, bounded emission and momentum in the same live flow
  // as the ordinary fire sources. The shared IDs also map to Original below.
  preset(
    'radial-blast',
    'Radial blast',
    'Cast a floor-level wave. Burning fuel spreads outward, rolls into separate flames and leaves drifting smoke.',
    'gas',
    [22, 1, .45, 0],
    [.65, .05, 1.1, .55],
    [.72, .65, .32, 1.2],
    { family: 'Powers', power: 'radial-blast', source: [0, .18, 0], minHeight: .12 },
  ),
  preset(
    'fireball',
    'Fireball',
    'Aim and launch a compact burning charge. Its trailing wake separates into fire and smoke after the launch ends.',
    'gas',
    [23, 1, 1.15, 0],
    [.65, .018, .8, .35],
    [.72, .70, .45, .9],
    { family: 'Powers', power: 'fireball', source: [-1.6, 1.1, 0], minHeight: .35 },
  ),
  preset(
    'fire-rain',
    'Fire rain',
    'Staggered falling fire packets cross the field. Their flame curls upward as the downward impulse fades.',
    'oil',
    [24, 1, 0, 1],
    [.65, .012, .7, .35],
    [.72, .60, .95, .85],
    { family: 'Powers', power: 'fire-rain', source: [0, .2, 0], minHeight: .2 },
  ),
  preset(
    'fire-tornado',
    'Fire tornado',
    'A driven rotating updraft pulls burning fuel into broken spirals and lifts smoke above the column.',
    'gas',
    [25, 1, 0, 1],
    [.65, .01, 1.5, .7],
    [.65, .62, .55, 1.25],
    { family: 'Powers', power: 'fire-tornado', source: [0, .2, 0], minHeight: .2 },
  ),
  preset(
    'floor-trail',
    'Fire floor trail',
    'Drag finite burning oil along the floor. Older patches burn down while the ignition front advances.',
    'oil',
    [26, 1, 0, 1],
    [.65, .008, .75, .65],
    [.68, .55, 1.1, .95],
    { family: 'Powers', power: 'floor-trail', source: [0, .18, 0], minHeight: .18 },
  ),
  preset(
    'combustion-bomb',
    'Combustion bomb',
    'Charge for 1.2 seconds, then release an outward blast with rolling flames and a heavier rising soot plume.',
    'oil',
    [27, 1, 1.55, 0],
    [.65, .075, 1.2, .85],
    [.75, .85, 1.3, 1.1],
    { family: 'Powers', power: 'combustion-bomb', source: [0, .28, 0], minHeight: .28 },
  ),
];

// Motion identity and timings come from the shared registry. These authored
// fuel/flow profiles remain separate from ordinary fire source presets.
function abilityPreset(id, description, fuel, dynamics, chemistry, group, source) {
  const definition = POWER_DEFINITIONS.find((power) => power.id === id);
  if (!definition) throw new Error('Missing authored power definition: ' + id);
  return preset(id, definition.name, description, fuel,
    [21 + definition.kind, 1, definition.duration, Number(definition.continuous)],
    dynamics, chemistry, {
      family: 'Powers', power: id, abilityGroup: group,
      source: source || [0, definition.floor ? .18 : 1.1, 0],
      minHeight: definition.floor ? .12 : .35,
    });
}

const CHOREOGRAPHED_POWER_PRESETS = [
  abilityPreset('flame-dash',
    'Gather at the floor, surge forward and brake into a flare. The burning wake keeps moving after the dash ends.',
    'oil', [.65, .018, 1.1, .45], [.72, .58, .85, 1.1], 'Movement', [-1.8, .18, 0]),
  abilityPreset('flame-whip',
    'Wind a burning curl, sweep it through an arc and crack the tip before it recoils into drifting flame.',
    'gas', [.65, .012, 1.15, .4], [.72, .60, .38, 1.2], 'Sweeps'),
  abilityPreset('ember-orbit',
    'Gather three burning satellites, tighten their orbit and release them in a staggered fan with separate wakes.',
    'gas', [.65, .012, 1.0, .4], [.72, .52, .35, 1.05], 'Projectiles', [-1.25, 1.1, 0]),
  abilityPreset('heat-seeker',
    'Charge a steering fireball, weave toward the cast aim and finish in an impact plume with a lingering wake.',
    'gas', [.65, .02, 1.1, .35], [.74, .62, .45, 1.1], 'Projectiles', [-1.8, 1.1, 0]),
  abilityPreset('phoenix-dive',
    'Open paired flame wings, climb into an arc and fold into a dive that spreads a ground flare and rising smoke.',
    'oil', [.65, .035, 1.2, .6], [.74, .65, .95, 1.15], 'Movement'),
  abilityPreset('dragon-breath',
    'Gather a short charge, then drive overlapping pulses through a broad flame cone. Stop casting leaves its turbulent wake.',
    'gas', [.65, .025, 1.4, .4], [.75, .68, .45, 1.35], 'Directed', [-1.8, 1.05, 0]),
  abilityPreset('solar-lance',
    'Build a concentrated tip, launch a narrow fast lance and break it into a terminal flare and lingering wake.',
    'gas', [.65, .015, .85, .25], [.80, .58, .28, .85], 'Directed', [-1.8, 1.1, 0]),
  abilityPreset('flame-wall',
    'Light a floor seam, raise flame panels in sequence and let the irregular crest collapse into soot.',
    'oil', [.65, .02, 1.05, .7], [.72, .55, 1.05, 1.15], 'Terrain'),
  abilityPreset('inferno-ring',
    'Raise an uneven flame barrier, rotate its inward pulses and let the ring break into transported smoke.',
    'gas', [.65, .02, 1.25, .6], [.72, .56, .55, 1.2], 'Terrain'),
  abilityPreset('meteor-strike',
    'Mark a floor cast, release one burning meteor above it and strike through a curved descent with a rolling flame front.',
    'oil', [.65, .065, 1.2, .85], [.76, .75, 1.3, 1.15], 'Impacts'),
  abilityPreset('meteor-barrage',
    'Send a staggered set of meteors through separate arcs. Successive impacts merge their fire and soot plumes.',
    'oil', [.65, .05, 1.15, .8], [.74, .50, 1.2, 1.1], 'Impacts'),
  abilityPreset('eruption-chain',
    'Advance a warning along the floor, then fire ordered geysers through a zigzag before the columns decay.',
    'oil', [.65, .045, 1.25, 1.0], [.74, .58, 1.15, 1.25], 'Terrain', [-1.8, .18, 0]),
  abilityPreset('combustion-mine',
    'Plant a quiet floor charge that waits before detonating into a short flame blast and a heavy soot cloud.',
    'oil', [.65, .065, 1.2, .8], [.74, .72, 1.3, 1.15], 'Impacts'),
  abilityPreset('vortex-burst',
    'Draw burning gas inward, tighten a helical gather and reverse it into an outward blast with a rolling wake.',
    'gas', [.65, .04, 1.5, .65], [.72, .62, .65, 1.3], 'Impacts'),
  abilityPreset('flame-serpent',
    'Launch a moving flame head through an S-curve. The transported body follows, separates and extinguishes behind it.',
    'gas', [.65, .018, 1.15, .4], [.73, .58, .5, 1.2], 'Projectiles', [-1.8, 1.1, 0]),
  abilityPreset('cinder-scatter',
    'Charge a cluster, release a diverging cone of burning packets and follow their separate local impact flares.',
    'oil', [.65, .035, 1.05, .4], [.74, .48, .9, 1.1], 'Projectiles', [-1.8, 1.1, 0]),
  abilityPreset('fire-cross',
    'Sweep one burning floor line, cross it with a second and flare at the intersection before both wakes decay.',
    'oil', [.65, .025, 1.1, .55], [.72, .58, 1.0, 1.15], 'Terrain'),
  abilityPreset('flame-crescent',
    'Release a curved flame blade, hook it back through the field and open the returning arc into a fading wake.',
    'gas', [.65, .018, 1.15, .4], [.73, .58, .45, 1.2], 'Sweeps'),
];

const POWER_PRESETS = [...CORE_POWER_PRESETS, ...CHOREOGRAPHED_POWER_PRESETS].map((source) => {
  const definition = POWER_DEFINITIONS.find((power) => power.id === source.power);
  if (!definition) throw new Error('Missing power identity: ' + source.power);
  const groups = { ground: 'Ground', projectile: 'Projectiles', field: 'Fields', trail: 'Terrain', aim: 'Directed' };
  return { ...source, abilityGroup: source.abilityGroup || groups[definition.targetMode],
    effect: [21 + definition.kind, source.effect[1], definition.duration, Number(definition.continuous)] };
});

export const FIRE_PRESETS = [
  preset(
    'explosion',
    'Classic burst',
    'A finite charge with rolling flame and drifting soot.',
    'wood',
    [0, 1, 0.085, 0],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ),

  ...POWER_PRESETS,

  preset(
    'oil-burst',
    'Oil fireball',
    'More soot, a longer burn and a heavier rising plume.',
    'oil',
    [0, 1.1, 0.11, 0],
    [0.95, 1.1, 1, 0.8],
    [1.05, 1.4, 1.2, 0.8],
  ),

  preset(
    'flash',
    'Flash burst',
    'A compact, hot charge that extinguishes quickly.',
    'gas',
    [0, 0.7, 0.045, 0],
    [1.2, 1.1, 0.7, 0.8],
    [1.4, 0.4, 0.25, 1.2],
  ),

  preset(
    'rolling',
    'Rolling burst',
    'Broad release with stronger rotational motion.',
    'wood',
    [0, 1.2, 0.12, 0],
    [0.75, 0.8, 2, 0.7],
    [1, 1.5, 1, 1.5],
  ),

  preset(
    'smoke-burst',
    'Smoke burst',
    'Smoke only, for inspecting expansion and vortices.',
    'oil',
    [0, 1, 0.085, 0],
    [1, 1, 1, 1],
    [0.9, 1, 1.5, 1],
  ),

  preset(
    'hearth',
    'Hearth flame',
    'A small stack of finite wood fuel with gentle lift.',
    'wood',
    [15, .7, 0, 1],
    [0.3, 0.08, 0.5, 0.65],
    [1, 1, 1, 0.65],
    {family:'Fire',object:'logs',source:[0,.45,0],minHeight:.45,preview:new URL('./objects/logs.jpg?v=7dfac6909b1f2622',import.meta.url).href},
  ),

  preset(
    'bonfire',
    'Bonfire',
    'A broad wood flame with a compact burn and a separate rising soot plume.',
    'wood',
    [15, 1, 0, 1],
    [0.45, 0.12, 1.5, 0.55],
    [1.2, 1.15, 1.2, 1.6],
    {family:'Fire',object:'logs',source:[0,.64,0],minHeight:.64,preview:new URL('./objects/logs.jpg?v=7dfac6909b1f2622',import.meta.url).href},
  ),

  preset(
    'log-hearth',
    'Wood hearth',
    'A smaller stack of finite wood fuel with gentle lift.',
    'wood',
    [15, 0.7, 0, 1],
    [0.45, 0.012, 0.3, 0.7],
    [0.95, 0.85, 1, 0.7],
    {
      family: 'Objects',
      object: 'logs',
      source: [0, 0.45, 0],
      minHeight: 0.45,
      preview: new URL('./objects/logs.jpg?v=7dfac6909b1f2622', import.meta.url).href,
    },
  ),

  preset(
    'burning-logs',
    'Wood bonfire',
    'Cross-stacked logs heat up, release finite wood fuel and char. Flame and soot evolve in the surrounding flow.',
    'wood',
    [15, 1, 0, 1],
    [0.65, 0.018, 0.5, 1],
    [1, 1, 1.1, 1],
    {
      family: 'Objects',
      object: 'logs',
      source: [0, 0.64, 0],
      minHeight: 0.64,
      preview: new URL('./objects/logs.jpg?v=7dfac6909b1f2622', import.meta.url).href,
    },
  ),

  preset(
    'torch',
    'Torch jet',
    'A narrow, fast continuous jet of cleaner fuel.',
    'gas',
    [1, 0.45, 0, 1],
    [1.5, 0.04, 0.4, 0.6],
    [1.35, 0.65, 0.15, 1],
  ),

  preset(
    'sooty-plume',
    'Sooty plume',
    'Slow heavy combustion and thick persistent smoke.',
    'oil',
    [1, 1.1, 0, 1],
    [0.35, 0.05, 0.6, 0.8],
    [0.9, 1.2, 1.7, 0.6],
  ),

  preset(
    'ring',
    'Fire ring',
    'Fuel rises from a horizontal ring.',
    'wood',
    [2, 1.1, 0, 1],
    [0.5, 0.06, 1.6, 1],
    [1, 1, 1, 1.2],
  ),

  preset(
    'curtain',
    'Fire curtain',
    'A broad line of fuel feeding a vertical sheet.',
    'wood',
    [3, 1.1, 0, 1],
    [0.6, 0.07, 0.6, 1],
    [1.1, 1, 1, 1.1],
  ),

  preset(
    'sphere',
    'Burning shell',
    'A spherical fuel shell with outward and swirling flow.',
    'gas',
    [4, 1, 0, 1],
    [0.3, 0.04, 2, 0.4],
    [1, 0.75, 0.35, 1],
  ),
  preset(
    'smoke-column',
    'Smoke column',
    'A continuous soot source for inspecting advection and lighting.',
    'oil',
    [1, 0.9, 0, 1],
    [0.32, 0.03, 0.5, 0.6],
    [0.7, 1, 1.2, 0.6],
    { smokeSimulation: true },
  ),
  preset(
    'cube',
    'Cube shell',
    'Fuel emitted from six faces; flame and soot then move freely.',
    'wood',
    [5, 1, 0, 1],
    [0.24, 0.025, 0.6, 0.65],
    [1, 1, 0.8, 0.9],
    { source: [0, 0.85, 0], minHeight: 0.7 },
  ),
  preset(
    'helix',
    'Fire helix',
    'An upright coil of fuel with two turns.',
    'gas',
    [6, 1, 0, 1],
    [0.28, 0.025, 0.8, 0.65],
    [1, 0.9, 0.3, 1],
    { source: [0, 1, 0], minHeight: 0.85 },
  ),
  preset(
    'twin-jets',
    'Twin jets',
    'Two separated burners feeding independent plumes.',
    'gas',
    [7, 1.4, 0, 1],
    [0.85, 0.025, 0.35, 0.7],
    [1.2, 0.8, 0.3, 0.9],
  ),
  preset(
    'sigil-triangle',
    'Triangle sigil',
    'A triangular fuel stroke inside a circular seal.',
    'wood',
    [8, 1.15, 0, 1],
    [0.18, 0.018, 0.3, 0.55],
    [1, 0.9, 0.75, 0.7],
    { source: [0, 1.15, 0], minHeight: 1.05 },
  ),
  preset(
    'sigil-star',
    'Pentagram sigil',
    'Five crossing fuel strokes inside a circular seal.',
    'wood',
    [9, 1.15, 0, 1],
    [0.18, 0.018, 0.3, 0.55],
    [1, 0.9, 0.75, 0.7],
    { source: [0, 1.15, 0], minHeight: 1.05 },
  ),
  preset(
    'sigil-cybr',
    'CYBR sigil',
    'The approved CYBR artwork cut from finite wood. Heat dries, chars and weakens the strokes.',
    'wood',
    [15, 1.8, 0, 1],
    [0.16, 0.018, 0.25, 0.55],
    [1, 0.9, 0.75, 0.75],
    { family:'Sigils',object:'wood-sigil',ignition:'all',source: [0, 1, 0], minHeight: 0.85,preview:new URL('./source-previews/sigil-cybr.jpg?v=7dfac6909b1f2622',import.meta.url).href },
  ),
  preset(
    'sigil-rune',
    'Forked rune',
    'A branched vertical fuel stroke with a diamond seal.',
    'wood',
    [11, 1.1, 0, 1],
    [0.18, 0.018, 0.3, 0.55],
    [1, 0.9, 0.75, 0.7],
    { source: [0, 1.1, 0], minHeight: 0.95 },
  ),
  preset(
    'halo',
    'Upright halo',
    'A vertical circular burner with flames rising from its rim.',
    'gas',
    [12, 1.1, 0, 1],
    [0.22, 0.02, 0.4, 0.6],
    [1, 0.9, 0.3, 0.8],
    { family: 'Shapes', source: [0, 1, 0], minHeight: 0.85 },
  ),
  // Stress sources retain the same grids, render settings and shared velocity.
  preset(
    'smoky-jet',
    'Smoky jet',
    'A fast oil-fed jet: follow soot along the rising flame, then stop fuel.',
    'oil',
    [1, 0.75, 0, 1],
    [1.15, 0.035, 0.6, 0.8],
    [1.15, 1, 1.35, 0.85],
    { family: 'Fire' },
  ),
  preset(
    'colliding-jets',
    'Colliding jets',
    'Two inward-facing nozzles meet in a rolling plume.',
    'wood',
    [13, 1.2, 0, 1],
    [0.65, 0.025, 0.4, 0.8],
    [1.1, 1, 1.1, 0.8],
    { family: 'Shapes', source: [0, 0.5, 0], minHeight: 0.3 },
  ),
  preset(
    'fuel-bed',
    'Broad fuel bed',
    'A square pool source produces a wide flame and smoke sheet.',
    'oil',
    [14, 1, 0, 1],
    [0.22, 0.035, 0.45, 0.8],
    [1.05, 1.1, 1.4, 0.7],
    { family: 'Shapes' },
  ),
  preset(
    'smoke-pair',
    'Paired smoke jets',
    'Two smoke-only jets reveal transport and merging without flame glare.',
    'oil',
    [7, 1.4, 0, 1],
    [0.6, 0.02, 0.35, 0.65],
    [0.8, 1, 1.2, 0.75],
    {
      smokeSimulation: true,
      preview: new URL('./source-previews/twin-jets.jpg?v=7dfac6909b1f2622', import.meta.url).href,
    },
  ),
  preset(
    'thin-curtain',
    'Thin flame curtain',
    'A narrow fuel sheet exposes aliasing, gaps and thin smoke edges.',
    'wood',
    [3, 1.7, 0, 1],
    [0.45, 0.018, 0.35, 0.75],
    [1.15, 0.85, 1, 0.7],
    { family: 'Shapes' },
  ),
  preset(
    'dense-burst',
    'Dense smoke burst',
    'A finite soot-heavy charge for shadowing and extinction checks.',
    'oil',
    [0, 1.35, 0.1, 0],
    [0.8, 0.85, 1.4, 0.85],
    [1, 1.2, 1.65, 0.8],
  ),

  preset(
    'burning-house',
    'Timber house',
    'A hollow cabin: localized ignition, finite wood fuel, open windows and an inert chimney.',
    'wood',
    [15, 1, 0, 1],
    [0.8, 0.018, 0.45, 0.85],
    [1, 1, 1.1, 0.85],
    {
      family: 'Objects',
      object: 'house',
      source: [0, 1.34, 0],
      minHeight: 1.34,
      preview: new URL('./objects/house.jpg?v=7dfac6909b1f2622', import.meta.url).href,
    },
  ),
  preset(
    'house-inferno',
    'House inferno',
    'Ignite the entire timber surface; compare connected plumes and soot emerging from openings.',
    'wood',
    [15, 1, 0, 1],
    [0.8, 0.025, 0.7, 0.9],
    [1.05, 1.2, 1.2, 1],
    {
      family: 'Objects',
      object: 'house',
      ignition: 'all',
      source: [0, 1.34, 0],
      minHeight: 1.34,
      preview: new URL('./objects/house.jpg?v=7dfac6909b1f2622', import.meta.url).href,
    },
  ),
  preset(
    'burning-car',
    'Vehicle fire',
    'Metal body with burning engine contents, tyres and upholstery. The metal supplies no fuel.',
    'oil',
    [16, 1, 0, 1],
    [0.7, 0.018, 0.35, 0.85],
    [1.05, 1, 1.3, 0.8],
    {
      family: 'Objects',
      object: 'car',
      source: [0, 1.34, 0],
      minHeight: 1.34,
      preview: new URL('./objects/car.jpg?v=7dfac6909b1f2622', import.meta.url).href,
    },
  ),
  preset(
    'car-inferno',
    'Vehicle fully involved',
    'Ignite all combustible vehicle parts and inspect dense smoke around the metal body.',
    'oil',
    [16, 1, 0, 1],
    [0.7, 0.025, 0.55, 0.8],
    [1, 1.15, 1.5, 1],
    {
      family: 'Objects',
      object: 'car',
      ignition: 'all',
      source: [0, 1.34, 0],
      minHeight: 1.34,
      preview: new URL('./objects/car.jpg?v=7dfac6909b1f2622', import.meta.url).href,
    },
  ),
  preset(
    'burning-mannequin',
    'Burning mannequin',
    'A non-graphic human-shaped test dummy with a finite combustible coating.',
    'wood',
    [17, 1, 0, 1],
    [0.65, 0.012, 0.3, 0.85],
    [1, 1, 0.85, 0.8],
    {
      family: 'Objects',
      object: 'mannequin',
      ignition: 'all',
      source: [0, 1.34, 0],
      minHeight: 1.34,
      preview: new URL('./objects/mannequin.jpg?v=7dfac6909b1f2622', import.meta.url).href,
    },
  ),
  preset(
    'cybr-tree',
    'Forest tree · basal ignition',
    'Reviewed forest-surface tree 538. Heat dries finite wood and leaf fuel; char insulates it and weakened branches detach.',
    'wood',
    [18, 1, 0, 1],
    [0.7, 0.018, 0.55, 0.9],
    [1.05, 1, 1.1, 1],
    {
      family: 'Objects',
      object: 'cybr-tree',
      source: [0, 1.35, 0],
      minHeight: 1.35,
      preview: new URL('./objects/forest-tree/preview.jpg?v=7dfac6909b1f2622', import.meta.url).href,
    },
  ),
  preset(
    'damp-tree',
    'Forest tree · damp fuel',
    'The same mesh, starter and flow as basal ignition, with more stored moisture. Compare delayed drying and ignition.',
    'wood',
    [18, 1, 0, 1],
    [0.7, 0.018, 0.55, 0.9],
    [1.05, 1, 1.1, 1],
    {
      family: 'Objects',
      object: 'cybr-tree',
      moisture: 'damp',
      source: [0, 1.35, 0],
      minHeight: 1.35,
      preview: new URL('./objects/forest-tree/preview.jpg?v=7dfac6909b1f2622', import.meta.url).href,
    },
  ),
  preset(
    'crown-fire',
    'Forest tree · crown ignition',
    'One localized crown starter heats actual leaf and twig fuel. The entire tree is not ignited at once.',
    'wood',
    [18, 1, 0, 1],
    [0.7, 0.018, 0.55, 0.9],
    [1.05, 1, 1.1, 1],
    {
      family: 'Objects',
      object: 'cybr-tree',
      ignition: 'crown',
      source: [0, 1.35, 0],
      minHeight: 1.35,
      preview: new URL('./objects/forest-tree/preview.jpg?v=7dfac6909b1f2622', import.meta.url).href,
    },
  ),
  preset(
    'flamethrower',
    'Flamethrower',
    'A sustained horizontal fuel jet with directional momentum, lift and downstream combustion.',
    'oil',
    [19, 1, 0, 1],
    [0.9, 0.025, 0.4, 0.6],
    [1.15, 1.8, 1.1, 0.9],
    { family: 'Jets', source: [-1.6, 1.05, 0], minHeight: 0.3 },
  ),
  preset(
    'sweeping-jet',
    'Sweeping flamethrower',
    'The nozzle sweeps in 3D; the released fuel and soot keep their momentum.',
    'oil',
    [20, 1, 0, 1],
    [0.85, 0.025, 0.45, 0.65],
    [1.15, 1.6, 1.1, 1],
    { family: 'Jets', source: [-1.6, 1.05, 0], minHeight: 0.3 },
  ),
  preset(
    'fire-spit',
    'Fire spit',
    'Short repeating fuel pulses from a moving nozzle; detached puffs burn and extinguish in the flow.',
    'oil',
    [21, 1, 0, 1],
    [1.05, 0.07, 0.5, 0.65],
    [1.2, 1.8, 1.15, 1.1],
    { family: 'Jets', source: [-1.5, 1.05, 0], minHeight: 0.3 },
  ),
  preset(
    'blue-jet',
    'Cobalt jet',
    'A clean sweeping jet with an explicitly stylized blue emission look.',
    'gas',
    [20, 0.8, 0, 1],
    [0.9, 0.018, 0.35, 0.6],
    [1.2, 1.5, 0.3, 0.8],
    { family: 'Jets', color: 'cobalt', source: [-1.5, 1.1, 0], minHeight: 0.3 },
  ),
  preset(
    'dragon-spit',
    'Emerald spit',
    'Sooty pulsed fuel with an emerald color look; its smoke and room light follow that emission.',
    'oil',
    [21, 1.1, 0, 1],
    [1, 0.08, 0.6, 0.7],
    [1.15, 1.25, 1.1, 1],
    { family: 'Jets', color: 'emerald', source: [-1.5, 1.1, 0], minHeight: 0.3 },
  ),
  preset(
    'violet-sigil',
    'Violet CYBR',
    'The extruded CYBR fuel source with violet flame and matching illumination.',
    'wood',
    [15, 1.8, 0, 1],
    [0.16, 0.018, 0.25, 0.55],
    [1, 0.9, 0.75, 0.75],
    {
      family: 'Sigils',
      object:'wood-sigil',
      ignition:'all',
      color: 'violet',
      source: [0, 1, 0],
      minHeight: 0.85,
      preview: new URL('./source-previews/sigil-cybr.jpg?v=7dfac6909b1f2622', import.meta.url).href,
    },
  ),
];

// Keep older URLs and saved looks working; unreviewed blockout geometry and
// color-only variants are explicitly separated from the main source studies.
for (const p of FIRE_PRESETS) {
  if (['house', 'car', 'mannequin', 'logs'].includes(p.object)&&!['bonfire','hearth'].includes(p.id)) {
    p.family = 'Prototypes';
    p.name += ' · blockout';
  }
  if (p.color) {
    p.family = 'Looks';
  }
}
export const SCENES = [
  {
    id: 'tree-dry',
    name: '01 \u00b7 Basal ignition',
    description:
      'Heat starts at the base. Unheated wood must stay intact; drying precedes local fuel release. Inspect the original bark fissures as the surface chars.',
    fire: 'cybr-tree',
    lighting: 'bark-rake',
    fireLight: 16,
    room: true,
    camera: {
      zoom: 1.6,
      angle: 16,
      pan: [0, -0.55],
    },
    test: {
      instruction:
        'Heat starts at the base. Unheated wood must stay intact; drying precedes local fuel release. Inspect the original bark fissures as the surface chars.',
    },
  },
  {
    id: 'tree-wet',
    name: '02 \u00b7 Moisture comparison',
    description:
      'Same tree, camera, starter and fuel chemistry as Basal ignition. Extra moisture absorbs heat and delays pyrolysis; it must not simply recolor the flame.',
    fire: 'damp-tree',
    lighting: 'bark-rake',
    fireLight: 16,
    room: true,
    camera: {
      zoom: 1.6,
      angle: 16,
      pan: [0, -0.55],
    },
    test: {
      instruction:
        'Same tree, camera, starter and fuel chemistry as Basal ignition. Extra moisture absorbs heat and delays pyrolysis; it must not simply recolor the flame.',
    },
  },
  {
    id: 'tree-crown',
    name: '03 \u00b7 Crown ignition',
    description:
      'A small crown patch is ignited. Individual leaves dry, darken and lose area as their fuel is consumed. Watch for flame spreading through nearby hot fuel.',
    fire: 'crown-fire',
    lighting: 'canopy-back',
    fireLight: 16,
    room: true,
    camera: {
      zoom: 1.6,
      angle: 16,
      pan: [0, -0.55],
    },
    test: {
      instruction:
        'A small crown patch is ignited. Individual leaves dry, darken and lose area as their fuel is consumed. Watch for flame spreading through nearby hot fuel.',
    },
  },
  {
    id: 'tree-material',
    name: '04 \u00b7 Bark and char',
    description:
      'Neutral white light exposes the bark, roots and char color. Pause, zoom into the trunk, and orbit; the source uses the reviewed displaced mesh, not a voxel silhouette.',
    fire: 'cybr-tree',
    lighting: 'material-white',
    fireLight: 5,
    room: true,
    camera: {
      zoom: 1.6,
      angle: 60,
      pan: [0, -0.55],
    },
    test: {
      instruction:
        'Neutral white light exposes the bark, roots and char color. Pause, zoom into the trunk, and orbit; the source uses the reviewed displaced mesh, not a voxel silhouette.',
    },
  },
  {
    id: 'tree-relief',
    name: '05 \u00b7 Opposite grazing light',
    description:
      'Compare this against Basal ignition. The same raised bark and opened fissures must respond to the opposite light direction.',
    fire: 'cybr-tree',
    lighting: 'bark-rake-reverse',
    fireLight: 16,
    room: true,
    camera: {
      zoom: 1.6,
      angle: 16,
      pan: [0, -0.55],
    },
    test: {
      instruction:
        'Compare this against Basal ignition. The same raised bark and opened fissures must respond to the opposite light direction.',
    },
  },
  {
    id: 'test-transport',
    name: '06 \u00b7 Smoke after shutoff',
    description:
      'Fuel stops at 3 s. Existing soot must keep moving with the flow instead of vanishing. Inspect smoke hides emission only.',
    fire: 'smoky-jet',
    lighting: 'transport',
    fireLight: 12,
    room: true,
    camera: {
      zoom: 1.6,
      angle: 16,
      pan: [0, -0.55],
    },
    test: {
      instruction:
        'Fuel stops at 3 s. Existing soot must keep moving with the flow instead of vanishing. Inspect smoke hides emission only.',
      stopAfter: 3,
    },
  },
  {
    id: 'test-shadow',
    name: '07 \u00b7 Extinction and shadows',
    description:
      'A narrow neutral spotlight exposes volume self-shadowing and floor shadows. Pause and inspect several angles; check for halos and light leaking through dense soot.',
    fire: 'dense-burst',
    lighting: 'shadow',
    fireLight: 8,
    room: true,
    camera: {
      zoom: 1.6,
      angle: -35,
      pan: [0, -0.55],
    },
    test: {
      instruction:
        'A narrow neutral spotlight exposes volume self-shadowing and floor shadows. Pause and inspect several angles; check for halos and light leaking through dense soot.',
    },
  },
  {
    id: 'test-emission',
    name: '08 \u00b7 Fire light only',
    description:
      'All external light and bounce are disabled. The flame supplies room illumination. Hot char remains visible while it cools; a cold scene must become dark.',
    fire: 'cybr-tree',
    lighting: 'fire',
    fireLight: 24,
    room: true,
    camera: {
      zoom: 1.6,
      angle: 16,
      pan: [0, -0.55],
    },
    test: {
      instruction:
        'All external light and bounce are disabled. The flame supplies room illumination. Hot char remains visible while it cools; a cold scene must become dark.',
    },
  },
  {
    id: 'test-bounce',
    name: '09 \u00b7 Room bounce',
    description:
      'Compare with Fire light only. Direct lighting is identical; only approximate room bounce is enabled. Watch for illumination crossing opaque walls or filling every cavity equally.',
    fire: 'cybr-tree',
    lighting: 'bounce-check',
    fireLight: 24,
    room: true,
    camera: {
      zoom: 1.6,
      angle: 16,
      pan: [0, -0.55],
    },
    test: {
      instruction:
        'Compare with Fire light only. Direct lighting is identical; only approximate room bounce is enabled. Watch for illumination crossing opaque walls or filling every cavity equally.',
    },
  },
  {
    id: 'test-pulses',
    name: '10 \u00b7 Detached fuel pulses',
    description:
      'During each nozzle pause, fuel and soot retain their velocity. Puffs must detach, mix and extinguish without a reset.',
    fire: 'fire-spit',
    lighting: 'transport',
    fireLight: 16,
    room: true,
    camera: {
      zoom: 1.6,
      angle: 0,
      pan: [0, -0.55],
    },
    test: {
      instruction:
        'During each nozzle pause, fuel and soot retain their velocity. Puffs must detach, mix and extinguish without a reset.',
    },
  },
  {
    id: 'test-sigil',
    name: '11 \u00b7 Sigil depth',
    description:
      'View the CYBR fuel stroke almost edge-on. Orbit and drag it; the released plume must remain in the old flow, with no camera-facing card.',
    fire: 'sigil-cybr',
    lighting: 'cross',
    fireLight: 16,
    room: true,
    camera: {
      zoom: 1.6,
      angle: 65,
      pan: [0, -0.55],
    },
    test: {
      instruction:
        'View the CYBR fuel stroke almost edge-on. Orbit and drag it; the released plume must remain in the old flow, with no camera-facing card.',
    },
  },
  {
    id: 'test-smoke',
    name: '12 \u00b7 Smoke without emission',
    description:
      'Two soot-only feeds merge, then stop at 3 s. Judge rolling motion, density continuity and light transmission without flame glare.',
    fire: 'smoke-pair',
    lighting: 'transport',
    fireLight: 0,
    room: true,
    camera: {
      zoom: 1.6,
      angle: -35,
      pan: [0, -0.55],
    },
    test: {
      instruction:
        'Two soot-only feeds merge, then stop at 3 s. Judge rolling motion, density continuity and light transmission without flame glare.',
      stopAfter: 3,
    },
  },
  {
    id: 'forest-fire',
    name: 'Forest tree \u00b7 local ignition',
    description: 'A complete source and lighting setup. Use Tests for controlled comparisons.',
    fire: 'cybr-tree',
    lighting: 'material-white',
    fireLight: 18,
    room: true,
  },
  {
    id: 'crown-study',
    name: 'Forest crown \u00b7 local ignition',
    description: 'A complete source and lighting setup. Use Tests for controlled comparisons.',
    fire: 'crown-fire',
    lighting: 'canopy-back',
    fireLight: 18,
    room: true,
  },
  {
    id: 'chamber',
    name: 'Oil burst \u00b7 fire-lit room',
    description: 'A complete source and lighting setup. Use Tests for controlled comparisons.',
    fire: 'oil-burst',
    lighting: 'fire',
    fireLight: 18,
    room: true,
  },
];

const ORIGINAL_ONLY = [
  ['sigil', 'Cybrdelic sigil', 'The animated CYBR fuel mark.'],
  ['free', 'Free fire', 'Place a live fuel source anywhere.'],
  ['campfire', 'Campfire', 'Three wood flame tongues above crossed logs.'],
  ['wall', 'Fire wall', 'A broad line of fuel forming a curtain.'],
].map(([key, name, description]) => ({
  id: 'legacy:' + key,
  name,
  description: 'Original simulation · ' + description,
  fuel: 'wood',
}));

// Both solvers expose the same authored source IDs. Original interprets their
// source geometry and fuel parameters on its own grid and renderer.
const originalDescription = (source) => {
  if (source.object === 'cybr-tree')
    return 'Reviewed tree geometry with finite projected wood, drying, charring and load-driven branch failure. The flame and soot use Original’s layered flow.';
  const objects = {
    logs: 'Solid logs with bark, end grain, finite fuel and load-driven fracture. Flame and soot evolve in the surrounding layered flow.',
    house: 'Finite timber with heat-driven conversion and structural failure. Falling pieces retain their wood grain.',
    car: 'Static vehicle fuel shape with finite release from combustible regions and advected flame and soot.',
    mannequin: 'Static human-shaped test dummy with a finite combustible surface coating and advected flame and soot.',
  };
  return objects[source.object] || source.description;
};
export const LEGACY_PRESETS = [
  ...ORIGINAL_ONLY,
  ...FIRE_PRESETS.map((source) => ({
    ...source,
    id: 'legacy:' + source.id,
    description: 'Original simulation · ' + originalDescription(source),
  })),
];

export const ALL_FIRE_PRESETS = [
  ...LEGACY_PRESETS,
  ...FIRE_PRESETS.map((p) => ({ ...p, description: '3D simulation · ' + p.description })),
];
