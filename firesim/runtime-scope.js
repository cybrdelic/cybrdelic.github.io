// Each runtime owns one loop and abortable listeners. Hidden views submit no GPU work.
export function runtimeScope(onError = console.error) {
  const abort = new AbortController();
  let id = 0,
    pending = new Set(),
    disposed = false,
    visible = true,
    callback,
    failed = false;
  function schedule(frame) {
    callback = frame;
    if (disposed || failed || !visible || document.hidden || id) return;
    id = requestAnimationFrame((now) => {
      id = 0;
      if (disposed || !visible || document.hidden) return;
      const task = Promise.resolve().then(() => frame(now));
      pending.add(task);
      task.then(
        () => pending.delete(task),
        (error) => {
          pending.delete(task);
          failed = true;
          cancelAnimationFrame(id);
          id = 0;
          onError(error);
        },
      );
    });
  }
  function visibility() {
    if (!visible || document.hidden) {
      cancelAnimationFrame(id);
      id = 0;
    } else if (callback) schedule(callback);
  }
  document.addEventListener('visibilitychange', visibility, { signal: abort.signal });
  return {
    get disposed() {
      return disposed;
    },
    get visible() {
      return visible && !document.hidden;
    },
    on(target, type, handler, options = {}) {
      target.addEventListener(type, handler, { ...options, signal: abort.signal });
    },
    schedule,
    setVisible(value) {
      visible = value;
      visibility();
    },
    async stop() {
      disposed = true;
      abort.abort();
      cancelAnimationFrame(id);
      await Promise.allSettled([...pending]);
    },
  };
}
