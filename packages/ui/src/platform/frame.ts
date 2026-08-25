/** Schedule UI work for the next paint without trusting host-page frame shims. */
export function scheduleFrame(callback: () => void, fallbackDelay = 16): () => void {
  let active = true;
  let frame: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let scheduling = false;
  let firedSynchronously = false;

  const run = () => {
    if (!active) return;
    // requestAnimationFrame is specified as asynchronous, but host pages can replace
    // it. Preserve our own async contract so callers may safely store the canceler.
    if (scheduling) {
      firedSynchronously = true;
      return;
    }
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
      scheduling = true;
      const id = requestAnimationFrame(run);
      scheduling = false;
      if (firedSynchronously) timer = setTimeout(run, 0);
      else frame = id;
      return cancel;
    } catch {
      scheduling = false;
      // Fall through to a timer in incomplete WebViews.
    }
  }

  const delay = Number.isFinite(fallbackDelay) ? Math.max(0, fallbackDelay) : 16;
  timer = setTimeout(run, delay);
  return cancel;
}
