// Decay at a fixed simulation cadence. Tiny CFL substeps must not round every
// physical loss back to the same half-float density. No display-time fade.
export const SMOKE_DECAY_TICK = 1 / 30;
export const SMOKE_CLEAR_DENSITY = 0.00002;

export function advanceSmokeDecay(remainder, dt) {
  if(!Number.isFinite(remainder)||remainder<0||remainder>=SMOKE_DECAY_TICK+1e-12||!Number.isFinite(dt)||dt<0)
    throw Error('Invalid smoke decay interval.');
  const total=remainder+dt;
  const ticks=Math.floor((total+1e-12)/SMOKE_DECAY_TICK);
  return {decayDt:ticks*SMOKE_DECAY_TICK,remainder:Math.max(0,total-ticks*SMOKE_DECAY_TICK)};
}
