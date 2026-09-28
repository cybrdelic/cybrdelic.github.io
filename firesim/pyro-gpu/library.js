import { ALL_FIRE_PRESETS, SCENES } from './presets.js?v=studio-rc-3';
import { DEMO_PRESETS, isExperimental } from '../demo-presets.js?v=studio-rc-3';
import { lookStore } from '../look-storage.js?v=studio-rc-3';

const CATEGORIES = ['Demos', 'Sources', 'Lighting', 'Tests', 'Experiments', 'Saved'];
const LIGHTING = [
  'fire',
  'studio',
  'moon',
  'material-white',
  'side',
  'backlight',
  'shadow',
  'bounce-check',
];

export function mountLibrary(api) {
  const library = document.createElement('div');
  library.id = 'preset-library';
  library.innerHTML = [
    '<div class="library-heading"><div><h1>Preset library</h1><p id="category-description"></p></div><span id="library-count"></span></div>',
    '<div class="library-toolbar"><label>Collection<select id="library-category" aria-label="Preset collection"></select></label>',
    '<label class="library-search-label">Find a preset<input id="library-search" type="search" aria-label="Search presets" placeholder="Search this collection"></label></div>',
    '<div class="preset-grid"></div><p id="library-status" role="status"></p>',
    '<details class="saved-tools"><summary>Save &amp; manage looks</summary>',
    '<form class="save-look"><label>Name this look<input id="look-name" type="text" maxlength="80" placeholder="My fire setup" required></label><button type="submit">Save current look</button><button type="button" id="export-looks">Export saved</button><label class="import-looks">Import saved<input type="file" id="import-looks" accept="application/json,.json"></label></form>',
    '<p>Saved in this browser. Export a copy to use on another device.</p></details>',
  ].join('');
  document.querySelector('#library-panel').append(library);
  const $ = (selector) => library.querySelector(selector);
  const grid = $('.preset-grid'),
    status = $('#library-status'),
    search = $('#library-search'),
    categoryControl = $('#library-category');
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
    Demos: 'Complete starting scenes. Choose one, then use Present for a clean stage.',
    Sources: 'Individual fire and smoke sources. Each card identifies its simulation.',
    Lighting: 'A focused set of lighting rigs for presentation and inspection.',
    Tests: 'Controlled inspections with fixed cameras, lighting, and instructions.',
    Experiments: 'Work in progress. Geometry, effect quality, and performance vary.',
    Saved: 'Your fire, lighting, room, and camera combinations.',
  };

  function collection() {
    if (category === 'Demos') return DEMO_PRESETS;
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
    render();
    try {
      if (item.kind === 'lighting') window.SceneLights.apply(item.id);
      else if (item.fire) await api.look({ ...item, lights: item.lights || item.lighting });
      else await api.fire(item.id);
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
    const term = search.value.trim().toLowerCase();
    const items = collection().filter((p) =>
      (p.name + ' ' + (p.description || '')).toLowerCase().includes(term),
    );
    $('#library-count').textContent = items.length + (items.length === 1 ? ' preset' : ' presets');
    grid.replaceChildren();
    const snapshot = api.snapshot();
    for (const item of items) {
      const card = document.createElement('article');
      card.className = 'preset-card';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'preset-apply';
      button.disabled = applying;
      button.setAttribute(
        'aria-pressed',
        String(
          item.fire
            ? activeScene === category + item.id && snapshot.fire === item.fire
            : item.kind === 'lighting'
              ? document.querySelector('#lighting-preset').value === item.id
              : snapshot.fire === item.id,
        ),
      );
      const type = document.createElement('span');
      type.className = 'preset-kind';
      type.textContent =
        item.kind === 'lighting'
          ? 'LIGHTING'
          : (item.fire || item.id).startsWith('legacy:')
            ? 'ORIGINAL'
            : '3D VOLUME';
      if (item.preview) {
        const image = document.createElement('img');
        image.src = item.preview;
        image.alt = 'Source geometry';
        image.loading = 'lazy';
        image.className = 'source-preview';
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
      description.textContent = item.description;
      button.append(type, heading, description);
      button.onclick = () => apply(item);
      card.append(button);
      if (category === 'Saved') {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove-look';
        remove.textContent = 'Remove';
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
          : 'No matching presets. Try a different search.';
      grid.append(empty);
    }
  }

  categoryControl.onchange = () => {
    category = categoryControl.value;
    search.value = '';
    render();
  };
  search.oninput = render;
  $('.save-look').onsubmit = (event) => {
    event.preventDefault();
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
