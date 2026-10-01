import { readLook, writeLook } from './studio-location.js?v=0d1cf64e7f96e456';
import { createFireDomain } from './fire-domain.js?v=0d1cf64e7f96e456';
import { inspectionState } from './inspection-state.js?v=0d1cf64e7f96e456';
import { loadRuntime } from './runtime-loader.js?v=0d1cf64e7f96e456';
import { studioUI } from './studio-ui.js?v=0d1cf64e7f96e456';
import { DEMO_PRESETS } from './demo-presets.js?v=0d1cf64e7f96e456';
import { matchingPreset } from './preset-pairs.js?v=0d1cf64e7f96e456';
import { sourceGroups, sourceSelection } from './source-picker.js?v=0d1cf64e7f96e456';
import { modeForFire, readSimulation, runtimeFamily } from './simulation-modes.js?v=0d1cf64e7f96e456';
import { mountLibrary } from './pyro-gpu/library.js?v=0d1cf64e7f96e456';
import { LEGACY_PRESETS, FIRE_PRESETS, SCENES } from './pyro-gpu/presets.js?v=0d1cf64e7f96e456';
import { powerDefinition, normalizePowerSettings } from './fire-powers.js?v=0d1cf64e7f96e456';

const $ = (selector) => document.querySelector(selector);
const params = new URL(location.href).searchParams;
const remembered = new Map();
let runtime,
  engine = '',
  healthy = false,
  applying = false,
  library,
  transition = Promise.resolve();
let inspectionStorage;
try {
  inspectionStorage = sessionStorage;
} catch {}
const inspection = inspectionState(inspectionStorage);
const ui = studioUI((visible) => runtime?.setVisible(visible));

$('#lighting-controls').insertAdjacentHTML(
  'afterbegin',
  '<div class="fire-light-control"><label for="fire-light">Fire illumination</label><input id="fire-light" aria-label="Fire illumination" type="range" min="0" max="80" step="1" value="24"><output id="fire-light-value">24</output><small>Light cast by the flame onto smoke and the room.</small></div>',
);

function snapshot() {
  const selected = ($('#simulation').value === 'legacy' ? 'legacy:' : '') + $('#preset').value;
  return {
    fire: selected,
    room: $('#room').checked,
    fuel: $('#fuel').value,
    sourceGuide: $('#source-guide').checked,
    ...runtime?.snapshot(),
    simulation: $('#simulation').value,
    woodTimeScale: Number($('#wood-speed').value),
    lights: window.SceneLights.snapshot,
    fireLight: Number($('#fire-light').value),
  };
}

function refreshSources(kind = $('#simulation').value, selected = $('#preset').value) {
  const includeExperiments = $('#show-experiments').checked;
  $('#preset').replaceChildren();
  for (const section of sourceGroups(kind, includeExperiments, selected)) {
    const group = document.createElement('optgroup');
    group.label = section.label;
    group.append(...section.options.map((option) => new Option(option.name, option.value)));
    $('#preset').append(group);
  }
  $('#preset').value = selected;
}

function activateSourceSelection() {
  const { kind, key } = sourceSelection($('#simulation').value, $('#preset').value);
  return requestActivate(kind, key);
}

function updateLocation(kind, key, look) {
  const url = writeLook(new URL(location.href), snapshot());
  url.searchParams.delete('scene');
  if (look?.id && (look.test || DEMO_PRESETS.some((p) => p.id === look.id)))
    url.searchParams.set('scene', look.id);
  url.searchParams.set('room', $('#room').checked ? '1' : '0');
  url.searchParams.set('fuel', $('#fuel').value);
  history.replaceState(null, '', url);
}

function fail(error, kind = engine) {
  healthy = false;
  $('#power-controls').hidden = true;
  $('#gpu-status').textContent = error?.message || String(error);
  ui.failure(error, kind);
}

function setApplying(value) {
  applying = value;
  $('main').setAttribute('aria-busy', String(value));
  $('#simulation').disabled = $('#preset').disabled = value;
  // Runtime handlers still update capability states while mounting. Inert
  // prevents competing user edits without overriding those disabled states.
  $('#scene-panel').toggleAttribute('inert', value);
  $('#lighting-panel').toggleAttribute('inert', value);
}

