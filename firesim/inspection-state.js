// Inspection scenes temporarily override the normal fire's presentation.
// Leaving a test restores the normal view instead of leaking its lighting.
import { runtimeFamily } from './simulation-modes.js?v=467fdf306aa8ace5';
export function inspectionState(storage) {
  const key = 'cybr-fire-inspection-return-v1';
  let active = false,
    prior = null;
  try {
    const saved = JSON.parse(storage?.getItem(key));
    if (saved && saved.version === 1) prior = saved;
  } catch {}
  const persist = () => {
    try {
      if (prior) storage?.setItem(key, JSON.stringify(prior));
      else storage?.removeItem(key);
    } catch {}
  };
  return {
    enter(snapshot, engine) {
      if (!active && !prior) {
        prior = {
          version: 1,
          engine,
          lights: snapshot.lights,
          fireLight: snapshot.fireLight,
          room: snapshot.room,
          camera: snapshot.camera,
        };
        persist();
      }
      active = true;
    },
    leave(engine, explicitLook = false) {
      if (!active && !prior) return null;
      const restore = explicitLook ? null : prior;
      active = false;
      prior = null;
      persist();
      if (!restore) return null;
      // Camera models differ between Original and Volume.
      if (restore.engine && runtimeFamily(restore.engine) !== runtimeFamily(engine)) delete restore.camera;
      return restore;
    },
    get active() {
      return active;
    },
  };
}
