# CYBRDELIC Fire Studio

Interactive fire and smoke, source geometry, lighting and camera controls in one page. The GPU evolves the gas and renders the current volume. The runtime uses static emitter and geometry assets; it does not play a prerecorded fire animation.

[Hosted demo](https://cybrdelic.github.io/firesim/)

The standard 3D volume path keeps dense flow, pressure, chemistry and reference lighting. **Sparse volume · experimental** is a third selection on the same page: it uses the Volume engine with pooled chemistry while keeping global flow, pressure and full voxel spacing. It retains dense fallback backing and has not established a speed or quality-equivalence advantage. See the [Sparse mode guide](https://github.com/cybrdelic/cybr-elements/blob/codex/fire-studio-release-rc6/docs/fire-studio/SPARSE_MODE.md) and [adaptive solver evidence](https://github.com/cybrdelic/cybr-elements/blob/codex/fire-studio-release-rc6/docs/fire-studio/ADAPTIVE_SOLVER.md) in the source repository.

## Run locally

From the repository root:

```powershell
python -m http.server 8767 --directory outputs/cybrdelic-type
```

Open [Fire Studio](http://127.0.0.1:8767/elements/motion/bending/sigils/02/fire-live/). A packaged build can be served directly from its release directory. Use localhost or HTTPS; opening `index.html` as a file does not provide a supported graphics session.

## Use

- **Scene:** choose Original, **3D volume · experimental** or **Sparse volume · experimental**, then a source, fuel and color. The two Volume modes share their source catalog. Click to place fire and drag to move its source. Stop fuel ends an emitter. On a solid object, Stop ignition removes the starter; hot material can keep burning. Restart replenishes the source.
- **Powers:** Source or Library → Powers contains 24 abilities, including fireballs, whips, meteors, walls and a flame serpent. Click to cast finite powers. Fireball, Heat seeker, Solar lance and Cinder scatter support hold to charge, drag to aim and release to cast. **Cast** or **B** runs the complete sequence. Four finite casts keep separate clocks and destinations. Rain, tornado, floor trail and breath are the four sustained powers; drag to move their active source and Stop power ends fresh fuel. Released gas keeps evolving. Floor trails consume finite deposited oil.
- **Power aim:** strength, heading and elevation apply to the next finite cast; directional floor attacks use heading. Sustained power settings remain live. Pause or Space freezes charge, source motion and recovery. Saved looks and shared links retain the selected ability, strength and aim across simulations.
- **Camera:** scroll to zoom; Shift-drag or right-drag pans. The controls also provide an angle slider and camera reset. Touch interaction and keyboard controls are described beside the scene.
- **Library:** choose a complete demo scene, an individual source, a lighting rig, an inspection test or a saved look. Tests use temporary lighting and camera settings.
- **Lighting:** adjust external light sources and approximate room bounce while the fire remains visible. Fire itself illuminates the gas, room and source props.
- **Fully lit:** choose **Fully lit · neutral** in Lighting or the library to inspect the room, source surfaces and cold smoke with broad white lights.
- **Show sigil:** on a CYBR sigil source, show or hide the artwork overlay. The wooden CYBR source has its own solid, combustible geometry; hiding the overlay does not remove that wood.
- **Wood time:** set material ageing from 1× to 24×; the default is 12×. Drying, pyrolysis and damage accelerate while fluid flow and falling pieces keep real time. Stop ignition ends the starter; it does not instantly cool hot wood. Restart restores the material.
- **Drop fuel:** in either engine, select this tool and click or drag on the floor inside the simulation area. It enables Room and places finite, unlit patches. Nearby flame can ignite them; **Ignite fuel** applies one ignition pulse. **Clear fuel** removes the patches and floor burn marks while existing gas and smoke continue. **Restart** resets the simulation and placed fuel.
- **Smoke clearance:** after fuel stops, leave the simulation playing so smoke can rise, spread and gradually clear. A burning source continually replenishes smoke. Pause freezes it; char and floor burn marks remain until cleared or restarted. Smoke-only sources keep placed fuel unlit; choose a fire source to ignite it.
- **Present:** hide editing controls for a demo. Escape returns to the workspace.

The [fuel and inspection guide](https://github.com/cybrdelic/cybr-elements/blob/codex/fire-studio-release-rc6/docs/fire-studio/FUEL_AND_INSPECTION.md) describes these controls and their verification scope.

Sources carry stable IDs across both engines. Each engine implements them using its own flow and source model. Prototype object and burst studies are identified as experiments; the Include experiments control exposes them in the Source picker. Saved looks use local browser storage and version 1 JSON import/export.

Sparse volume keeps the same lighting, camera, smoke, Show sigil and floor-fuel controls. Shared URLs and saved looks retain the selected mode. Placed fuel and evolving gas are transient simulation state, not saved-look contents. If sparse storage reaches its capacity or safety limit, chemistry continues in dense storage until Restart.

A sparse inspection entry is `?simulation=sparse&firePreset=sigil-cybr&room=1&lighting=fully-lit&guide=1`. Older `simulation=volume&bricks=1` links select the same mode and are rewritten to the canonical sparse URL.

Repeatable entries include `?scene=demo-sigil&present=1`, `?scene=demo-campfire`, `?scene=demo-torch`, `?scene=demo-ring`, `?scene=demo-bonfire` and `?scene=demo-smoke`. The last two select 3D volume. The older `pyro-gpu/` URL redirects into this same page and preserves its query settings.

## Graphics requirements and scope

Original requires WebGL 2, floating point render targets and linear filtering of float textures. Both Volume modes require a working WebGPU adapter with sufficient texture and buffer limits. Sparse volume retains the **384 MiB** dense chemistry backing and adds a **96 MiB** chemistry atlas; other GPU resources add to that total. This is not a mobile memory reduction. The page provides recovery controls when the selected engine cannot start. A WebGPU API being present does not establish that its adapter can submit frames.

Both engines transport heat, fuel and soot in evolving flow. Flame emission and extinction share their state with fire illumination. Original uses an atlas volume with a coarse pressure solve; 3D volume uses a dense MAC velocity field, multilevel pressure projection and a separate chemistry grid. These are visual combustion models with accelerated, uncalibrated coefficients. Creative colors are art direction.

Volume's optional precise receiver lighting computes incident illumination only where soot can receive it. Every positive-soot interpolation footprint remains covered, while camera and shadow support keep their existing full halo. The light texture, ray samples and lighting formulas are unchanged; inactive light texels are cleared on every lighting refresh. This is a lighting optimization, not a reduction in simulation detail.

The tree, logs, timber house and wooden CYBR sigil share finite virgin wood, moisture, char, surface/core heat, grain-dependent conduction and structural damage. The reviewed CYBR tree retains every original triangle. Weakened beam partitions detach under bending, axial and shear loads; capped faces expose continuous rest-space grain. Original uses a projected material inventory; Volume uses a 64³ material proxy. This reduced beam model does not resolve arbitrary fracture, redundant joints, buckling or fragment-to-fragment contact. Dropped wood uses the same chemistry as a finite floor patch, without rigid lumber pieces. Wood time accelerates drying, conversion and damage separately from gas and falling pieces. Volume embers are one-way flow tracers; they do not subtract wood mass or ignite new fuel. External illumination and room bounce are approximations, not converged path tracing or calibrated global illumination.

## Development options

These switches use the same page, controls and library. Sparse volume enables the chemistry pool only; it does not also enable coarse/fine flow, pressure work lists or lighting experiments. The independent switches remain available to compare components against their references.

| Query setting | Effect | Release status |
| --- | --- | --- |
| `solver=adaptive` | Global 64³ flow with local 128³ overrides and sticky dense fallback | Experimental; disabled by default |
| `bricks=1` | Direct chemistry atlas, stable page ownership and a lossless transition to dense fallback | Experimental; selected by Sparse volume; off in standard 3D volume |
| `pressureWork=1` | Exact fine pressure smoothing work lists within the global hierarchy | Experimental; disabled by default |
| `lightWork=1` | Generic compact incident-light work queue | Experimental; disabled by default; overrides precise receivers |
| `receivers=1` | Precise incident-light receivers with identical tested pixels | Experimental; disabled pending stable complete-frame cost gate |

All five mark the engine as experimental. Historical native RTX 60-frame host-command replays found flow, pool and combined candidates slower than the dense reference. Atlas filtering also left an unresolved quality-equivalence gate. The Sparse selection has not established a sustained browser performance advantage. These options have not passed the replacement gate. Simulation spacing, ray detail and reaction coefficients do not adapt downward.

## Verify and package

Run from the repository root:

```powershell
node tools/fire-studio/studio.test.mjs
node tools/fire-studio/studio-polish.test.mjs
node tools/fire-studio/normal-regression.test.mjs
node tools/fire-studio/original-startup.test.mjs
node tools/fire-studio/control-transition.test.mjs
node tools/fire-studio/volume-reset.test.mjs
node tools/fire-studio/volume-lighting.test.mjs
node tools/fire-studio/volume-optical-mask.test.mjs
node tools/fire-studio/volume-longrun.test.mjs
node tools/fire-studio/adaptive-flow.test.mjs
node tools/fire-studio/adaptive-pressure.test.mjs
node tools/fire-studio/brick-pool.test.mjs
node tools/fire-studio/pooled-coupling.test.mjs
node tools/fire-studio/lighting-work.test.mjs
node tools/fire-studio/adaptive-runtime.test.mjs
node tools/fire-studio/adaptive-lifecycle.test.mjs
node tools/fire-studio/fuel-ground.test.mjs
node tools/fire-studio/floor-fuel.test.mjs
node tools/fire-studio/sigil-guide.test.mjs
node tools/fire-studio/scene-light-presets.test.mjs
node tools/fire-studio/smoke-lifecycle.test.mjs
node tools/fire-studio/original-smoke.test.mjs
node tools/fire-studio/simulation-modes.test.mjs
node tools/fire-studio/simulation-look.test.mjs
node tools/fire-studio/sparse-app.test.mjs
node tools/fire-studio/telemetry.test.mjs
node tools/fire-studio/check-volume-telemetry.mjs
node tools/fire-studio/check-volume-queries.mjs
node tools/fire-studio/check-tree-resize.mjs
python tools/fire-studio/package.test.py
python tools/fire-studio/package.py --check
python tools/fire-studio/package.py
```

Package validation executes Original initialization with a DOM/WebGL fixture and real source assets, the shared shell's engine/source transitions, Volume's actual reset functions with delayed GPU operation fixtures, its lighting bindings across normal/tree transitions, separate optical/transport mask ordering, and 10,000 display ticks with fixed quality and bounded GPU submissions. Those checks also run on the completed package and copied deployment directory. They check JavaScript behavior and resource ordering; they do not establish browser graphics or frame rate. The package also checks JavaScript syntax, local module/HTML/CSS/asset references, catalog previews and binary asset integrity, and rejects unreachable JavaScript. A content fingerprint normalizes module and asset cache keys in packaged files.

Package validation also executes the seven adaptive fixtures listed above against source, the completed build and directory verification. They record actual host methods, fixed resource lifetimes, pool ownership/migration, dense fallback, independent lighting support, restart and disposal. Set `FIRE_STUDIO_ROOT` to a build directory to run these fixtures against packaged modules. Their CPU recording checks are separate from native shader, field and pixel comparisons.

The packaged runtime checks include **35 runners**. All **295 CPU tests** pass, including shared abilities, cast/charge/release ordering, four-slot reuse, saved first casts, bounded impact targets and the rotated crescent regression. Exact recorded Volume/Sparse coverage passes strict Dawn/Tint compilation with **211 unique WGSL modules / 1,655 variants**, zero errors or warnings; the deliberately divergent derivative control is rejected. This uses the null backend with no physical GPU work. Wood shader helpers are derivative-free, and Sparse reports compiler failures before pipeline creation. Native execution, visual review, live browser pacing and mobile acceptance are separate gates. See the [power guide](https://github.com/cybrdelic/cybr-elements/blob/codex/fire-studio-release-rc6/docs/fire-studio/FIRE_POWERS.md) and release evidence for scope.

The output contains runtime assets, provenance metadata, a `release.json` file with SHA-256 hashes and open acceptance gates, and a ZIP. Historical experiment directories, build tools, raw mesh authoring inputs and QA captures are excluded. Existing builds are preserved; use `--out releases/fire-studio-another-name` for another build.

Deployment instructions and the demonstration checklist are in `docs/fire-studio/RELEASE.md` in the source repository. Development notes and measurements are retained in `docs/fire-studio/` and `work/` rather than presented as product guarantees.

## Current verification limits

Release packaging and automated state/lifecycle checks do not certify visual motion or sustained frame rate. Historical browser measurements and adapter selection are retained in `docs/fire-studio/PERFORMANCE.md`; they do not measure the current release candidate.

Original's late cooling reaction fronts can retain facets from its coarse depth grid, including phoenix follow-through. Sampling, reconstruction and reaction alternatives were rejected and reverted; this artifact has not been removed. Targeted Volume review accepts a compact serpent body and softer flame core as current visual limits. Final complete native review, offline parity, browser and mobile pacing remain open.

The September 30 rc.10 native sustained-run tests verified the packed velocity border correction through 60 simulated seconds, with fixed simulation/render settings and preserved detail. Matched RTX late-window cost fell from 54.45 to 22.06 ms; the final Intel native minute still measured about 100 ms per completed frame. The optional precise receiver path subsequently lowered the measured lighting stage cost by 8.7–14.2% on Intel UHD and 6.7–8.3% on RTX 4060, including support generation. All 34 paired real/synthetic views were pixel-identical. Actual host-command replays also matched reference chemistry and image hashes on both adapters. Held production lighting was also faster at 0.4 and 2 simulated seconds with identical pixels. Complete-frame timings varied sharply in unchanged physics kernels and did not establish a reliable speedup, so receivers remain opt-in. These are native offscreen stage and correctness results, not whole-solver speedups or browser frame-rate measurements. The newer 60-frame adaptive replays cover one simulated second, not the earlier 60-second sustained test.

Offline film detail parity, sustained browser pacing, mobile support and the latest live-browser motion comparison remain unverified. See the [adaptive solver report](https://github.com/cybrdelic/cybr-elements/blob/codex/fire-studio-release-rc6/docs/fire-studio/ADAPTIVE_SOLVER.md), `docs/fire-studio/PERFORMANCE.md` and `VOLUME_SUSTAINED.md` for measurement conditions, and `docs/fire-studio/RELEASE.md` for the remaining gates.

## Code map

| Module | Responsibility |
| --- | --- |
| `studio.js`, `studio-location.js`, `simulation-modes.js` | Same-page mode/preset transitions, shared state and URLs |
| `studio-ui.js`, `studio.css` | Workspace, presentation and recovery controls |
| `runtime-loader.js`, `runtime-scope.js` | Lazy engine loading and animation/listener cleanup |
| `demo-presets.js`, `source-picker.js`, `preset-pairs.js` | Demo collection and shared source selection |
| `look-storage.js`, `inspection-state.js` | Saved looks and temporary inspection settings |
| `scene-lights.js`, `pyro-gpu/library.js` | Lighting catalog and library actions |
| `fire.js` and root shader helpers | Original WebGL simulation and rendering |
| `fire-power-definitions.js`, `fire-abilities.js`, `fire-powers.js`, `fire-ability-motions.js` | Shared 24-ability timing, four-cast pool, bounded fuel/momentum and source support |
| `pyro-gpu/app.js`, `solver.js` | Volume controls, GPU scheduling and diagnostics |
| `pyro-gpu/shaders.js`, `renderer.js` | Volume transport, combustion and volume/room rendering |
| `pyro-gpu/lighting-work.js` | Optional precise incident-light receiver support and generic work queue |
| `pyro-gpu/adaptive-flow.js` | Optional global coarse/local fine flow and sticky dense fallback |
| `pyro-gpu/adaptive-pressure.js` | Optional exact fine smoothing work lists; pressure remains global |
| `pyro-gpu/brick-pool.js`, `pooled-coupling.js` | Optional fixed chemistry pool, generation-safe sampling, migration and shared consumers |
| `pyro-gpu/objects.js`, `forest-mesh.js` | Surface fuel and imported tree geometry |
| `wood-thermo.js`, `wood-material.js` | Shared finite material chemistry and rest-space wood appearance |
| `wood-state-gl.js`, `wood-structure-gl.js`, `wood-structure.js` | Material inventory, beam loading, failure and rigid fragment poses |
| `pyro-gpu/wood-flux.js`, `wood-collision.js` | Finite exterior fuel transfer and moving fragment collision support |
| `fuel-ground.js`, `ground-fuel-gl.js`, `pyro-gpu/floor-fuel.js` | Shared floor input, finite inventory, ignition, char and floor material |
| `pyro-gpu/sigil-guide.js` | Visible CYBR artwork using the native source contour |
