import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleFrame } from './frame';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('scheduleFrame', () => {
  it('uses animation frames and cancels at most once', () => {
    const callbacks: FrameRequestCallback[] = [];
    const cancelFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return 7;
    });
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);
    const work = vi.fn();

    const cancel = scheduleFrame(work);
    cancel();
    cancel();
    callbacks[0]!(0);

    expect(cancelFrame).toHaveBeenCalledOnce();
    expect(cancelFrame).toHaveBeenCalledWith(7);
    expect(work).not.toHaveBeenCalled();
  });

  it('falls back when scheduling throws and normalizes the delay', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', () => {
      throw new Error('broken');
    });
    const work = vi.fn();

    scheduleFrame(work, -10);
    vi.advanceTimersByTime(0);
    expect(work).toHaveBeenCalledOnce();
  });

  it('contains cancellation errors and supports synchronous shims', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 3;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      throw new Error('broken cancel');
    });
    const work = vi.fn();
    const cancel = scheduleFrame(work, Number.NaN);

    expect(work).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(work).toHaveBeenCalledOnce();
    expect(cancel).not.toThrow();
  });
});
