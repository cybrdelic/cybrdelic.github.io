// Load only the selected engine. The studio shell and library need neither GPU runtime.
const scripts = new Map();
const legacyScripts = [
  'coarse-pressure.js',
  'corrected-advection.js',
  'vorticity.js',
  'fire-optics.js',
  'smoke-light.js',
  'fire-room.js',
  'fire-emitters.js',
  'fire-props.js',
];

function loadScript(file) {
  if (!scripts.has(file)) {
    scripts.set(
      file,
      new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = new URL(file + '?v=86e0ab5a0c6c5992', import.meta.url).href;
        script.onload = resolve;
        script.onerror = () => {
          scripts.delete(file);
          script.remove();
          reject(new Error('Could not load ' + file + '. Check the connection and try again.'));
        };
        document.head.append(script);
      }),
    );
  }
  return scripts.get(file);
}

export async function loadRuntime(kind) {
  if (kind === 'volume') return (await import('./pyro-gpu/app.js?v=86e0ab5a0c6c5992')).mountVolume;
  await Promise.all(legacyScripts.map(loadScript));
  return (await import('./fire.js?v=86e0ab5a0c6c5992')).mountLegacy;
}
