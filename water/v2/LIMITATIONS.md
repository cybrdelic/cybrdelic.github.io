# Model boundary and incomplete work

This is a substantial rendering/spectral-water upgrade, NOT completion of every
research-scale architecture proposed in the discussion. Specifically:

* No persistent adaptive volumetric FLIP/APIC ocean, full 3D pressure projection,
  overturning liquid sheets, physically resolved air entrainment or general
  two-way solid boundary solve is implemented.
* The local field is a linear depth-averaged perturbation. It is separate from
  the spectral base, uses constant effective propagation depth, has sponge
  boundaries and does not prevent flow through scene rocks. Its finite-support
  source kernels have small discrete volume residuals. Surface clipping against
  terrain is rendering geometry, not a coastal wetting/drying flow solver.
* Floating-body hydrostatics are distributed probes, not integration of pressure
  over a resolved hull. Horizontal drag impulses feed back locally; complete
  3D fluid/body momentum/energy conservation is not claimed. Bow/stern wake
  height forcing, foam and particle emissions are unresolved-flow closures.
* Whitewater advection uses an approximate transport velocity. Bubbles include a
  deliberately placed emitter in the cove. Spray re-entry uses a cached local
  birth height, and rain contacts the nearly calm mean surface. Fine rain rings
  are superposed dispersive optical packets, not resolved droplet impacts.
* Scene-depth rays do not know all off-screen or hidden geometry. The floor cache
  handles floor misses, but not arbitrary occluded objects. Planar reflections
  do not follow the full displaced surface. Caustics are seafloor photon splats,
  not a fully converged 3D light-transport solution. Volume scattering is a
  single-scattering-inspired approximation; there is no measured water dataset.
* Temporal reconstruction uses first-order wave velocity and depth/history
  rejection, not an unbiased path-traced final frame. It can retain small
  aliasing/ghosting errors around complicated changing boundaries.
* A positive sampled horizontal Jacobian does not prove global nonintersection.
  Internal CPU/GPU tests do not constitute experimental validation of all water.
* Replay is fixed-seed/fixed-tick on the same backend. Multiplayer transport,
  rollback networking and cross-vendor bitwise GPU determinism are not delivered.
* The recordings are offline captures. No hardware-wide FPS or performance
  superiority over another product is claimed. No controlled Water Pro V3
  side-by-side study has been performed.
