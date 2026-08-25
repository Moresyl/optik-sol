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
});
