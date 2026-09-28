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
| studio.js | Serialized engine/preset transitions, URL state, shared look restoration |
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

## Release status: candidate

The UI cleanup is verified on desktop and phone layouts. Original starts and renders in the tested in-app browser, with 30 rendered FPS observed during the check. This is not a sustained performance certification.

The current in-app browser session returns no WebGPU adapter. The volume shaders run successfully in native offscreen tests on the RTX 4060 Laptop GPU, but this does not establish browser FPS. Native full-frame timings exceeded the 60 FPS budget. Browser WebGPU playback and a sustained performance check on the demo machine remain release gates.

Trees and blockout objects remain experiments. Tree moisture, local combustion, char, and leaf loss are present; physical branch fracture/collapse is not. No offline-quality-parity or guaranteed 60 FPS claim is made.
