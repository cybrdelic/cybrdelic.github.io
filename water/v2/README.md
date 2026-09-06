# CYBR WATER II — Water in motion

Original Three.js water-rendering and simulation prototype. This release includes
30 individually choreographed native-1080p shots, executable numerical checks,
a portable fixed-tick input journal and the capture pipeline. The movie is a
recording of this application, not stock footage or image-model output.

## Run

Node 20+ is sufficient for the bundled application and tests. No API key.

```sh
npm test
npm start
```

Open the server address printed by the start command. The public directory is a
static website. The complete source distribution includes the official Three.js
r180 dependency and prepared optical/material assets, so no package installation
is needed to run the demo. A WebGL2 browser with floating-point render targets
is required. Shader stages perform the numerical GPU work; this is not WebGPU.

## Controls and presets

Choose among 12 sea/scene states. Orbit with drag, dolly with the wheel, or use
cinematic/underwater/overhead cameras. Double-click intersects the current water
surface and injects a local impulse when inside the fixed 128 m interaction patch.
Space pauses, H hides the interface, N cycles six diagnostic fields. Checkboxes
isolate foam, spray/bubbles, rain, caustics, scene reflections and temporal resolve.
The extinction slider changes absorption/scattering without changing the waves.

`app.exportReplay()` returns the versioned input journal; `app.loadReplay(doc)`
restarts its scene with the original seed and fixed physical timestep. This is
same-backend replay, not an implemented multiplayer service or cross-GPU bitwise
lockstep. External code can call `app.engine.command(type,payload)` to schedule
an impulse, feature flag or extinction change on the next physical tick.

## Numerical architecture

Three nonoverlapping directional JONSWAP bands (768, 96, 12 m) evolve on GPU.
Eleven real fields per band are packed in paired complex IFFTs; the output
texture arrays contain displacement, exact spatial derivatives and exact time
derivatives. The composed horizontal Jacobian drives crest compression/foam.
Mip-filtered slopes and derivative-based roughness reduce distant aliasing.

A separate fixed-world 256² staggered-grid linear shallow-water perturbation
field receives impulses, rain contacts and horizontal rigid-body drag reactions.
Its open boundaries use an explicitly dissipative sponge. Distributed probe
hydrostatics and relative-flow drag move floating hulls in six degrees of freedom.
The wake includes an unresolved bow/stern pressure/foam closure. Numerical source
passes use One/One blending, not transparency-weighted visual blending.

The renderer uses true scene depth for refraction; it rejects above-water false
hits and unsupported depth discontinuities. Off-screen floor rays use a lit
world-space seafloor cache. Object reflections use a mean-plane camera, not
hardware ray tracing. RGB Beer attenuation follows viewing-path thickness.
The dielectric boundary supports underwater total internal reflection. A
photon-splat pass projects refracted sunlight onto the analytic seafloor. A
water-velocity motion buffer supports conservative temporal history reuse.

Whitewater has transported coverage, age and an entrainment proxy. Secondary
particles have ballistic spray and buoyant bubble states. Rain contacts also
create a fine optical band of gravity-capillary packets. See LIMITATIONS.md:
these are explicit unresolved-flow/optical approximations, not multiphase CFD.

## Rebuild original/generated assets

Prepared assets are already included. To regenerate them, obtain the exact
licensed sources in ATTRIBUTION.md into hdr/ and materials/, retain the original
micro.png and procedural storm.rgba16f, then run:

```sh
python -m pip install numpy scipy pillow opencv-python-headless
python tools/prepare_hdr.py
python tools/materials.py
python tools/foam_texture.py
python tools/bundle.py --output public/browser-bundle.html
python tools/bundle.py --assets --output public/standalone.html
```

## Reproduce the films

```sh
python -m pip install playwright
python -m playwright install chromium
python capture/render.py --shot 0 --width 1920 --height 1080 --fps 24
```

On headless Linux use Xvfb and the installed Mesa graphics drivers. Chrome,
Chromium or Playwright's bundled Chromium are supported. The example recorder
chooses software Mesa when hardware graphics is unavailable. The renderer runs
at its actual available speed, while capture advances physical time at 60 Hz
and exports 24 frames per second of playback. There is no interpolation or
upscaling; playback frame rate is not a real-time performance measurement.

Shot definitions live in capture/shots.json. Each recording contains per-second
telemetry, native frame hashes, wall-clock timings and any browser errors or
warnings. `--smoke --ids 0,6,12` renders a quick selected-scene gauntlet.

## Licensing

Project code: MIT. Three.js: its included MIT license. Photographic skies and
rock/sand material maps: CC0, credited in ATTRIBUTION.md. These inputs are lighting
and surface textures; the water, its motion and all footage are rendered by code.
