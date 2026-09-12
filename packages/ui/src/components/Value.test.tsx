import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { ObjectRegistry, getProperties, toRemoteObject } from 'optik-core';
import type { OptikKernel } from 'optik-core';
import { ValueView, type ValueDomain } from './Value';

describe('ValueView object handle lifecycle', () => {
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames[id - 1] = () => undefined;
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('releases every child handle borrowed while expanding', () => {
    const registry = new ObjectRegistry();
    const root = toRemoteObject({ child: { value: 1 }, getter: () => 1 }, registry);
    const domain: ValueDomain = {
      registry,
      getProperties: (objectId, options) => getProperties(objectId, registry, options),
    };
    const host = document.createElement('div');
    const dispose = render(
      () => (
        <ValueView
          value={root}
          kernel={{ log: domain } as unknown as OptikKernel}
          domain={domain}
          defaultExpanded
        />
      ),
      host,
    );

    expect(frames).toHaveLength(1);
    frames[0]!(0);
    expect(registry.size).toBeGreaterThan(1);

    dispose();
    expect(registry.size).toBe(1);
    registry.release(root.objectId!);
    expect(registry.size).toBe(0);
  });

  it('labels unevaluated getters without reading them and releases their handles', () => {
    const registry = new ObjectRegistry();
    const getter = vi.fn(() => 'private value');
    const object = Object.defineProperty({}, 'computed', { enumerable: true, get: getter });
    const root = toRemoteObject(object, registry);
    const domain: ValueDomain = {
      registry,
      getProperties: (id, options) => getProperties(id, registry, options),
    };
    const host = document.createElement('div');
    const dispose = render(() => <ValueView value={root} kernel={{ log: domain } as unknown as OptikKernel} domain={domain} defaultExpanded />, host);
    try {
      frames[0]!(0);
      expect(host.textContent).toContain('取值器，未求值');
      expect(host.textContent).not.toContain('private value');
      expect(getter).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
    expect(registry.size).toBe(1);
    registry.release(root.objectId!);
    expect(registry.size).toBe(0);
  });

  it('cancels a queued expansion when unmounted before the next frame', () => {
    const registry = new ObjectRegistry();
    const root = toRemoteObject({ child: {} }, registry);
    const getPropertiesSpy = vi.fn((objectId: string) => getProperties(objectId, registry));
    const domain: ValueDomain = { registry, getProperties: getPropertiesSpy };
    const host = document.createElement('div');
    const dispose = render(
      () => (
        <ValueView
          value={root}
          kernel={{ log: domain } as unknown as OptikKernel}
          domain={domain}
          defaultExpanded
        />
      ),
      host,
    );

    dispose();
    frames[0]!(0);
    expect(getPropertiesSpy).not.toHaveBeenCalled();
    expect(registry.size).toBe(1);
  });

  it('contains domain expansion failures and allows a retry', () => {
    const registry = new ObjectRegistry();
    const root = toRemoteObject({ value: 1 }, registry);
    const getPropertiesSpy = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('transport disconnected');
      })
      .mockReturnValueOnce([]);
    const domain: ValueDomain = { registry, getProperties: getPropertiesSpy };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(
      () => (
        <ValueView
          value={root}
          kernel={{ log: domain } as unknown as OptikKernel}
          domain={domain}
          defaultExpanded
        />
      ),
      host,
    );

    expect(() => frames[0]!(0)).not.toThrow();
    expect(host.textContent).toContain('展开失败，请收起后重试');
    const toggle = host.querySelector<HTMLButtonElement>('[aria-label="收起"]')!;
    toggle.click();
    const collapsed = host.querySelector<HTMLButtonElement>('button')!;
    expect(collapsed.getAttribute('aria-expanded')).toBe('false');
    collapsed.click();
    frames[1]!(0);
    expect(host.textContent).not.toContain('展开失败');
    expect(host.textContent).toContain('无自有属性');

    dispose();
    host.remove();
    registry.release(root.objectId!);
  });

  it('expands object values from keyboard activation without making primitives focusable', () => {
    const registry = new ObjectRegistry();
    const root = toRemoteObject({ answer: 42 }, registry);
    const domain: ValueDomain = { registry, getProperties: (id, options) => getProperties(id, registry, options) };
    const host = document.createElement('div');
    const dispose = render(() => <ValueView value={root} kernel={{ log: domain } as unknown as OptikKernel} domain={domain} />, host);
    const value = host.querySelector<HTMLElement>('[role="button"]')!;
    expect(value.tabIndex).toBe(0);
    expect(value.getAttribute('aria-expanded')).toBe('false');
    value.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    frames[0]!(0);
    expect(host.textContent).toContain('answer');
    expect(host.querySelector('[data-type="number"]')?.textContent).toBe('42');
    expect(value.getAttribute('aria-expanded')).toBe('true');
    value.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true }));
    expect(value.getAttribute('aria-expanded')).toBe('true');
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    value.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(true);
    expect(value.getAttribute('aria-expanded')).toBe('false');
    const primitiveHost = document.createElement('div');
    const primitive = toRemoteObject(42, registry);
    const disposePrimitive = render(() => <ValueView value={primitive} kernel={{ log: domain } as unknown as OptikKernel} domain={domain} />, primitiveHost);
    expect(primitiveHost.querySelector('[role="button"]')).toBeNull();
    disposePrimitive();
    dispose();
    expect(registry.size).toBe(1);
    registry.release(root.objectId!);
    expect(registry.size).toBe(0);
  });
});
