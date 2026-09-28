# CYBRDELIC Fire Studio

One page for fire, lighting, presets, and presentation. Every visible fire frame is simulated; source artwork and geometry are static assets.

## Published demo

https://cybrdelic.github.io/firesim/

## Run

Serve this directory over localhost or HTTPS. Do not open index.html through file://.

From the repository root:

    python -m http.server 8767 --directory outputs/cybrdelic-type

Open /elements/motion/bending/sigils/02/fire-live/.

- **Scene:** choose a simulation, source, and fuel; drag the source, pan, zoom, pause, and restart.
- **Library:** six complete demo scenes, sources, lighting, inspection tests, experiments, and saved looks.
- **Lighting:** the scene remains visible while you change the rig.
- **Present:** hides editing controls. Escape returns to the previous workspace view.
- **Include experiments:** exposes unfinished source studies in the Source picker. Every experiment also remains accessible in the library.

Saved looks stay in browser storage. Import/export uses version 1 JSON libraries; existing saved libraries remain compatible. Inspection lighting and cameras are temporary and restore when leaving a test.

## Demo entry

Open ?scene=demo-sigil&present=1 for the signature scene. Other repeatable entries:

- ?scene=demo-campfire
- ?scene=demo-torch
- ?scene=demo-ring
- ?scene=demo-bonfire — WebGPU required
- ?scene=demo-smoke — WebGPU required

The old pyro-gpu/ URL redirects into this same studio.

## Code map

| Module | Responsibility |
| --- | --- |
| studio.js | Serialized engine/preset transitions and shared look restoration |
| studio-location.js | Validated shared links and camera state |
| studio-ui.js | Workspace panels, presentation, startup and recovery UI |
| runtime-loader.js | Loads only the selected engine and its dependencies |
| runtime-scope.js | Animation/listener lifecycle; hidden, disposed, and failed runtimes stop |
| demo-presets.js | Curated demo scenes and experiment classification |
| inspection-state.js | Temporary inspection look capture/restore |
| look-storage.js | Saved-look validation, persistence, import/export |
| pyro-gpu/library.js | Shared library rendering and actions |
| scene-lights.js | Lighting catalog, controls, shared lighting values |
| fire.js and root shader helpers | Original WebGL simulation and rendering |
| pyro-gpu/app.js | Volume interaction, camera, playback, measurement |
| pyro-gpu/solver.js | GPU resources, simulation scheduling, renderer selection |
| pyro-gpu/shaders.js / renderer.js | Fluid and volume rendering WGSL |
| pyro-gpu/objects.js / forest-mesh.js | Finite surface fuel and reviewed tree geometry |

Original and Volume share the UI and library; they retain different simulation implementations. Ordinary volume sources do not allocate or render tree meshes/shadow targets. Tree resources are released when returning to normal fire. Bonfire and Hearth retain their original continuous-source parameters; finite log prototypes have separate IDs.

## Verify and package

From the repository root:

    node tools/fire-studio/studio.test.mjs
    node tools/fire-studio/normal-regression.test.mjs
    python tools/fire-studio/package.py --check
    python tools/fire-studio/package.py

The package script validates JavaScript syntax and static dependencies, copies an explicit runtime asset list, writes SHA-256 hashes in release.json, and creates a ZIP. Existing builds are never overwritten. Use --out releases/fire-studio-another-name for a subsequent build.

The package excludes historical experiment directories, build tools, raw mesh authoring data, and QA captures. Historical notes are preserved in docs/fire-studio/development-history.md in the source repository. Development reports remain under work/.

## Dense-volume transport fix (rc.2)

A Courant-aware monotonic correction replaces the discontinuous scalar fallback. Slow soot no longer repeatedly amplifies reverse-advection errors into a grid pattern. Faster flow keeps second-order correction within donor bounds. This is a transport change; there is no image blur, lower grid resolution, or extra render pass.

## State and code audit (rc.3)

URL fuel and camera settings survive startup and manual edits. Invalid camera inputs are bounded; partial looks preserve unspecified room/camera values. Original remembers its actual source across engine switches. Presentation state stays synchronized with the URL. Cached back/forward pages pause and resume instead of destroying their GPU runtime.

The shell owns source menus. The obsolete return button and unused engine-local library hook were removed; pressure validation loads on request. All shipped JavaScript modules are reachable from the runtime. Historical experiments remain outside the release package.

## Release status: candidate

The UI cleanup is verified on desktop and phone layouts. Original starts and renders in the tested in-app browser, with 30 rendered FPS observed during the check. This is not a sustained performance certification.

WebGPU playback was verified after the browser adapter recovered. The in-app browser selected Intel gen-12lp despite a high-performance adapter request. A 180-frame Bonfire measurement with the room enabled achieved 12.3 completed FPS, 122.6 ms frame p95, and 0.20x realtime simulation. This fails the 60 FPS gate. Native RTX 4060 shader timings describe a different adapter and do not establish browser performance. Sustained realtime performance on the demo machine remains a release gate.

Trees and blockout objects remain experiments. Tree moisture, local combustion, char, and leaf loss are present; physical branch fracture/collapse is not. No offline-quality-parity or guaranteed 60 FPS claim is made.
