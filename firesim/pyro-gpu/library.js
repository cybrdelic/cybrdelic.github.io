import { ALL_FIRE_PRESETS, SCENES } from './presets.js?v=0d1cf64e7f96e456';
import { DEMO_PRESETS, isExperimental } from '../demo-presets.js?v=0d1cf64e7f96e456';
import { lookStore } from '../look-storage.js?v=0d1cf64e7f96e456';
import { modeForFire } from '../simulation-modes.js?v=0d1cf64e7f96e456';

const CATEGORIES = ['Demos', 'Powers', 'Sources', 'Lighting', 'Tests', 'Experiments', 'Saved'];
const LIGHTING = [
  'fire',
  'studio',
  'fully-lit',
  'moon',
  'material-white',
  'side',
  'backlight',
  'shadow',
  'bounce-check',
];

function selectedSimulation(simulation, currentFire, currentSimulation) {
  return simulation === 'current' ? modeForFire(currentFire, currentSimulation) : simulation;
}

// Shared source IDs can run in either volume mode. Saved looks retain the mode
// they were recorded in; an explicit library filter chooses the shared source's mode.
export function libraryItemSimulation(item, simulation = 'current', currentFire = '', currentSimulation = '') {
  const preferred = item.simulation || (simulation === 'all'
    ? modeForFire(currentFire, currentSimulation)
    : selectedSimulation(simulation, currentFire, currentSimulation));
  return modeForFire(item.fire || item.id || '', preferred);
}

export function filterLibrary(items, term = '', simulation = 'all', currentFire = '', currentSimulation = '') {
  const selected = selectedSimulation(simulation, currentFire, currentSimulation);
  const query = term.trim().toLowerCase();
  return items.filter((item) => {
    const original = (item.fire || item.id || '').startsWith('legacy:');
    const explicitMode = item.simulation ? modeForFire(item.fire || item.id || '', item.simulation) : null;
    const searchableMode = original ? 'original' : explicitMode === 'sparse' ? 'sparse voxels' : explicitMode === 'volume' ? '3d volume' : '3d volume sparse voxels';
    return (item.kind === 'lighting' || selected === 'all' ||
      (original === (selected === 'legacy') && (!explicitMode || explicitMode === selected))) &&
      [item.name, item.description, item.family, searchableMode]
        .filter(Boolean).join(' ').toLowerCase().includes(query);
  });
}

