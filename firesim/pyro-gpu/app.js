import { FIRE_COLORS } from './fire-colors.js?v=54c82352661e679d';
import { PyroSolver } from './solver.js?v=54c82352661e679d';
import { FIRE_PRESETS, sourceOrigin } from './presets.js?v=54c82352661e679d';
import { runtimeScope } from '../runtime-scope.js?v=54c82352661e679d';
import { outputSize } from './output-size.js?v=54c82352661e679d';
import { gpuSessionTimeout } from './gpu-session.js?v=54c82352661e679d';
import { floorHit } from '../fuel-ground.js?v=54c82352661e679d';
import { volumeOptions } from '../simulation-modes.js?v=54c82352661e679d';
import { powerDefinition, normalizePowerSettings, powerDirection } from '../fire-powers.js?v=54c82352661e679d';
export async function mountVolume({
  initialPreset = 'explosion',
  initialPowers,
  simulation = 'volume',
  onFailure = () => {},
} = {}) {
  const scope = runtimeScope(onFailure),
    on = scope.on;
  const $ = (s) => document.querySelector(s),
    params = new URL(location.href).searchParams;
  const canvas = $('#fire'),
    view = $('#view'),
    message = $('#message'),
    metrics = $('#metrics');
  const desiredOutput = () =>
    outputSize(view.getBoundingClientRect().width, devicePixelRatio, params.has('qa'));
  [canvas.width, canvas.height] = desiredOutput();
  let pendingOutput = null;
  const resizeObserver = new ResizeObserver(() => {
    pendingOutput = desiredOutput();
    markDirty();
  });
  let solver,
    paused = false,
    busy = false,
    dirty = true,
    zoom = 1.25,
    angle = Number(params.get('angle') || 16),
    pan = [0, 0],
    activeTool = 'fire',
    gesture = null,
    trace = [],
    captureIndex = 0,
    saved = false;
  let powers=normalizePowerSettings(initialPowers??{strength:params.get('powerStrength')??1,heading:params.get('powerHeading')??0,elevation:params.get('powerElevation')??9});
  let frameCount = 0,
    queueLimitedRafs = 0,
    testScenario = null,
    testStopped = false;
  let revision = 0,
    resetQueued = false,
    resetWaiters = [],
    resetCompletion = null,
    benchmarkQueued = false,
    benchmarkActive = false,
    cancelBenchmark = false;
  const markDirty = () => {
    dirty = true;
    revision++;
  };
  resizeObserver.observe(view);
  on(window, 'resize', () => {
    pendingOutput = desiredOutput();
    markDirty();
  });
  let smoke = params.get('smoke') === '1',
    activeFire = FIRE_PRESETS.find((p) => p.id === initialPreset) || FIRE_PRESETS[0];
  let fireLight = 24;
  try {
    const saved = Number(localStorage.getItem('cybr-pyro-fire-light') ?? 24);
    if (Number.isFinite(saved)) fireLight = Math.max(0, Math.min(80, saved));
  } catch {}
  if (params.has('fireLight') && Number.isFinite(Number(params.get('fireLight'))))
    fireLight = Math.max(0, Math.min(80, Number(params.get('fireLight'))));
  let flameColor = FIRE_COLORS.some((c) => c.id === params.get('color'))
      ? params.get('color')
      : activeFire.color || 'natural',
    embers = params.get('embers') !== '0';
  $('#flame-color').replaceChildren(...FIRE_COLORS.map((c) => new Option(c.name, c.id)));
  $('#flame-color').value = flameColor;
  $('#embers').checked = embers;
  $('#flame-color').onchange = () => {
    flameColor = $('#flame-color').value;
    if (solver) {
      solver.color = flameColor;
      solver.lightReady = false;
    }
    const u = new URL(location.href);
    u.searchParams.set('color', flameColor);
    history.replaceState(null, '', u);
    markDirty();
  };
  $('#embers').onchange = () => {
    embers = $('#embers').checked;
    if (solver) solver.embers = embers;
    const u = new URL(location.href);
    u.searchParams.set('embers', embers ? '1' : '0');
    history.replaceState(null, '', u);
    markDirty();
  };
  $('#fuel').value = ['gas', 'wood', 'oil'].includes(params.get('fuel'))
    ? params.get('fuel')
    : activeFire.fuel;
  let woodTimeScale = Math.max(1, Math.min(24, Number(params.get('woodTimeScale')) || 12));
  function setWoodTime(value) {
    woodTimeScale = Math.max(1, Math.min(24, Number(value) || 12));
    $('#wood-speed').value = woodTimeScale;
    $('#wood-speed-value').textContent = woodTimeScale + '×';
    if (solver) { solver.woodTimeScale = woodTimeScale; solver.lightReady = false; }
    markDirty();
  }
  setWoodTime(woodTimeScale);
  $('#wood-speed').oninput = () => setWoodTime($('#wood-speed').value);
  $('#preset').value = activeFire.id;
  $('#burst').hidden = false;
  $('#extinguish').hidden = false;
  $('#help').textContent =
    'Click to detonate. Drag to place the next burst. Shift/right-drag to pan; scroll to zoom. Inspect smoke hides visible flame while retaining its illumination.';
  canvas.setAttribute(
    'aria-label',
    'Live three-dimensional explosion. Click to burst, drag the source, shift-drag to pan.',
  );

  $('#smoke-only').checked = smoke;
  $('#smoke-only').title =
    'Hide visible flame without resetting the flow or removing fire illumination. Use scene lighting to reveal cooled smoke.';
  $('#gpu-status').textContent = simulation === 'sparse'
    ? 'Compiling the active-brick 3D solver…' : 'Compiling the 3D solver…';
  $('#room').checked = params.get('room') !== '0';
  $('#orbit').min = -75;
  $('#orbit').max = 75;
  $('#orbit').disabled = false;
  if (params.has('qa'))
    (($('#lighting-preset').value = 'studio'),
      $('#lighting-preset').dispatchEvent(new Event('change')));
  const normalize = (v) => {
    const n = Math.hypot(...v);
    return v.map((x) => x / n);
  };
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  function camera() {
    const a = (angle * Math.PI) / 180,
      eye = [pan[0] + Math.sin(a) * 13, 3.5 + pan[1], Math.cos(a) * 13],
      forward = normalize([pan[0] - eye[0], 2.4 + pan[1] - eye[1], -eye[2]]),
      right = normalize(cross(forward, [0, 1, 0]));
    return { eye, forward, right, up: cross(right, forward), tan: 0.3443276133 / zoom };
  }
  function sync() {
    const placed=!!solver?.hasFloorFuel;
    $('#fuel-actions').hidden=activeTool!=='fuel'&&!placed;
    $('#ignite-fuel').disabled=!placed||!!activeFire.smokeSimulation;
    $('#ignite-fuel').title=activeFire.smokeSimulation?'Choose a fire source to ignite fuel.':'Apply a single ignition pulse to the placed fuel';
    $('#clear-fuel').disabled=!placed;
    $('#zoom').value = zoom * 100;
    $('#zoom-value').value = Math.round(zoom * 100) + '%';
    $('#orbit').value = angle;
    $('#angle-value').value = angle + '°';
    $('#pause').textContent = paused ? 'Resume' : 'Pause';
    $('.stamp strong').textContent = smoke
      ? 'WebGPU · smoke inspection'
      : 'WebGPU · live combustion';
    markDirty();
  }
  function runtimeStatus() {
    if (!solver?.useBrickPool) {
      return solver?.adaptive || solver?.pressureWork || solver?.useLightWork || solver?.useLightReceivers
        ? 'Experimental solver · ' : '';
    }
    const label = simulation === 'sparse' ? 'Sparse volume (experimental)' : 'Active bricks (experimental)';
    // Readbacks describe the most recent completed topology sample. A failed
    // readback must not leave an earlier sparse sample displayed as current.
    if (solver.poolTelemetryAvailable === false) return label + ' · status unavailable · ';
    const pool = solver.latestTelemetry?.brickPool;
    if (!pool) return label + ' · telemetry pending · ';
    if (pool.migrationPending) return label + ' · dense migration pending · ';
    if (pool.mode === 'dense') {
      const reasons = [];
      if (pool.overflow & 1) reasons.push('atlas capacity');
      if (pool.overflow & 2) reasons.push('brick coverage limit');
      if (pool.overflow & 4) reasons.push('atlas memory policy');
      if (pool.overflow & 8) reasons.push('slot generation limit');
      return label + ' · dense fallback' + (reasons.length ? ' (' + reasons.join(', ') + ')' : '') + ' · ';
    }
    return label + ` · active bricks ${pool.resident}/${pool.capacity} pages · `;
  }
  function presentationStatus() {
    $('#gpu-status').textContent = runtimeStatus() +
      (solver.adapter.description || solver.adapter.device || solver.adapter.vendor);
  }
  function color(hex) {
    return [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
  }
  function lightState() {
    const state = {};
    for (const input of document.querySelectorAll('[data-light]'))
      state[input.dataset.light] = input.type === 'color' ? input.value : Number(input.value);
    return state;
  }
  function viewUniform() {
    const c = camera(),
      l = lightState(),
      data = [
        ...c.eye,
        c.tan,
        ...c.right,
        solver?.hasFloorFuel ? 1 : 0,
        ...c.up,
        0,
        ...c.forward,
        0,
        $('#room').checked ? 1 : 0,
        smoke ? 1 : 0,
        l.bounce,
        fireLight,
        ...color(l.tint).map((v) => v * l.ambient),
        $('#source-guide').checked && activeFire.effect[0]===10 ? 10 : 0,
      ];
    for (const k of ['key', 'rim']) {
      const a = (l[k + 'Az'] * Math.PI) / 180,
        pos = [Math.sin(a) * 5, l[k + 'Height'], 1.2 + Math.cos(a) * 3],
        dir = normalize([l.aimX - pos[0], l.aimY - pos[1], -pos[2]]),
        cone = (l[k + 'Beam'] * 0.5 * Math.PI) / 180;
      data.push(
        ...pos,
        0,
        ...dir,
        Math.cos(cone),
        ...color(l[k + 'Color']).map((v) => v * l[k]),
        Math.cos(cone * 0.7),
      );
    }
    return data;
  }
  function worldPoint(e) {
    const r = canvas.getBoundingClientRect(),
      x = (2 * (e.clientX - r.left)) / r.width - 1,
      y = 1 - (2 * (e.clientY - r.top)) / r.height,
      c = camera(),
      ray = c.forward.map((v, i) => v + x * (16 / 9) * c.tan * c.right[i] + y * c.tan * c.up[i]),
      t = -c.eye[2] / ray[2];
    return [c.eye[0] + ray[0] * t, c.eye[1] + ray[1] * t, 0];
  }
  function locationPoint(e) {
    const p = worldPoint(e),
      edge = activeFire.object ? 1.45 : 2.2;
    return [
      Math.max(-edge, Math.min(edge, p[0])),
      Math.max(
        activeFire.minHeight ?? (activeFire.effect[3] > 0.5 ? 0.18 : 0.48),
        Math.min(activeFire.object ? 4.45 : 4.8, p[1]),
      ),
      0,
    ];
  }
  function floorPoint(e) {
    const r=canvas.getBoundingClientRect(),c=camera();
    const x=2*(e.clientX-r.left)/r.width-1,y=1-2*(e.clientY-r.top)/r.height;
    return floorHit(c.eye,c.forward.map((v,i)=>v+x*(16/9)*c.tan*c.right[i]+y*c.tan*c.up[i]));
  }
  function placeFuel(e) {
    const at=floorPoint(e);
    if(!at){if(gesture)gesture.fuelAt=null;message.textContent='Place fuel on the floor inside the simulation area.';return;}
    solver.dropFuel(at,gesture?.fuelAt);if(gesture)gesture.fuelAt=at;
    paused=false;sync();
    message.textContent='Unlit fuel placed · nearby flame or Ignite fuel starts combustion';
  }
  function powerPoint(e) {
    const definition=powerDefinition(activeFire);
    if(!definition?.floor)return locationPoint(e);
    const at=floorPoint(e);
    return at ? [at[0],activeFire.source?.[1]??.18,at[1]] : null;
  }
  function releaseBusy() {
    busy = false;
    if (!resetQueued) return;
    if (scope.disposed) {
      resetQueued = false;
      const error = new Error('The simulation was closed before its reset completed.');
      for (const waiter of resetWaiters.splice(0)) waiter.reject(error);
    } else {
      restart().catch(onFailure);
    }
  }
  function restart() {
    if (!solver || scope.disposed) return Promise.resolve();
    if (busy) {
      resetQueued = true;
      return new Promise((resolve, reject) => resetWaiters.push({ resolve, reject }));
    }
    resetQueued = false;
    busy = true;
    const waiters = resetWaiters.splice(0);
    const task = (async () => {
      try {
        await solver.prepareSource();
        if (scope.disposed) return;
        await solver.reset();
        if (scope.disposed) return;
        triggerSource();
        if (testScenario) {
          solver.seed = 2;
          solver.source = sourceOrigin(activeFire);
        }
        testStopped = false;
        trace = [];
        captureIndex = 0;
        saved = false;
        paused = false;
        sync();
        if (pendingOutput) {
          solver.resizeOutput(...pendingOutput);
          pendingOutput = null;
        }
        solver.smoke = !!activeFire.smokeSimulation || activeFire.id === 'smoke-burst';
        solver.camera(viewUniform());
        await solver.frame(1 / 60);
        await gpuSessionTimeout(solver.drain(), 'source presentation', 8000);
        presentationStatus();
      } finally {
        releaseBusy();
      }
    })();
    resetCompletion = task;
    task.then(
      () => { for (const waiter of waiters) waiter.resolve(); },
      (error) => { for (const waiter of waiters) waiter.reject(error); },
    );
    return task;
  }
  function triggerSource() {
    if(powerDefinition(activeFire))return solver.castPower(solver.source,powerDirection(powers),powers.strength);
    solver.burst();return true;
  }
  function burst() {
    if (!solver) return;
    triggerSource();
    paused = false;
    sync();
  }
  $('#pause').onclick = () => {
    if (benchmarkActive) {
      cancelBenchmark = true;
      return;
    }
    paused = !paused;
    sync();
  };
  $('#restart').onclick = () => restart().catch(onFailure);
  $('#burst').onclick = burst;
  $('#extinguish').onclick = () => {
    if (solver) solver.active = false;
    message.textContent = activeFire.object ? 'Ignition stopped · hot material can keep burning' : activeFire.power ? 'Power stopped · released fire and smoke continue' : 'Source stopped · smoke continues to drift';
  };
  $('#smoke-only').onchange = () => {
    smoke = $('#smoke-only').checked;
    const url = new URL(location.href);
    url.searchParams.set('smoke', smoke ? '1' : '0');
    history.replaceState(null, '', url);
    sync();
  };
  $('#fuel').onchange = () => {
    if (solver) solver.fuel = { gas: 0, wood: 0.35, oil: 1 }[$('#fuel').value];
  };
  $('#room').onchange = markDirty;
  $('#source-guide').onchange = markDirty;
  $('#ignite-fuel').onclick=()=>{if(solver?.igniteFuel()){paused=false;sync();message.textContent='Fuel ignited · the finite patches burn down through normal combustion';}else message.textContent=solver?.smoke?'Choose a fire source to ignite fuel.':'Drop fuel on the floor first.';};
  $('#clear-fuel').onclick = () => {solver?.clearFuel();sync();message.textContent='Placed fuel and burn marks cleared · existing smoke keeps drifting';};
  on(window, 'scene-light-change', markDirty);
  $('#orbit').oninput = () => {
    angle = Number($('#orbit').value);
    sync();
  };
  $('#zoom').oninput = () => {
    zoom = Number($('#zoom').value) / 100;
    sync();
  };
  function changeZoom(value, event) {
    const before = event ? worldPoint(event) : null;
    zoom = Math.max(0.7, Math.min(3, value));
    if (before) {
      const after = worldPoint(event);
      pan[0] += before[0] - after[0];
      pan[1] += before[1] - after[1];
    }
    sync();
  }
  $('#zoom-in').onclick = () => changeZoom(zoom + 0.25);
  $('#zoom-out').onclick = () => changeZoom(zoom - 0.25);
  $('#reset-view').onclick = () => {
    zoom = 1.25;
    angle = 16;
    pan = [0, 0];
    sync();
  };
  $('#focus-fire').disabled = false;
  $('#focus-fire').onclick = () => {
    if (!solver) return;
    pan = [solver.source[0], solver.source[1] - 0.6];
    zoom = 1.4;
    sync();
  };
  function tool(next) {
    if(gesture&&view.hasPointerCapture?.(gesture.id))view.releasePointerCapture(gesture.id);
    gesture=null;
    activeTool=next;
    for(const id of ['fire','fuel','pan'])$('#'+id+'-tool').setAttribute('aria-pressed',id===next);
    view.dataset.tool=next;
    if(next==='fuel'){$('#room').checked=true;$('#room').dispatchEvent(new Event('change'));}
    $('#help').textContent=next==='fuel'?'Click or drag across the floor to lay unlit fuel. Nearby flames or Ignite fuel ignite it. Fully lit reveals cold patches. Shift/right-drag pans; scroll zooms.':
      'Drag to move the burning source. Shift/right-drag pans; scroll zooms.';
    sync();
  }
  $('#fire-tool').onclick = () => tool('fire');
  $('#fuel-tool').onclick = () => tool('fuel');
  $('#pan-tool').onclick = () => tool('pan');
  tool('fire');
  on(view, 'pointerdown', (e) => {
    if (!solver) return;
    e.preventDefault();
    view.focus({ preventScroll: true });
    if(gesture||(e.pointerType==='mouse'&&e.button!==0&&e.button!==2))return;
    const isPan = activeTool==='pan' || e.shiftKey || e.button === 2;
    gesture = { id: e.pointerId, pan: isPan, anchor: worldPoint(e) };
    view.setPointerCapture(e.pointerId);
    if (!isPan) {
      if(activeTool==='fuel')placeFuel(e);
      else if(activeFire.power) {
        const at=powerPoint(e);
        if(at){solver.source=at;burst();}
        else message.textContent='Choose a floor point inside the simulation to cast this power.';
      } else {solver.source = locationPoint(e);burst();}
    }
  });
  on(view, 'pointermove', (e) => {
    if (!gesture || gesture.id !== e.pointerId) return;
    if (gesture.pan) {
      const at = worldPoint(e);
      pan[0] += gesture.anchor[0] - at[0];
      pan[1] += gesture.anchor[1] - at[1];
      sync();
    } else if(activeTool==='fuel')placeFuel(e);
    else if(activeFire.power) {
      const at=powerPoint(e);
      if(!at&&activeFire.power==='floor-trail')solver.powerTrailLast=null;
      if(at&&solver.active)solver.movePower(at,powerDirection(powers));
      markDirty();
    } else solver.source = locationPoint(e);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
    on(view, name, () => {
      gesture = null;
    });
  on(view, 'contextmenu', (e) => e.preventDefault());
  on(
    view,
    'wheel',
    (e) => {
      e.preventDefault();
      changeZoom(zoom * Math.exp(-Math.max(-250, Math.min(250, e.deltaY)) * 0.0015), e);
    },
    { passive: false },
  );
  const fullscreen = $('#fullscreen');
  const syncFullscreen = () => {
    const active = !!document.fullscreenElement;
    fullscreen.textContent = active ? 'Exit fullscreen' : 'Fullscreen';
    fullscreen.setAttribute('aria-pressed', String(active));
  };
  fullscreen.disabled = !document.fullscreenEnabled;
  fullscreen.onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.querySelector('main').requestFullscreen();
    } catch {
      message.textContent = 'Fullscreen is unavailable in this browser window.';
    }
    syncFullscreen();
  };
  on(document, 'fullscreenchange', syncFullscreen);
  syncFullscreen();
  on(window, 'keydown', (e) => {
    if (!scope.visible) return;
    if (e.ctrlKey || e.altKey || e.metaKey || e.repeat || e.target.matches('input,select,textarea'))
      return;
    if (e.code === 'Space' && !e.target.matches('button,a')) {
      e.preventDefault();
      if (benchmarkActive) cancelBenchmark = true;
      else {
        paused = !paused;
        sync();
      }
    }
    if (e.key.toLowerCase() === 'r') restart().catch(onFailure);
    if (e.key.toLowerCase() === 'b' && activeFire.power) {e.preventDefault();burst();}
    if (e.key === '0') $('#reset-view').click();
    if (e.key.toLowerCase() === 'f') $('#fullscreen').click();
    if (e.key === 'Escape') tool('fire');
  });
  function summary(samples) {
    // A mapped GPU timing can span several submitted frames. Count that
    // timing once rather than biasing the profile toward slow readbacks.
    const gpuSamples = [...new Map(samples
      .filter((sample) => sample.gpu && Number.isFinite(sample.gpuSampleFrame))
      .map((sample) => [sample.gpuSampleFrame, sample])).values()];
    const list = (key) =>
      samples
        .map(key)
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
    const stats = (a) =>
      a.length
        ? {
            median: a[Math.floor(a.length * 0.5)],
            p95: a[Math.floor(a.length * 0.95)],
            max: a.at(-1),
            mean: a.reduce((a, b) => a + b, 0) / a.length,
          }
        : null;
    return {
      build: 'fire-studio-rc-17',
      adapter: solver.adapter,
      grid: { velocity: solver.N, scalar: solver.D },
      settings: {
        simulation,
        render: [canvas.width, canvas.height],
        firePreset: activeFire.id,
        color: flameColor,
        embers,
        object: activeFire.object || null,
        fireLight,
        smokeOnly: smoke,
        fuel: $('#fuel').value,
        room: $('#room').checked,
        zoom,
        angle,
        lights: lightState(),
      },
      frames: samples.length,
      simulationToWallRatio:
        samples.length > 1
          ? (samples.at(-1).time - samples[0].time) /
            ((samples.at(-1).startedAt - samples[0].startedAt) / 1000)
          : null,
      frameIntervalMs: stats(
        samples
          .slice(1)
          .map((v, i) => v.startedAt - samples[i].startedAt)
          .filter(Number.isFinite)
          .sort((a, b) => a - b),
      ),
      wallMs: stats(list((x) => x.wall)),
      timingSamples: gpuSamples.length,
      simulationMs: stats(gpuSamples.map((x) => x.gpu.simulation).filter(Number.isFinite).sort((a,b) => a-b)),
      lightingMs: stats(gpuSamples.map((x) => x.gpu.lighting).filter(Number.isFinite).sort((a,b) => a-b)),
      renderMs: stats(gpuSamples.map((x) => x.gpu.render).filter(Number.isFinite).sort((a,b) => a-b)),
      last: samples.at(-1),
      errors: solver.errors,
    };
  }
  function configureFire() {
    if (!solver) return;
    solver.effect = [...activeFire.effect];
    solver.dynamics = [...activeFire.dynamics];
    solver.chemistry = [...activeFire.chemistry];
    solver.fuel = { gas: 0, wood: 0.35, oil: 1 }[$('#fuel').value];
    solver.smoke = !!activeFire.smokeSimulation || activeFire.id === 'smoke-burst';
    solver.objectId = activeFire.object || null;
    solver.ignition = activeFire.ignition === 'crown' ? 2 : activeFire.ignition === 'all' ? 1 : 0;
    solver.treeMoisture = activeFire.moisture || 'dry';
    solver.color = flameColor;
    solver.embers = embers;
    solver.powerDirection=powerDirection(powers);solver.powerStrength=powers.strength;
  }
  function advanceTest() {
    if (testScenario?.stopAfter && !testStopped && solver.time >= testScenario.stopAfter) {
      solver.active = false;
      testStopped = true;
      message.textContent =
        'Test: fuel stopped at ' +
        testScenario.stopAfter +
        ' s · watch the remaining smoke · Restart to repeat';
    }
  }
  function fireHelp() {
    $('#source-guide').disabled=activeFire.effect[0]!==10;
    $('#sigil-guide-control').hidden=activeFire.effect[0]!==10;
    const continuous = activeFire.effect[3] > 0.5;
    const power=powerDefinition(activeFire);
    $('#burst').textContent = power ? 'Cast power' : continuous ? 'Relight' : 'Trigger burst';
    $('#extinguish').textContent = power ? 'Stop power' : activeFire.object ? 'Stop ignition' : 'Stop fuel';
    message.textContent =
      activeFire.name +
      (continuous ? ' · drag to move the burning source' : ' · click to detonate');
    if (activeFire.object)
      message.textContent =
        activeFire.name + ' · surface heats, releases fuel and chars · Restart restores fuel';
    if(power)message.textContent=power.name+' · '+(power.continuous?'drag to move':'click or B to cast');
    canvas.setAttribute(
      'aria-label',
      activeFire.name + '. Drag to move the source, shift-drag to pan.',
    );
    $('#help').textContent = activeTool==='fuel'
      ? 'Click or drag across the floor to lay unlit fuel. Nearby flames or Ignite fuel ignite it. Fully lit reveals cold patches. Shift/right-drag pans; scroll zooms.' : power ? power.hint+' Shift/right-drag pans; scroll zooms.' : continuous
      ? (activeFire.object ? 'Drag to move the material. Stop ignition removes the starter; hot wood can keep burning. Restart restores fuel. Shift/right-drag pans; scroll zooms.' : 'Drag to move the burning source. Stop fuel lets the flame die. Shift/right-drag to pan; scroll to zoom.')
      : 'Click to detonate. Drag to place the next burst. Shift/right-drag to pan; scroll to zoom.';
  }
  function applyFire(id) {
    const preset = FIRE_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    if (benchmarkActive) cancelBenchmark = true;
    testScenario = null;
    testStopped = false;
    activeFire = preset;
    flameColor = preset.color || 'natural';
    $('#flame-color').value = flameColor;
    $('#preset').value = id;
    $('#fuel').value = preset.fuel;
    smoke = !!preset.smokeSimulation || id === 'smoke-burst';
    $('#smoke-only').checked = smoke;
    configureFire();
    if (solver) solver.source = sourceOrigin(preset);
    if(preset.power&&powerDefinition(preset)?.floor){$('#room').checked=true;}
    fireHelp();
    const url = new URL(location.href);
    url.searchParams.set('firePreset', id);
    url.searchParams.set('color', flameColor);
    url.searchParams.set('smoke', smoke ? '1' : '0');
    url.searchParams.set('fuel', preset.fuel);
    history.replaceState(null, '', url);
    return restart();
  }
  function setFireLight(value) {
    fireLight = Math.max(0, Math.min(80, Number(value) || 0));
    $('#fire-light').value = fireLight;
    $('#fire-light-value').value = fireLight.toFixed(0);
    if (!testScenario)
      try {
        localStorage.setItem('cybr-pyro-fire-light', String(fireLight));
      } catch {}
    markDirty();
  }
  $('#fire-light').oninput = (e) => setFireLight(e.target.value);
  setFireLight(fireLight);
  if (activeFire.smokeSimulation || activeFire.id === 'smoke-burst') smoke = true;
  $('#smoke-only').checked = smoke;
  fireHelp();
  async function save(name, body, type = 'json') {
    if (!params.has('qa')) return;
    await fetch('/capture/' + name + '.' + type, {
      method: 'POST',
      body: type === 'json' ? JSON.stringify(body) : body,
    });
  }
  async function snapshot(name) {
    const out = document.createElement('canvas');
    out.width = 960;
    out.height = 540;
    const source = document.createElement('canvas');
    source.width = canvas.width;
    source.height = canvas.height;
    source
      .getContext('2d')
      .putImageData(new ImageData(await solver.pixels(), source.width, source.height), 0, 0);
    out.getContext('2d').drawImage(source, 0, 0, 960, 540);
    const blob = await new Promise((resolve) => out.toBlob(resolve));
    await save(name, blob, 'png');
  }
  $('#benchmark').onclick = () => {
    benchmarkQueued = true;
  };
  async function benchmark() {
    if (busy || !solver) return;
    benchmarkQueued = false;
    benchmarkActive = true;
    cancelBenchmark = false;
    $('#benchmark').disabled = true;
    paused = true;
    busy = true;
    message.textContent = 'Measuring 180 completed GPU frames…';
    try {
      await solver.reset();
      triggerSource();
      for (let i = 0; i < 12 && scope.visible && !scope.disposed; i++) {
        solver.camera(viewUniform());
        await solver.frame();
      }
      await solver.reset();
      triggerSource();
      testStopped = false;
      if (testScenario) {
        solver.seed = 2;
        solver.source = sourceOrigin(activeFire);
      }
      const samples = [];
      const benchmarkStartedAt = performance.now();
      for (let i = 0; i < 180 && !cancelBenchmark && scope.visible && !scope.disposed; i++) {
        await new Promise(requestAnimationFrame);
        solver.camera(viewUniform());
        const item = await solver.frame();
        advanceTest();
        samples.push(item);
        if (i % 30 === 0) message.textContent = `Measurement ${i} / 180`;
      }
      await gpuSessionTimeout(solver.drain(), 'benchmark completion', 15000);
      const benchmarkElapsedMs = performance.now() - benchmarkStartedAt;
      if (!scope.visible || scope.disposed) cancelBenchmark = true;
      if (samples.length < 2) {
        message.textContent = 'Measurement cancelled before enough frames completed';
        return;
      }
      const completedBenchmark = !cancelBenchmark && samples.length === 180;
      const report = { ...summary(samples), trace: samples, drainedWallMs: benchmarkElapsedMs, completedBenchmark };
      const fps = samples.length * 1000 / benchmarkElapsedMs,
        passed = completedBenchmark && report.frameIntervalMs.p95 <= 1000 / 60 &&
          (samples.at(-1).time - samples[0].time) / (benchmarkElapsedMs / 1000) >= 0.99;
      report.meets60FpsBudget = passed;
      const gpuMean = [report.simulationMs, report.lightingMs, report.renderMs];
      metrics.textContent = (gpuMean.every(Boolean)
        ? 'GPU mean ' + gpuMean.reduce((sum, part) => sum + part.mean, 0).toFixed(1) + ' ms'
        : 'GPU timestamps unavailable') + ' · ' + report.last.time.toFixed(2) + ' s simulated';
      message.textContent = cancelBenchmark
        ? 'Measurement cancelled'
        : 'Measurement complete - ' + (passed ? '60 FPS gate passed' : '60 FPS gate not met');
      $('#gpu-status').textContent =
        `${runtimeStatus()}${solver.adapter.vendor} ${solver.adapter.architecture} - ${fps.toFixed(1)} drained FPS - submission p95 ${report.frameIntervalMs.p95.toFixed(1)} ms - simulation ${report.simulationToWallRatio.toFixed(2)}x realtime`;
      await save((params.get('qa') || 'bench') + '-benchmark', report);
    } catch (e) {
      message.textContent = e.message;
      console.error(e);
    } finally {
      paused = true;
      benchmarkActive = false;
      $('#benchmark').disabled = false;
      sync();
      releaseBusy();
    }
  }
  async function frame() {
    if (!scope.visible) {
      scope.schedule(frame);
      return;
    }
    if (!busy && resetQueued) await restart();
    if (!busy && benchmarkQueued) await benchmark();
    if (!busy && solver && (!paused || dirty)) {
      // A full GPU queue is a pacing signal, not a reason to hold this RAF
      // callback open until a fence resolves. Keep input and controls live.
      if (!solver.canSubmit()) {
        queueLimitedRafs++;
        scope.schedule(frame);
        return;
      }
      busy = true;
      const drawnRevision = revision;
      try {
        if (pendingOutput) {
          solver.resizeOutput(...pendingOutput);
          pendingOutput = null;
        }
        solver.smoke = !!activeFire.smokeSimulation || activeFire.id === 'smoke-burst';
        solver.camera(viewUniform());
        const result = await solver.frame(paused ? 0 : 1 / 60, { waitForCapacity: false });
        if (!result) {
          queueLimitedRafs++;
          scope.schedule(frame);
          return;
        }
        dirty = revision !== drawnRevision;
        if (!paused) {
          advanceTest();
          trace.push(result);
          if (!params.has('qa') && trace.length > 180) trace.shift();
          if (params.has('qa') && trace.length <= 5)
            await save(params.get('qa') + '-step-' + trace.length, result);
          if (++frameCount % 30 === 0) {
            const recent = trace.slice(-60),
              report = summary(recent);
            metrics.textContent = result.gpu
              ? `GPU sample ${((result.gpu.simulation || 0) + (result.gpu.lighting || 0) + (result.gpu.render || 0)).toFixed(1)} ms · ${solver.time.toFixed(2)} s`
              : `GPU timing pending · ${solver.time.toFixed(2)} s`;
            $('#gpu-status').textContent =
              `${runtimeStatus()}${solver.adapter.description || solver.adapter.device || solver.adapter.vendor} · frame cadence p95 ${report.frameIntervalMs?.p95.toFixed(1) || '—'} ms · simulation ${(report.simulationToWallRatio || 0).toFixed(2)}x realtime · pressure residual ${((result.postDivergence / Math.max(result.preDivergence, 0.00001)) * 100).toFixed(2)}% · ${result.substeps} substeps · ${queueLimitedRafs} queue-limited display ticks`;
            queueLimitedRafs = 0;
          }
          if (
            params.has('qa') &&
            params.has('sequence') &&
            solver.time >= 0.1 + captureIndex * 0.15
          ) {
            await snapshot(params.get('qa') + '-' + String(captureIndex++).padStart(2, '0'));
          }
          if (params.has('stop') && solver.time >= Number(params.get('stop')) && !saved) {
            saved = true;
            paused = true;
            sync();
            await snapshot(params.get('qa') || 'capture');
            await save(params.get('qa') || 'capture', { ...summary(trace.slice(30)), trace });
          }
        }
      } catch (e) {
        paused = true;
        message.textContent = e.message;
        console.error(e);
        sync();
        dirty = false;
        onFailure(e);
      } finally {
        releaseBusy();
      }
    }
    scope.schedule(frame);
  }
  try {
    solver = await PyroSolver.create(canvas, volumeOptions(params, simulation));
    solver.woodTimeScale = woodTimeScale;
    if (params.has('validate')) {
      const { pressureCheck } = await import('./pressure-check.js?v=54c82352661e679d');
      const report = await pressureCheck(solver.device);
      await save(params.get('qa') + '-pressure', report);
      if (!report.pass) throw Error('GPU pressure reference failed: ' + JSON.stringify(report));
    }
    configureFire();
    solver.source = sourceOrigin(activeFire);
    if(activeFire.power){
      if(powerDefinition(activeFire)?.floor){$('#room').checked=true;}
      solver.castPower(solver.source,powerDirection(powers),powers.strength);
    }
    fireHelp();
    sync();
    // Confirm that the first volume image actually finishes on this browser
    // GPU before the shell announces Ready. Some broken sessions accept a
    // device and pipelines but never complete a submitted frame.
    solver.camera(viewUniform());
    await solver.frame(1 / 60);
    await gpuSessionTimeout(solver.drain(), 'first presentation', 8000);
    presentationStatus();
    scope.schedule(frame);
  } catch (e) {
    resizeObserver.disconnect();
    await scope.stop();
    solver?.destroy();
    throw e;
  }

  return {
    castPower:()=>burst(),
    async dispose() {
      resizeObserver.disconnect();
      cancelBenchmark = true;
      await scope.stop();
      await Promise.allSettled([resetCompletion]);
      releaseBusy();
      solver?.destroy();
    },
    setVisible: scope.setVisible,
    fire: applyFire,
    snapshot: () => ({
      simulation,
      tool: activeTool,
      woodTimeScale,
      powers:{...powers},
      fire: activeFire.id,
      color: flameColor,
      embers,
      fuel: $('#fuel').value,
      smoke,
      sourceGuide: $('#source-guide').checked,
      fireLight,
      room: $('#room').checked,
      camera: { zoom, angle, pan: [...pan] },
    }),
    look(item) {
      if(item.powers)powers=normalizePowerSettings({...powers,...item.powers});
      if (item.woodTimeScale !== undefined) setWoodTime(item.woodTimeScale);
      if(typeof item.sourceGuide==='boolean')$('#source-guide').checked=item.sourceGuide;
      if (FIRE_COLORS.some((c) => c.id === item.color)) {
        flameColor = item.color;
        $('#flame-color').value = flameColor;
      }
      if (typeof item.embers === 'boolean') {
        embers = item.embers;
        $('#embers').checked = embers;
      }
      testScenario = item.test || null;
      testStopped = false;
      if (testScenario && solver) solver.seed = 2;
      if (item.fireLight !== undefined) setFireLight(item.fireLight);
      if (typeof item.room === 'boolean') {
        $('#room').checked = item.room;
        $('#room').dispatchEvent(new Event('change'));
      }
      if (item.fuel) $('#fuel').value = item.fuel;
      if (typeof item.smoke === 'boolean') {
        smoke = item.smoke;
        $('#smoke-only').checked = smoke;
      }
      if (item.camera) {
        zoom = item.camera.zoom ?? zoom;
        angle = item.camera.angle ?? angle;
        pan = [...(item.camera.pan ?? pan)];
      }
      configureFire();
      if (['fire', 'fuel', 'pan'].includes(item.tool)) tool(item.tool);
      sync();
    },
  };
}
