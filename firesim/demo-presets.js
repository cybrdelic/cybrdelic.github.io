// Complete, repeatable starting views. Experiments stay available in the library.
export const DEMO_PRESETS = [
  {
    id: 'demo-sigil',
    name: 'CYBR signature',
    fire: 'legacy:sigil',
    description: 'The animated CYBR mark. Drag to take control of the flame.',
    lighting: 'fire',
    room: true,
    fuel: 'wood',
    color: 'natural',
    smoke: false,
    fireLight: 24,
    camera: { zoom: 1, angle: 16, pan: [0, 0] },
  },
  {
    id: 'demo-campfire',
    name: 'Campfire',
    fire: 'legacy:campfire',
    description: 'A compact wood fire. Move the source and watch its trail.',
    lighting: 'fire',
    room: true,
    fuel: 'wood',
    color: 'natural',
    smoke: false,
    fireLight: 24,
    camera: { zoom: 2.25, angle: 16, pan: [0, -1.39] },
  },
  {
    id: 'demo-torch',
    name: 'Torch',
    fire: 'legacy:torch',
    description: 'A narrow gas flame with a cool rim light.',
    lighting: 'cold',
    room: true,
    fuel: 'gas',
    color: 'natural',
    smoke: false,
    fireLight: 24,
    camera: { zoom: 2.25, angle: 16, pan: [0, -.65] },
  },
  {
    id: 'demo-ring',
    name: 'Fire ring',
    fire: 'legacy:ring',
    description: 'A sculpted ring of fire, framed against the dark room.',
    lighting: 'fire',
    room: true,
    fuel: 'wood',
    color: 'natural',
    smoke: false,
    fireLight: 24,
    camera: { zoom: 1.55, angle: 16, pan: [0, -.6] },
  },
  {
    id: 'demo-bonfire',
    name: 'Volume bonfire',
    fire: 'bonfire',
    description: 'A full 3D plume. Orbit to inspect flame and soot depth.',
    lighting: 'fire',
    room: true,
    fuel: 'wood',
    color: 'natural',
    smoke: false,
    embers: true,
    fireLight: 24,
    camera: { zoom: 1.25, angle: 16, pan: [0, 0] },
  },
  {
    id: 'demo-smoke',
    name: 'Smoke study',
    fire: 'smoke-pair',
    description: 'Two smoke jets in neutral light. Inspect transport without flame glare.',
    lighting: 'transport',
    room: true,
    fuel: 'oil',
    color: 'natural',
    fireLight: 24,
    embers: false,
    smoke: true,
    camera: { zoom: 1.25, angle: 16, pan: [0, 0] },
  },
];

export function isExperimental(preset) {
  const id = preset.id.replace(/^legacy:/, '');
  return (
    ['Objects', 'Prototypes', 'Looks'].includes(preset.family) ||
    ['explosion', 'oil-burst', 'flash', 'rolling', 'dense-burst'].includes(
      id,
    )
  );
}
