// Shell state owns panels and presentation. GPU engines own canvas interactions.
export function studioUI(onVisibility) {
  const $ = (selector) => document.querySelector(selector);
  let panel = 'scene',
    presenting = false,
    previousPanel = 'scene';
  const badge = $('#session-status');

  function showPanel(next) {
    panel = next;
    document.body.dataset.panel = next;
    $('#library-panel').hidden = next !== 'library';
    $('#scene-panel').hidden = next === 'library';
    $('#lighting-panel').hidden = next !== 'lighting';
    for (const button of document.querySelectorAll('[data-panel]')) {
      button.setAttribute('aria-pressed', String(button.dataset.panel === next));
    }
    onVisibility(next !== 'library');
  }

  function present(value) {
    if (value === presenting) return;
    if (value) {
      previousPanel = panel;
      showPanel('scene');
    }
    presenting = value;
    const url = new URL(location.href);
    if (value) url.searchParams.set('present', '1');
    else url.searchParams.delete('present');
    history.replaceState(null, '', url);
    document.body.dataset.demo = String(value);
    $('#demo-mode').textContent = value ? 'Exit presentation' : 'Present';
    $('#demo-mode').setAttribute('aria-pressed', String(value));
    if (!value) showPanel(previousPanel);
  }

  for (const button of document.querySelectorAll('[data-panel]')) {
    button.onclick = () => showPanel(button.dataset.panel);
  }
  $('#demo-mode').onclick = () => present(!presenting);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && presenting) present(false);
  });

  return {
    showPanel,
    present,
    get visible() {
      return panel !== 'library';
    },
    loading() {
      badge.textContent = 'Preparing';
      badge.dataset.state = 'loading';
      $('#view-state').hidden = false;
      $('#view-state-title').textContent = 'Preparing fire';
      $('#view-state-description').textContent = 'Loading the selected simulation.';
      $('#recovery-actions').hidden = true;
    },
    ready() {
      badge.textContent = 'Ready';
      badge.dataset.state = 'ready';
      $('#view-state').hidden = true;
    },
    failure(error, kind) {
      badge.textContent = 'Unavailable';
      badge.dataset.state = 'error';
      $('#view-state').hidden = false;
      $('#view-state-title').textContent = 'Simulation unavailable';
      $('#view-state-description').textContent = error.message || String(error);
      $('#recovery-actions').hidden = false;
      $('#use-original').hidden = kind === 'legacy';
      for (const button of document.querySelectorAll('.playback-bar button, #benchmark'))
        button.disabled = true;
      $('#message').textContent = 'Choose another simulation or try again.';
    },
  };
}
