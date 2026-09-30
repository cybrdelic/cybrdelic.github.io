// Shared links contain presentation state; QA parameters stay untouched.
import { cleanLights } from './look-storage.js?v=dd9ec2cce4c70695';

export function readLook(params, camera) {
  const look = {};
  for (const key of ['room', 'smoke', 'embers'])
    if (['0', '1'].includes(params.get(key))) look[key] = params.get(key) === '1';
  if (['wood', 'gas', 'oil'].includes(params.get('fuel'))) look.fuel = params.get('fuel');
  if (params.has('color')) look.color = params.get('color');
  const number = (key, min, max, fallback) => {
    const value = params.get(key);
    return value !== null && value.trim() !== '' && Number.isFinite(Number(value))
      ? Math.max(min, Math.min(max, Number(value))) : fallback;
  };
  if (params.has('fireLight')) look.fireLight = number('fireLight', 0, 80, 24);
  if (params.has('lights')) {
    try {
      const payload = params.get('lights');
      if (payload.length <= 2048) {
        const lights = cleanLights(JSON.parse(payload));
        if (Object.keys(lights).length) look.lights = lights;
      }
    } catch {}
  }
  if (['angle', 'zoom', 'panX', 'panY'].some((key) => params.has(key))) {
    look.camera = { ...camera };
    if (params.has('zoom')) look.camera.zoom = number('zoom', .7, 3, camera?.zoom ?? 1.25);
    if (params.has('angle')) look.camera.angle = number('angle', -75, 75, camera?.angle ?? 16);
    if (params.has('panX') || params.has('panY'))
      look.camera.pan = [number('panX', -5, 5, camera?.pan?.[0] ?? 0), number('panY', -5, 5, camera?.pan?.[1] ?? 0)];
  }
  return look;
}

export function writeLook(url, state) {
  const original = state.fire.startsWith('legacy:');
  url.searchParams.set('simulation', original ? 'legacy' : 'volume');
  url.searchParams.set(original ? 'preset' : 'firePreset', state.fire.replace(/^legacy:/, ''));
  url.searchParams.delete(original ? 'firePreset' : 'preset');
  url.searchParams.set('room', state.room ? '1' : '0');
  url.searchParams.set('fuel', state.fuel);
  for (const key of ['smoke', 'color', 'embers', 'fireLight']) {
    if ((original && key === 'embers') || state[key] === undefined) url.searchParams.delete(key);
    else url.searchParams.set(key, typeof state[key] === 'boolean' ? (state[key] ? '1' : '0') : state[key]);
  }
  if (state.camera) {
    const {zoom, angle, pan} = state.camera;
    for (const [key, value] of Object.entries({zoom, angle, panX: pan?.[0], panY: pan?.[1]})) {
      if (typeof value === 'number' && Number.isFinite(value)) url.searchParams.set(key, String(value));
      else url.searchParams.delete(key);
    }
  } else for (const key of ['zoom', 'angle', 'panX', 'panY']) url.searchParams.delete(key);
  const lights = cleanLights(state.lights);
  if (Object.keys(lights).length) url.searchParams.set('lights', JSON.stringify(lights));
  else url.searchParams.delete('lights');
  return url;
}
