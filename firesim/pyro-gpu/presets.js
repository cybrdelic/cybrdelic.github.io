// Fixed-resolution simulation presets. Values change the source and physics,

// never the simulation grid or ray-march resolution.

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
      ? new URL('./source-previews/' + id + '.jpg?v=7a3bf1fa893730f2', import.meta.url).href
      : undefined,
  family: effect[0] >= 8 ? 'Sigils' : effect[0] >= 2 ? 'Shapes' : 'Fire',
  ...options,
});
export const sourceOrigin = (p) => [
  ...(p.source || [0, p.effect[3] > 0.5 ? (p.effect[0] === 4 ? 1 : 0.18) : 0.58, 0]),
];

const POWER_PRESETS = [
  // Powers use authored, bounded emission and momentum in the same live flow
  // as the ordinary fire sources. The shared IDs also map to Original below.
  preset(
    'radial-blast',
    'Radial blast',
    'Cast a finite outward burst. Flame tongues separate and roll into an expanding soot cloud.',
    'gas',
    [22, 1, .45, 0],
    [.65, .05, .75, .7],
    [1, 1, .8, .75],
    { family: 'Powers', power: 'radial-blast', source: [0, .65, 0], minHeight: .35 },
  ),
  preset(
    'fireball',
    'Fireball',
    'Launch a burning charge along an arc. Its flame wake keeps evolving after the charge burns out.',
    'gas',
    [23, 1, 1.15, 0],
    [.65, .05, .75, .7],
    [1, 1, .8, .75],
    { family: 'Powers', power: 'fireball', source: [-1.6, 1.1, 0], minHeight: .35 },
  ),
  preset(
    'fire-rain',
    'Fire rain',
    'Burning droplets fall in staggered lanes, feeding short flames close to the floor.',
    'oil',
    [24, 1, 0, 1],
    [.65, .05, .75, .7],
    [1, 1, .8, .75],
    { family: 'Powers', power: 'fire-rain', source: [0, .2, 0], minHeight: .2 },
  ),
  preset(
    'fire-tornado',
    'Fire tornado',
    'A rotating fuel column draws flame around its core and lifts soot into a twisting plume.',
    'gas',
    [25, 1, 0, 1],
    [.65, .05, 1.5, .7],
    [1, 1, .8, .75],
    { family: 'Powers', power: 'fire-tornado', source: [0, .2, 0], minHeight: .2 },
  ),
  preset(
    'floor-trail',
    'Fire floor trail',
    'A moving ignition front leaves a low winding trail. Each patch burns down as the front advances.',
    'oil',
    [26, 1, 0, 1],
    [.65, .05, .75, .7],
    [1, 1, .8, .75],
    { family: 'Powers', power: 'floor-trail', source: [0, .18, 0], minHeight: .18 },
  ),
  preset(
    'combustion-bomb',
    'Combustion bomb',
    'A charge gathers close to the floor, then erupts after a short fuse into flame and a rising smoke cloud.',
    'oil',
    [27, 1, 1.55, 0],
    [.65, .05, .75, .7],
    [1, 1, .8, .75],
    { family: 'Powers', power: 'combustion-bomb', source: [0, .28, 0], minHeight: .28 },
  ),
];

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
    {family:'Fire',object:'logs',source:[0,.45,0],minHeight:.45,preview:new URL('./objects/logs.jpg?v=7a3bf1fa893730f2',import.meta.url).href},
  ),

  preset(
    'bonfire',
    'Bonfire',
    'A broad wood flame with a compact burn and a separate rising soot plume.',
    'wood',
    [15, 1, 0, 1],
    [0.45, 0.12, 1.5, 0.55],
    [1.2, 1.15, 1.2, 1.6],
    {family:'Fire',object:'logs',source:[0,.64,0],minHeight:.64,preview:new URL('./objects/logs.jpg?v=7a3bf1fa893730f2',import.meta.url).href},
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
      preview: new URL('./objects/logs.jpg?v=7a3bf1fa893730f2', import.meta.url).href,
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
      preview: new URL('./objects/logs.jpg?v=7a3bf1fa893730f2', import.meta.url).href,
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
    { family:'Sigils',object:'wood-sigil',ignition:'all',source: [0, 1, 0], minHeight: 0.85,preview:new URL('./source-previews/sigil-cybr.jpg?v=7a3bf1fa893730f2',import.meta.url).href },
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
      preview: new URL('./source-previews/twin-jets.jpg?v=7a3bf1fa893730f2', import.meta.url).href,
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
      preview: new URL('./objects/house.jpg?v=7a3bf1fa893730f2', import.meta.url).href,
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
      preview: new URL('./objects/house.jpg?v=7a3bf1fa893730f2', import.meta.url).href,
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
      preview: new URL('./objects/car.jpg?v=7a3bf1fa893730f2', import.meta.url).href,
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
      preview: new URL('./objects/car.jpg?v=7a3bf1fa893730f2', import.meta.url).href,
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
      preview: new URL('./objects/mannequin.jpg?v=7a3bf1fa893730f2', import.meta.url).href,
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
      preview: new URL('./objects/forest-tree/preview.jpg?v=7a3bf1fa893730f2', import.meta.url).href,
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
      preview: new URL('./objects/forest-tree/preview.jpg?v=7a3bf1fa893730f2', import.meta.url).href,
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
      preview: new URL('./objects/forest-tree/preview.jpg?v=7a3bf1fa893730f2', import.meta.url).href,
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
      preview: new URL('./source-previews/sigil-cybr.jpg?v=7a3bf1fa893730f2', import.meta.url).href,
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
