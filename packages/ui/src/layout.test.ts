import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'solid-js';
import { createLayout } from './layout';

afterEach(() => vi.unstubAllGlobals());

describe('createLayout compatibility', () => {
  it('uses legacy MediaQueryList listeners and cleans them up', () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addListener,
      removeListener,
      addEventListener: undefined,
    }));
    let dispose!: () => void;
    const layout = createRoot((cleanup) => {
      dispose = cleanup;
      return createLayout();
    });
    const element = document.createElement('div');
    Object.defineProperty(element, 'clientWidth', { value: 700 });
    layout.observe(element);
    expect(layout.wide()).toBe(true);
    expect(layout.dense()).toBe(true);
    expect(addListener).toHaveBeenCalledOnce();
    const listener = addListener.mock.calls[0]?.[0];

    dispose();
    expect(removeListener).toHaveBeenCalledWith(listener);
  });

  it('falls back to window events when ResizeObserver.observe throws', () => {
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        disconnect = disconnect;
        observe(): void {
          throw new Error('observer unavailable');
        }
      },
    );
    const add = vi.spyOn(globalThis, 'addEventListener');
    const remove = vi.spyOn(globalThis, 'removeEventListener');
    let dispose!: () => void;
    const layout = createRoot((cleanup) => {
      dispose = cleanup;
      return createLayout();
    });
    const element = document.createElement('div');
    layout.observe(element);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(add).toHaveBeenCalledWith('orientationchange', expect.any(Function));

    dispose();
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('orientationchange', expect.any(Function));
    add.mockRestore();
    remove.mockRestore();
  });

  it('degrades when matchMedia itself throws', () => {
    vi.stubGlobal('matchMedia', () => {
      throw new Error('query rejected');
    });
    let dispose!: () => void;
    const layout = createRoot((cleanup) => {
      dispose = cleanup;
      return createLayout();
    });
    expect(layout.dense()).toBe(false);
    dispose();
  });

  it('disconnects explicitly and contains a throwing cleanup shim', () => {
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    let dispose!: () => void;
    const layout = createRoot((cleanup) => {
      dispose = cleanup;
      return createLayout();
    });
    layout.observe(document.createElement('div'));
    layout.disconnect();
    layout.disconnect();
    expect(disconnect).toHaveBeenCalledOnce();
    dispose();

    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect(): void {
          throw new Error('broken disconnect');
        }
      },
    );
    createRoot((cleanup) => {
      const broken = createLayout();
      broken.observe(document.createElement('div'));
      expect(() => broken.disconnect()).not.toThrow();
      cleanup();
    });
  });
});
