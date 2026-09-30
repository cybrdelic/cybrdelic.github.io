# CYBRDELIC Fire Studio

Interactive fire and smoke, source geometry, lighting and camera controls in one page. The GPU evolves the gas and renders the current volume. The runtime uses static emitter and geometry assets; it does not play a prerecorded fire animation.

[Hosted demo](https://cybrdelic.github.io/firesim/)

## Run locally

From the repository root:

```powershell
python -m http.server 8767 --directory outputs/cybrdelic-type
```

Open [Fire Studio](http://127.0.0.1:8767/elements/motion/bending/sigils/02/fire-live/). A packaged build can be served directly from its release directory. Use localhost or HTTPS; opening `index.html` as a file does not provide a supported graphics session.

## Use

- **Scene:** choose Original or experimental 3D volume, a source, fuel and color. Click to place fire and drag to move its source. Stop fuel lets the existing gas burn out; Restart replenishes the source.
- **Camera:** scroll to zoom; Shift-drag or right-drag pans. The controls also provide an angle slider and camera reset. Touch interaction and keyboard controls are described beside the scene.
- **Library:** choose a complete demo scene, an individual source, a lighting rig, an inspection test or a saved look. Tests use temporary lighting and camera settings.
- **Lighting:** adjust external light sources and approximate room bounce while the fire remains visible. Fire itself illuminates the gas, room and source props.
- **Present:** hide editing controls for a demo. Escape returns to the workspace.

Sources carry stable IDs across both simulations. Each engine implements them using its own flow and source model. Prototype object and burst studies are identified as experiments; the Include experiments control exposes them in the Source picker. Saved looks use local browser storage and version 1 JSON import/export.

Repeatable entries include `?scene=demo-sigil&present=1`, `?scene=demo-campfire`, `?scene=demo-torch`, `?scene=demo-ring`, `?scene=demo-bonfire` and `?scene=demo-smoke`. The last two select 3D volume. The older `pyro-gpu/` URL redirects into this same page and preserves its query settings.

## Graphics requirements and scope

Original requires WebGL 2, floating point render targets and linear filtering of float textures. 3D volume requires a working WebGPU adapter with sufficient texture and buffer limits. The page provides recovery controls when the selected engine cannot start. A WebGPU API being present does not establish that its adapter can submit frames.

Both engines transport heat, fuel and soot in evolving flow. Flame emission and extinction share their state with fire illumination. Original uses an atlas volume with a coarse pressure solve; 3D volume uses a dense MAC velocity field, multilevel pressure projection and a separate chemistry grid. These are visual combustion models with accelerated, uncalibrated coefficients. Creative colors are art direction.

Object studies use finite fuel, local heating and char. Volume trees use geometry from the CYBR forest scene and add moisture, leaf loss and widening of existing fissures. They do not simulate physical branch fracture or collapse. Volume embers are flow-driven tracers and cannot ignite new fuel; Original does not implement them. Original's object model does not reproduce Volume's per-voxel surface state. External illumination and room bounce are approximations, not converged path tracing or calibrated global illumination.

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
node tools/fire-studio/telemetry.test.mjs
node tools/fire-studio/check-volume-telemetry.mjs
node tools/fire-studio/check-volume-queries.mjs
node tools/fire-studio/check-tree-resize.mjs
python tools/fire-studio/package.test.py
python tools/fire-studio/package.py --check
python tools/fire-studio/package.py
```

Package validation executes Original initialization with a DOM/WebGL fixture and real source assets, the shared shell's engine/source transitions, Volume's actual reset functions with delayed GPU operation fixtures, its lighting bindings across normal/tree transitions, separate optical/transport mask ordering, and 10,000 display ticks with fixed quality and bounded GPU submissions. Those checks also run on the completed package and copied deployment directory. They check JavaScript behavior and resource ordering; they do not establish browser graphics or frame rate. The package also checks JavaScript syntax, local module/HTML/CSS/asset references, catalog previews and binary asset integrity, and rejects unreachable JavaScript. A content fingerprint normalizes module and asset cache keys in packaged files.

The output contains runtime assets, provenance metadata, a `release.json` file with SHA-256 hashes and open acceptance gates, and a ZIP. Historical experiment directories, build tools, raw mesh authoring inputs and QA captures are excluded. Existing builds are preserved; use `--out releases/fire-studio-another-name` for another build.

Deployment instructions and the demonstration checklist are in `docs/fire-studio/RELEASE.md` in the source repository. Development notes and measurements are retained in `docs/fire-studio/` and `work/` rather than presented as product guarantees.

## Current verification limits

Release packaging and automated state/lifecycle checks do not certify visual motion or sustained frame rate. The last recorded in-app browser selected Intel integrated graphics despite the high-performance adapter request. A September 27 short Original run observed about 30 rendered FPS; a 180-frame room-enabled Volume Bonfire run observed 12.3 completed FPS and 0.20 simulated seconds per wall second. These historical results fail the requested Volume performance gate and are not measurements of the latest edits.

The September 30 rc.10 native sustained-run tests verified the packed velocity border correction through 60 simulated seconds, with fixed simulation/render settings and preserved detail. Matched RTX late-window cost fell from 54.45 to 22.06 ms; the final Intel native minute still measured about 100 ms per completed frame. These are offscreen results, not browser FPS. Offline film detail parity, sustained 60 FPS, mobile support and the latest live-browser motion comparison remain unverified. See `docs/fire-studio/PERFORMANCE.md` and `VOLUME_SUSTAINED.md` for measurement conditions and `docs/fire-studio/RELEASE.md` for the remaining gates.

## Code map

| Module | Responsibility |
| --- | --- |
| `studio.js`, `studio-location.js` | Engine/preset transitions, shared state and URLs |
| `studio-ui.js`, `studio.css` | Workspace, presentation and recovery controls |
| `runtime-loader.js`, `runtime-scope.js` | Lazy engine loading and animation/listener cleanup |
| `demo-presets.js`, `source-picker.js`, `preset-pairs.js` | Demo collection and shared source selection |
| `look-storage.js`, `inspection-state.js` | Saved looks and temporary inspection settings |
| `scene-lights.js`, `pyro-gpu/library.js` | Lighting catalog and library actions |
| `fire.js` and root shader helpers | Original WebGL simulation and rendering |
| `pyro-gpu/app.js`, `solver.js` | Volume controls, GPU scheduling and diagnostics |
| `pyro-gpu/shaders.js`, `renderer.js` | Volume transport, combustion and volume/room rendering |
| `pyro-gpu/objects.js`, `forest-mesh.js` | Surface fuel and imported tree geometry |