function transitionLook(kind, chosen, old, force) {
  const previous = remembered.get(kind);
  const counterpart = matchingPreset(kind, old.fire)?.replace(/^legacy:/, '');
  if (engine && engine !== kind && counterpart === chosen.id.replace(/^legacy:/, '')) {
    const state = {
      fuel: old.fuel,
      room: old.room,
      smoke: old.smoke,
      color: old.color,
      fireLight: old.fireLight,
      sourceGuide: old.sourceGuide,
      woodTimeScale: old.woodTimeScale,
      powers: old.powers,
    };
    if (runtimeFamily(engine) === runtimeFamily(kind)) {
      state.camera = old.camera;
      state.embers = old.embers;
      state.tool = old.tool;
      return state;
    }
    // Each solver keeps its own framing. A previous source's camera would
    // overwrite the source selected by this transition.
    if (previous?.fire === chosen.id) {
      state.camera = previous.camera;
      if (kind !== 'legacy') state.embers = previous.embers;
    }
    return state;
  }
  if (force && old.fire === chosen.id) return old;
  return { room: old.room, fireLight: old.fireLight, fuel: chosen.fuel,
    ...(powerDefinition(chosen) && powerDefinition(old.fire) ? {powers:old.powers}: {}) };
}

function syncPowerControls() {
  const definition=powerDefinition($('#preset').value);
  $('#power-controls').hidden=!definition;
  if(!definition)return;
  $('#power-aim-fields').hidden=definition.kind!==2;
  $('#power-description').textContent=definition.hint;
  const display=()=>{
    const settings=normalizePowerSettings(runtime?.snapshot()?.powers);
    $('#power-strength').value=Math.round(settings.strength*100);
    $('#power-strength-value').textContent=Math.round(settings.strength*100)+'%';
    for(const key of ['heading','elevation']) {
      $('#power-'+key).value=settings[key];$('#power-'+key+'-value').textContent=settings[key]+'°';
    }
  };
  for(const key of ['strength','heading','elevation'])$('#power-'+key).oninput=()=>{
    const settings=normalizePowerSettings({strength:Number($('#power-strength').value)/100,
      heading:Number($('#power-heading').value),elevation:Number($('#power-elevation').value)});
    runtime?.look({powers:settings});display();
  };
  display();
}

async function mount(kind, chosen, plain, old, look) {
  const original = kind === 'legacy';
  ui.loading();
  try {
    if (runtime) {
      if (healthy) remembered.set(engine, old);
      await runtime.dispose();
      runtime = null;
    }
    healthy = false;
    for (const node of document.querySelectorAll(
      '#scene-panel button, #scene-panel input, #scene-panel select',
    )) {
      if (
        ['simulation', 'preset', 'show-experiments', 'retry-runtime', 'use-original'].includes(
          node.id,
        )
      )
        continue;
      node.onclick = node.oninput = node.onchange = null;
      node.disabled = false;
    }
    $('#fire-light').oninput = null;
    const canvas = $('#fire');
    canvas.replaceWith(canvas.cloneNode(false));
    refreshSources(kind, plain);
    $('#simulation').value = kind;
    $('#volume-source-controls').hidden = $('#appearance-controls').hidden = false;
    $('#smoke-control').hidden = $('#benchmark').hidden = false;
    $('.fire-light-control').hidden = false;
    $('#fire-light').disabled = false;
    $('.fire-light-control small').textContent = 'Light cast by the flame onto smoke, props and the room.';
    $('#embers').closest('label').hidden = original;
    $('#gpu-status').textContent = '';
    $('#metrics').textContent = '—';
    $('#pause').textContent = 'Pause';
    $('#restart').textContent = 'Restart';
    const createRuntime = await loadRuntime(kind);
    if (original) {
      window.FireDomain = createFireDomain(plain);
      window.FireOptics = window.createFireOptics();
      window.createFireRoom();
    }
    runtime = await createRuntime({
      initialPreset: plain,
      simulation: kind,
      onRemount: (key) => requestActivate('legacy', key),
      onFailure: (error) => fail(error, kind),
    });
    if (!runtime) throw new Error('The simulation could not start in this browser.');
    engine = kind;
    if (look) runtime.look(look);
    healthy = true;
    ui.ready();
  } finally {
    refreshSources(kind, plain);
    $('#preset').onchange = activateSourceSelection;
  }
}

