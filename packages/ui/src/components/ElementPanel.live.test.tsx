import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { CopyController } from './Copy';
import { ElementPanel } from './ElementPanel';

class FakeMutationObserver {
  static latest: FakeMutationObserver;
  readonly observe = vi.fn();
  readonly disconnect = vi.fn();

  constructor(readonly callback: MutationCallback) {
    FakeMutationObserver.latest = this;
  }

  emit(record: Partial<MutationRecord> & Pick<MutationRecord, 'target' | 'type'>): void {
    this.callback([record as MutationRecord], this as unknown as MutationObserver);
  }
}

describe('ElementPanel live DOM updates', () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let cleanup: (() => void) | undefined;
  let host: HTMLDivElement | undefined;
  let copy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    frames = new Map();
    nextFrame = 1;
    vi.stubGlobal('MutationObserver', FakeMutationObserver);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  });

  afterEach(() => {
    cleanup?.();
    host?.remove();
    document.querySelectorAll('[data-element-live-test],[data-optik-highlight]').forEach((node) =>
      node.remove(),
    );
    vi.unstubAllGlobals();
  });

  function mountPanel(): ShadowRoot {
    host = document.createElement('div');
    host.setAttribute('data-optik-root', '');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const point = document.createElement('div');
    shadow.appendChild(point);
    const copyText = vi.fn((_text: string, _label?: string) => true);
    copy = copyText;
    const copier: CopyController = {
      copy: copyText,
      reveal: vi.fn(),
      toast: () => null,
      sheet: () => null,
      closeSheet: vi.fn(),
    };
    cleanup = render(() => <ElementPanel copier={copier} />, point);
    return shadow;
  }

  it('batches host-page mutations and ignores mutations inside Optik', () => {
    const shadow = mountPanel();
    expect(FakeMutationObserver.latest.observe).toHaveBeenCalledWith(
      document.documentElement,
      expect.objectContaining({ subtree: true, childList: true, attributes: true }),
    );

    const added = document.createElement('section');
    added.id = 'live-target';
    added.setAttribute('data-element-live-test', '');
    document.body.appendChild(added);
    FakeMutationObserver.latest.emit({
      type: 'childList',
      target: document.body,
      addedNodes: [added] as unknown as NodeList,
      removedNodes: [] as unknown as NodeList,
    });
    FakeMutationObserver.latest.emit({ type: 'attributes', target: added });
    expect(frames.size).toBe(1);
    [...frames.values()][0]!(0);
    frames.clear();
    expect(shadow.textContent).toContain('live-target');

    FakeMutationObserver.latest.emit({
      type: 'childList',
      target: document.body,
      addedNodes: [host!] as unknown as NodeList,
      removedNodes: [] as unknown as NodeList,
    });
    FakeMutationObserver.latest.emit({
      type: 'characterData',
      target: host!.appendChild(document.createTextNode('internal')),
    });
    expect(frames.size).toBe(0);
  });

  it('disconnects the observer and cancels a queued refresh on cleanup', () => {
    mountPanel();
    FakeMutationObserver.latest.emit({ type: 'attributes', target: document.body });
    expect(frames.size).toBe(1);
    cleanup!();
    cleanup = undefined;
    expect(FakeMutationObserver.latest.disconnect).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });

  it('shows highlighted HTML and exposes bulk attribute/style copy actions', () => {
    const target = document.createElement('section');
    target.id = 'inspect-copy';
    target.setAttribute('data-role', 'card');
    target.setAttribute('data-element-live-test', '');
    document.body.appendChild(target);
    const shadow = mountPanel();

    const treeButton = [...shadow.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.includes('inspect-copy'),
    );
    treeButton!.click();
    const htmlButton = [...shadow.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === '查看 HTML',
    ) ?? [...shadow.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === 'HTML',
    );
    htmlButton!.click();

    expect(shadow.textContent).toContain('HTML');
    expect(shadow.querySelector('[data-code-token="tag"]')?.textContent).toBe('section');
    expect(shadow.querySelector('[data-code-token="attr"]')?.textContent).toBe('id');

    const attributeButtons = [...shadow.querySelectorAll('button')].filter(
      (candidate) => candidate.textContent?.trim() === '属性',
    );
    attributeButtons[attributeButtons.length - 1]!.click();
    shadow.querySelector<HTMLButtonElement>('[title="复制全部元素属性"]')!.click();
    expect(copy).toHaveBeenCalledWith(expect.stringContaining('data-role="card"'), '全部元素属性');
  });
});
