/** Schedule UI work for the next paint without trusting host-page frame shims. */
export function scheduleFrame(callback: () => void, fallbackDelay = 16): () => void {
  let active = true;
  let frame: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = () => {
    if (!active) return;
    active = false;
    frame = null;
    timer = undefined;
    callback();
  };

  const cancel = () => {
    if (!active) return;
    active = false;
    if (frame !== null && typeof cancelAnimationFrame === 'function') {
      try {
        cancelAnimationFrame(frame);
      } catch {
        // A hostile shim must not make component teardown fail.
      }
    }
    clearTimeout(timer);
    frame = null;
    timer = undefined;
  };

  if (typeof requestAnimationFrame === 'function') {
    try {
      const id = requestAnimationFrame(run);
      // A test shim may invoke synchronously; do not retain an already-fired id.
      if (active) frame = id;
      return cancel;
    } catch {
      // Fall through to a timer in incomplete WebViews.
    }
  }

  const delay = Number.isFinite(fallbackDelay) ? Math.max(0, fallbackDelay) : 16;
  timer = setTimeout(run, delay);
  return cancel;
}
