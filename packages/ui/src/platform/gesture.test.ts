import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDraggable, onLongPress } from './gesture';

class FakePointerEvent extends Event {
  constructor(
    type: string,
    readonly pointerId: number,
    readonly clientX: number,
    readonly clientY: number,
    readonly button = 0,
    readonly isPrimary = true,
  ) {
    super(type, { bubbles: true, cancelable: true });
  }
}

function touchEvent(type: string, identifier: number, clientX: number, clientY: number): TouchEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
  Object.defineProperty(event, 'changedTouches', {
    value: [{ identifier, clientX, clientY }],
  });
  return event;
}

describe('makeDraggable', () => {
  beforeEach(() => vi.stubGlobal('PointerEvent', FakePointerEvent));
  afterEach(() => vi.unstubAllGlobals());

  it('waits for the threshold, reports deltas, and ignores non-primary pointers', () => {
    const element = document.createElement('div');
    Object.assign(element, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    });
    const onStart = vi.fn();
    const onMove = vi.fn();
    const onEnd = vi.fn();
    const dispose = makeDraggable(element, { threshold: 6, onStart, onMove, onEnd });

    element.dispatchEvent(new FakePointerEvent('pointerdown', 9, 0, 0, 1));
    element.dispatchEvent(new FakePointerEvent('pointerdown', 9, 0, 0, 0, false));
    element.dispatchEvent(new FakePointerEvent('pointerdown', 9, 0, 0));
    const small = new FakePointerEvent('pointermove', 9, 3, 2);
    element.dispatchEvent(small);
    expect(small.defaultPrevented).toBe(false);
    expect(onMove).not.toHaveBeenCalled();

    const drag = new FakePointerEvent('pointermove', 9, 8, 0);
    element.dispatchEvent(drag);
    element.dispatchEvent(new FakePointerEvent('pointermove', 9, 10, 4));
    element.dispatchEvent(new FakePointerEvent('pointerup', 9, 10, 4));

    expect(drag.defaultPrevented).toBe(true);
    expect(onStart).toHaveBeenCalledWith({ x: 8, y: 0, dx: 0, dy: 0 });
    expect(onMove).toHaveBeenNthCalledWith(2, { x: 10, y: 4, dx: 2, dy: 4 });
    expect(onEnd).toHaveBeenCalledWith({ x: 10, y: 4, dx: 0, dy: 0 }, true);
    dispose();
  });
});

describe('onLongPress', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fires for a primary pointer and cancels after movement', () => {
    vi.stubGlobal('PointerEvent', FakePointerEvent);
    const element = document.createElement('div');
    const handler = vi.fn();
    const dispose = onLongPress(element, { duration: 500, tolerance: 10, onLongPress: handler });

    element.dispatchEvent(new FakePointerEvent('pointerdown', 1, 4, 5));
    vi.advanceTimersByTime(500);
    expect(handler).toHaveBeenCalledWith({ clientX: 4, clientY: 5, target: element });

    element.dispatchEvent(new FakePointerEvent('pointerup', 1, 4, 5));
    element.dispatchEvent(new FakePointerEvent('pointerdown', 2, 0, 0));
    element.dispatchEvent(new FakePointerEvent('pointermove', 2, 20, 0));
    vi.advanceTimersByTime(500);
    expect(handler).toHaveBeenCalledOnce();
    dispose();
  });

  it('falls back to touch events and normalizes invalid timing options', () => {
    vi.stubGlobal('PointerEvent', undefined);
    const element = document.createElement('div');
    const handler = vi.fn();
    const dispose = onLongPress(element, {
      duration: Number.NaN,
      tolerance: -1,
      onLongPress: handler,
    });

    element.dispatchEvent(touchEvent('touchstart', 3, 7, 8));
    vi.advanceTimersByTime(499);
    expect(handler).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(handler).toHaveBeenCalledWith({ clientX: 7, clientY: 8, target: element });
    dispose();
  });
});