export function mountLibrary(api) {
  const library = document.createElement('div');
  library.id = 'preset-library';
  library.innerHTML = [
    '<div class="library-heading"><div><h1>Preset library</h1><p id="category-description"></p></div><span id="library-count"></span></div>',
    '<div class="library-toolbar"><label>Collection<select id="library-category" aria-label="Preset collection"></select></label>',
    '<label id="library-simulation-label">Simulation<select id="library-simulation"><option value="current">Current simulation</option><option value="legacy">Original</option><option value="volume">3D volume · experimental</option><option value="sparse">Sparse volume · experimental</option><option value="all">All simulations</option></select></label>',
    '<label class="library-search-label">Search<input id="library-search" type="search" aria-label="Search presets" aria-controls="preset-grid"></label></div>',
    '<div class="preset-grid" id="preset-grid" aria-label="Presets"></div><p id="library-status" role="status" aria-live="polite"></p>',
    '<details class="saved-tools"><summary>Save &amp; manage looks</summary>',
    '<form class="save-look"><label>Name this look<input id="look-name" type="text" maxlength="80" autocomplete="off" required></label><button type="submit">Save current look</button><button type="button" id="export-looks">Export saved</button><label class="import-looks">Import saved<input type="file" id="import-looks" accept="application/json,.json"></label></form>',
    '<p>Saved in this browser. Export a copy to use on another device.</p></details>',
  ].join('');
  document.querySelector('#library-panel').append(library);
  const $ = (selector) => library.querySelector(selector);
  const grid = $('.preset-grid'),
    status = $('#library-status'),
    search = $('#library-search'),
    categoryControl = $('#library-category'),
    simulationControl = $('#library-simulation');
  let category = 'Demos',
    activeScene = '',
    applying = false,
    storage;
  try {
    storage = localStorage;
  } catch {}
  const saved = lookStore(storage, ALL_FIRE_PRESETS);
  categoryControl.append(...CATEGORIES.map((name) => new Option(name, name)));
  const descriptions = {
    Demos: 'Starting scenes for the selected simulation. Present hides the controls.',
    Powers: 'Cast a blast, launch a fireball, or shape a sustained effect. These run live in both simulations.',
    Sources: 'Fire, powers, smoke, sigils, and shapes. Switch the simulation filter to compare sources.',
    Lighting: 'Light the current scene with a key, rim, ambient fill, or room bounce.',
    Tests: 'Fixed cameras and lighting for checking smoke transport, shadows, and combustion.',
    Experiments: 'Work in progress. Geometry, effect quality, and performance vary.',
    Saved: 'Your simulation, fire, lighting, room, and camera combinations.',
  };

  function collection() {
    if (category === 'Demos') return DEMO_PRESETS;
    if (category === 'Powers') return ALL_FIRE_PRESETS.filter((p) => p.family === 'Powers');
    if (category === 'Sources') return ALL_FIRE_PRESETS.filter((p) => !isExperimental(p));
    if (category === 'Lighting')
      return LIGHTING.map((id) => window.SceneLights.catalog.find((p) => p.id === id))
        .filter(Boolean)
        .map((p) => ({
          ...p,
          kind: 'lighting',
          description: p.description || 'A complete lighting setup for the live scene.',
        }));
    if (category === 'Tests') return SCENES.filter((p) => p.test);
    if (category === 'Experiments')
      return [...ALL_FIRE_PRESETS.filter(isExperimental), ...SCENES.filter((p) => !p.test)];
    return saved.items.map((p, index) => ({
      ...p,
      id: String(index),
      description: 'Saved fire, lighting, and camera.',
    }));
  }

  async function apply(item) {
    if (applying) return;
    const appliedCategory = category;
    applying = true;
    grid.setAttribute('aria-busy', 'true');
    for (const button of grid.querySelectorAll('button')) button.disabled = true;
    status.textContent = 'Applying ' + item.name + '…';
    try {
      const snapshot = api.snapshot();
      const simulation = libraryItemSimulation(item, simulationControl.value, snapshot.fire, snapshot.simulation);
      if (item.kind === 'lighting') window.SceneLights.apply(item.id);
      else if (item.fire) await api.look({ ...item, simulation, lights: item.lights || item.lighting });
      else await api.fire(item.id, simulation);
      activeScene = appliedCategory + item.id;
      status.textContent = item.name + ' applied';
      api.applied?.(appliedCategory);
    } catch (error) {
      status.textContent = error.message;
      api.applied?.('Scene'); // Keep the runtime recovery message reachable.
    } finally {
      applying = false;
      render();
    }
  }

  function render() {
    categoryControl.value = category;
    $('#category-description').textContent = descriptions[category];
    const snapshot = api.snapshot();
    $('#library-simulation-label').hidden = category === 'Lighting';
    const items = filterLibrary(collection(), search.value, simulationControl.value, snapshot.fire, snapshot.simulation);
    $('#library-count').textContent = items.length + (items.length === 1 ? ' preset' : ' presets');
    grid.setAttribute('aria-busy', String(applying));
    grid.replaceChildren();
    for (const item of items) {
      const simulation = libraryItemSimulation(item, simulationControl.value, snapshot.fire, snapshot.simulation);
      const currentSimulation = modeForFire(snapshot.fire, snapshot.simulation);
      const card = document.createElement('article');
      card.className = 'preset-card';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'preset-apply';
      button.dataset.preset = item.id;
      button.disabled = applying;
      button.setAttribute(
        'aria-pressed',
        String(
          item.fire
            ? activeScene === category + item.id && snapshot.fire === item.fire && currentSimulation === simulation
            : item.kind === 'lighting'
              ? document.querySelector('#lighting-preset')?.value === item.id
              : snapshot.fire === item.id && currentSimulation === simulation,
        ),
      );
      const type = document.createElement('span');
      type.className = 'preset-kind';
      type.textContent =
        item.kind === 'lighting'
          ? 'LIGHTING'
          : simulation === 'legacy'
            ? 'ORIGINAL'
            : simulation === 'sparse' ? 'SPARSE VOLUME · EXPERIMENTAL' : '3D VOLUME · EXPERIMENTAL';
      const source = ALL_FIRE_PRESETS.find((preset) => preset.id === (item.fire || item.id));
      if (source?.id.startsWith('legacy:') && isExperimental(source)) type.textContent += ' · EXPERIMENTAL';
      if (item.preview) {
        const image = document.createElement('img');
        image.src = item.preview;
        image.alt = item.name + ' source geometry';
        image.loading = 'lazy';
        image.className = 'source-preview';
        image.onerror = () => { image.hidden = true; };
        button.append(image);
      }
      if (item.kind === 'lighting') {
        const swatch = document.createElement('span');
        swatch.className = 'light-swatch';
        swatch.setAttribute('aria-hidden', 'true');
        swatch.style.setProperty(
          '--key-color',
          item.values.key > 0 ? item.values.keyColor : '#352518',
        );
        swatch.style.setProperty(
          '--rim-color',
          item.values.rim > 0 ? item.values.rimColor : '#171717',
        );
        button.append(swatch);
      }
      const heading = document.createElement('strong');
      heading.textContent = item.name;
      const description = document.createElement('span');
      description.className = 'preset-description';
      description.textContent = (item.description || '').replace(/^(Original|3D) simulation · /, '');
      button.append(type, heading, description);
      button.onclick = () => apply(item);
      card.append(button);
      if (category === 'Saved') {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove-look';
        remove.textContent = 'Remove';
        remove.disabled = applying;
        remove.setAttribute('aria-label', 'Remove ' + item.name);
        remove.onclick = () => {
          try {
            saved.remove(Number(item.id));
            status.textContent = item.name + ' removed';
            render();
          } catch (error) {
            status.textContent = error.message;
          }
        };
        card.append(remove);
      }
      grid.append(card);
    }
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'library-empty';
      empty.textContent =
        category === 'Saved' && !saved.items.length
          ? 'No saved looks yet. Save your current setup below.'
          : 'No matching presets. Change the search or simulation filter.';
      if (!search.value.trim() && category !== 'Lighting' && simulationControl.value !== 'all' && collection().length) {
        const showAll = document.createElement('button');
        showAll.type = 'button';
        showAll.textContent = 'Show all simulations';
        showAll.onclick = () => {
          simulationControl.value = 'all';
          render();
          simulationControl.focus();
        };
        empty.append(showAll);
      }
      grid.append(empty);
    }
  }

  categoryControl.onchange = () => {
    category = categoryControl.value;
    search.value = '';
    render();
  };
  search.oninput = render;
  simulationControl.onchange = render;
  $('.save-look').onsubmit = (event) => {
    event.preventDefault();
    if (applying) {
      status.textContent = 'Wait for the scene to finish loading before saving its look.';
      return;
    }
    try {
      const item = saved.add({ ...api.snapshot(), name: $('#look-name').value });
      $('#look-name').value = '';
      category = 'Saved';
      search.value = '';
      status.textContent = item.name + ' saved';
      render();
    } catch (error) {
      status.textContent = error.message;
    }
  };
  $('#export-looks').onclick = () => {
    const blob = new Blob([JSON.stringify(saved.export(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob),
      link = document.createElement('a');
    link.href = url;
    link.download = 'cybr-fire-presets.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = 'Saved library exported';
  };
  $('#import-looks').onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 100000) throw new Error('Choose a library smaller than 100 KB.');
      const count = saved.import(JSON.parse(await file.text()));
      category = 'Saved';
      search.value = '';
      status.textContent = count + ' looks imported';
      render();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      event.target.value = '';
    }
  };
  window.addEventListener('scene-light-change', () => {
    if (category === 'Lighting') render();
  });
  render();
  return { refresh: render };
}