function activate(kind, key, look, force = false) {
  transition = transition
    .catch(() => {})
    .then(async () => {
      setApplying(true);
      try {
        const original = kind === 'legacy',
          plain = key.replace(/^legacy:/, '');
        const catalog = original ? LEGACY_PRESETS : FIRE_PRESETS;
        const chosen = catalog.find((p) => (original ? p.id.slice(7) : p.id) === plain);
        if (!chosen) throw new Error('Unknown fire preset: ' + plain);
        if (look)
          look = {
            ...look,
            fuel: look.fuel ?? chosen.fuel,
            smoke: look.smoke ?? (!!chosen.smokeSimulation || plain === 'smoke-burst'),
          };
        const old = snapshot();
        if (look?.test)
          inspection.enter(
            {
              ...old,
              camera:
                old.camera ||
                (kind !== 'legacy' ? { zoom: 1.25, angle: 16, pan: [0, 0] } : undefined),
            },
            engine || kind,
          );
        const restored = look?.test ? null : inspection.leave(kind, !!look);
        window.SceneLights.setTransient(!!look?.test);
        if (restored)
          look = {
            ...restored,
            fuel: chosen.fuel,
            smoke: !!chosen.smokeSimulation || plain === 'smoke-burst',
            color: chosen.color || 'natural',
            room: restored.room ?? old.room ?? true,
          };
        else if (!look) look = transitionLook(kind, chosen, old, force);
        if (look?.lights || look?.lighting) window.SceneLights.apply(look.lights || look.lighting);
        if(typeof look?.sourceGuide==='boolean')$('#source-guide').checked=look.sourceGuide;
        const remount =
          force ||
          !healthy ||
          engine !== kind ||
          (original && (window.FireDomain?.blast !== (chosen.effect?.[0] === 0 || !!chosen.power) ||
            window.FireDomain?.object !== !!chosen.object));
        if (remount) await mount(kind, chosen, plain, old, look);
        else {
          ui.loading();
          await runtime.fire(plain);
          if (look) runtime.look(look);
          ui.ready();
        }
        refreshSources(kind, plain);
        syncPowerControls();
        $('#test-instructions').hidden = !look?.test;
        if (look?.test)
          $('#test-instructions').textContent = look.name + ' — ' + look.test.instruction;
        runtime.setVisible(ui.visible);
        $('#preset').onchange = activateSourceSelection;
        updateLocation(kind, plain, look);
        library.refresh();
      } finally {
        setApplying(false);
      }
    })
    .catch((error) => {
      fail(error, kind);
      throw error;
    });
  return transition;
}

// UI event handlers consume failures after the shared overlay has reported them.
function requestActivate(...args) {
  return activate(...args).catch(() => {});
}

library = mountLibrary({
  snapshot,
  fire: (id, preferredMode = $('#simulation').value) => activate(modeForFire(id, preferredMode), id),
  look: (item) => activate(modeForFire(item.fire, item.simulation ?? $('#simulation').value), item.fire, item),
  applied: (category) => ui.showPanel(category === 'Lighting' ? 'lighting' : 'scene', true),
});
$('#simulation').onchange = () => {
  const kind = $('#simulation').value;
  const currentFire = runtime?.snapshot()?.fire;
  requestActivate(
    kind,
    matchingPreset(kind, currentFire) ||
      remembered.get(kind)?.fire ||
      (kind === 'legacy' ? 'sigil' : 'bonfire'),
  );
};
$('#show-experiments').onchange = () => refreshSources();
$('#retry-runtime').onclick = () =>
  requestActivate($('#simulation').value, $('#preset').value, undefined, true);
$('#use-original').onclick = () =>
  requestActivate('legacy', matchingPreset('legacy', snapshot().fire) || 'sigil', undefined, true);
if (params.has('lighting')) window.SceneLights.apply(params.get('lighting'));
ui.showPanel('scene');
const initialScene = [...DEMO_PRESETS, ...SCENES].find((p) => p.id === params.get('scene'));
if (initialScene)
  await requestActivate(
    modeForFire(initialScene.fire, readSimulation(params)),
    initialScene.fire,
    { ...initialScene, ...readLook(params, initialScene.camera) },
  );
else {
  const kind = readSimulation(params);
  const catalog = kind !== 'legacy' ? FIRE_PRESETS : LEGACY_PRESETS;
  const fallback = kind !== 'legacy' ? 'bonfire' : 'sigil';
  const requested = params.get(kind !== 'legacy' ? 'firePreset' : 'preset') || fallback;
  const key = catalog.some((p) => p.id.replace(/^legacy:/, '') === requested) ? requested : fallback;
  await requestActivate(kind, key, readLook(params));
}
if (params.get('present') === '1') ui.present(true);
// Shell owns link synchronization after engine handlers update their state.
function syncLocation() {
  if (!healthy || applying) return;
  const url = writeLook(new URL(location.href), snapshot());
  url.searchParams.delete('scene');
  url.searchParams.delete('lighting');
  history.replaceState(null, '', url);
}
for (const type of ['input', 'change']) document.addEventListener(type, (event) => {
  if (event.target.matches('#fuel, #room, #source-guide, #smoke-only, #flame-color, #embers, #fire-light, #wood-speed, #power-strength, #power-heading, #power-elevation, #zoom, #orbit')) syncLocation();
});
window.addEventListener('scene-light-change', syncLocation);
$('#view').addEventListener('pointerup', syncLocation);
$('#view').addEventListener('wheel', syncLocation);
for (const id of ['zoom-in', 'zoom-out', 'reset-view', 'focus-fire'])
  $('#' + id).addEventListener('click', syncLocation);
// A page in the back/forward cache must retain its runtime for pageshow.
window.addEventListener('pagehide', (event) => {
  if (event.persisted) runtime?.setVisible(false);
  else runtime?.dispose();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) runtime?.setVisible(ui.visible);
});
