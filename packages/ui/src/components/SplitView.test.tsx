import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import { LayoutProvider, type Layout } from '../layout';
import { SplitView } from './SplitView';

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  localStorage.clear();
});

function renderSplit(): { host: HTMLDivElement; separator: HTMLElement } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const layout: Layout = { wide: () => true, dense: () => true };
  disposers.push(
    render(
      () => (
        <LayoutProvider value={layout}>
          <SplitView
            list={<div>列表</div>}
            detail={<div>详情</div>}
            hasDetail
            placeholder="请选择"
            storageKey="optik:test-split"
          />
        </LayoutProvider>
      ),
      host,
    ),
    () => host.remove(),
  );
  return { host, separator: host.querySelector('[role="separator"]') as HTMLElement };
}

describe('SplitView keyboard resizing', () => {
  it('exposes range semantics and persists arrow, Home, and End adjustments', () => {
    localStorage.setItem('optik:test-split', '0.4');
    const { host, separator } = renderSplit();

    expect(separator.tabIndex).toBe(0);
    expect(separator.getAttribute('aria-valuenow')).toBe('40');

    separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(separator.getAttribute('aria-valuenow')).toBe('42');
    expect(localStorage.getItem('optik:test-split')).toBe('0.42');
    expect(host.querySelector<HTMLElement>('.min-w-0.h-full')?.style.width).toBe('42%');

    separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(separator.getAttribute('aria-valuenow')).toBe('75');
    separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(separator.getAttribute('aria-valuenow')).toBe('75');

    separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(separator.getAttribute('aria-valuenow')).toBe('20');
  });

  it('uses a larger keyboard step with Shift', () => {
    const { separator } = renderSplit();
    separator.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }),
    );
    expect(separator.getAttribute('aria-valuenow')).toBe('26');
  });
});
