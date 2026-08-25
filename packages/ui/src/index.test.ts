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

  it('lets keyboard users resize the open panel and persists the result', () => {
    const app = mount({ capture: NO_CAPTURE, defaultOpen: true });
    const host = document.querySelector<HTMLElement>('[data-optik-root]')!;
    const separator = host.shadowRoot!.querySelector<HTMLElement>(
      '[aria-label="拖动调整面板高度"]',
    )!;

    expect(separator.getAttribute('role')).toBe('separator');
    expect(separator.tabIndex).toBe(0);
    expect(separator.getAttribute('aria-valuenow')).toBe('60');
    separator.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, composed: true }),
    );
    expect(separator.getAttribute('aria-valuenow')).toBe('65');
    expect(localStorage.getItem('optik:panel-height')).toBe('0.65');

    separator.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true, composed: true }),
    );
    expect(separator.getAttribute('aria-valuenow')).toBe('92');
    app.destroy();
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

    const host = document.querySelector<HTMLElement>('[data-optik-root]')!;
    expect(host.shadowRoot?.textContent).toContain('控制台');
    expect(host.shadowRoot?.textContent).not.toContain('插件渲染失败');

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

  it('rejects unknown initial and imperative tabs without entering a blank state', () => {
    expect(() =>
      mount({ capture: NO_CAPTURE, defaultTab: 'plugin:missing' }),
    ).toThrow('[optik] 未知标签页：plugin:missing');
    expect(instance()).toBeNull();

    const app = mount({ capture: NO_CAPTURE, defaultOpen: true });
    expect(() => app.show('typo')).toThrow('[optik] 未知标签页：typo');
    const host = document.querySelector<HTMLElement>('[data-optik-root]')!;
    expect(host.shadowRoot?.textContent).toContain('控制台');
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
