// Shared links contain presentation state; QA parameters stay untouched.
import { cleanLights } from './look-storage.js?v=46ff16af6f281449';
import { modeForFire } from './simulation-modes.js?v=46ff16af6f281449';
import { normalizePowerSettings } from './fire-powers.js?v=46ff16af6f281449';

export function readLook(params, camera) {
  const look = {};
  if(['0','1'].includes(params.get('guide')))look.sourceGuide=params.get('guide')==='1';
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
  if (params.has('woodTimeScale')) look.woodTimeScale = number('woodTimeScale', 1, 24, 12);
  if (['powerStrength','powerHeading','powerElevation'].some(key=>params.has(key)))
    look.powers=normalizePowerSettings({strength:number('powerStrength',.25,2,1),heading:number('powerHeading',-180,180,0),elevation:number('powerElevation',-30,80,9)});
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
  url.searchParams.set('simulation', modeForFire(state.fire, state.simulation));
  // Old brick URLs are accepted on entry; the share link uses one mode key.
  url.searchParams.delete('bricks');
  url.searchParams.set(original ? 'preset' : 'firePreset', state.fire.replace(/^legacy:/, ''));
  url.searchParams.delete(original ? 'firePreset' : 'preset');
  url.searchParams.set('room', state.room ? '1' : '0');
  url.searchParams.set('fuel', state.fuel);
  if (state.woodTimeScale !== undefined) url.searchParams.set('woodTimeScale', String(state.woodTimeScale));
  const powers=state.powers ? normalizePowerSettings(state.powers) : null;
  for(const [parameter,key] of [['powerStrength','strength'],['powerHeading','heading'],['powerElevation','elevation']]) {
    if(powers)url.searchParams.set(parameter,String(powers[key]));else url.searchParams.delete(parameter);
  }
  if(state.sourceGuide===undefined)url.searchParams.delete('guide');
  else url.searchParams.set('guide',state.sourceGuide?'1':'0');
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
