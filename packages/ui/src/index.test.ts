import { afterEach, describe, expect, it } from 'vitest';
import type { CaptureOptions } from 'optik-core';
import { instance, mount } from './index';

const NO_CAPTURE: CaptureOptions = {
  console: false,
  exceptions: false,
  rejections: false,
  resourceErrors: false,
  cspViolations: false,
  xhr: false,
  fetch: false,
  beacon: false,
  websocket: false,
  eventSource: false,
  resourceTiming: false,
};

afterEach(() => {
  instance()?.destroy();
  localStorage.clear();
  for (const host of document.querySelectorAll('[data-optik-root]')) host.remove();
});

describe('mount lifecycle', () => {
  it('deduplicates live mounts and keeps destroy idempotent across a remount', () => {
    const first = mount({ capture: NO_CAPTURE });
    expect(mount({ capture: NO_CAPTURE })).toBe(first);
    expect(document.querySelectorAll('[data-optik-root]')).toHaveLength(1);

    first.destroy();
    const second = mount({ capture: NO_CAPTURE });
    first.destroy();

    expect(instance()).toBe(second);
    expect(document.querySelectorAll('[data-optik-root]')).toHaveLength(1);
  });

  it('rolls back instrumentation and state when a plugin rejects mounting', () => {
    const originalLog = console.log;
    expect(() =>
      mount({
        passthrough: false,
        capture: { ...NO_CAPTURE, console: true },
        plugins: [{ id: '', label: 'invalid', render: () => document.createElement('div') }],
      }),
    ).toThrow('[optik] 插件必须提供 id 和 label');

    expect(console.log).toBe(originalLog);
    expect(instance()).toBeNull();
    expect(document.querySelector('[data-optik-root]')).toBeNull();
  });

  it('runs plugin show, hide, replacement, ejection, and disposal lifecycles', async () => {
    const events: string[] = [];
    const makePlugin = (name: string) => ({
      id: 'tools',
      label: name,
      render: () => {
        events.push(`${name}:render`);
        return document.createElement('div');
      },
      onShow: () => events.push(`${name}:show`),
      onHide: () => events.push(`${name}:hide`),
      onDispose: () => events.push(`${name}:dispose`),
    });
    const first = makePlugin('first');
    const second = makePlugin('second');
    const app = mount({
      capture: NO_CAPTURE,
      defaultOpen: true,
      defaultTab: 'plugin:tools',
      plugins: [first],
    });
    await Promise.resolve();
    expect(events).toEqual(['first:render', 'first:show']);

    app.hide();
    await Promise.resolve();
    app.show('plugin:tools');
    await Promise.resolve();
    app.use(second);
    await Promise.resolve();
    expect(app.eject('tools')).toBe(true);
    await Promise.resolve();

    expect(events).toEqual([
      'first:render',
      'first:show',
      'first:hide',
      'first:show',
      'first:hide',
      'first:dispose',
      'second:render',
      'second:show',
      'second:hide',
      'second:dispose',
    ]);
  });

  it('finishes teardown and clears the singleton even when cleanup throws undefined', () => {
    const app = mount({ capture: NO_CAPTURE });
    Object.defineProperty(app.kernel, 'dispose', {
      configurable: true,
      value: () => {
        throw undefined;
      },
    });
    let threw = false;
    try {
      app.destroy();
    } catch (error) {
      threw = true;
      expect(error).toBeUndefined();
    }

    expect(threw).toBe(true);
    expect(instance()).toBeNull();
    expect(document.querySelector('[data-optik-root]')).toBeNull();
  });
});
