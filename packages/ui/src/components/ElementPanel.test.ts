import { afterEach, describe, expect, it, vi } from 'vitest';
import { escapeCssIdentifier, Highlighter, scrollToElement, selectorFor } from './ElementPanel';

afterEach(() => {
  document.querySelectorAll('[data-element-panel-test],[data-optik-highlight]').forEach((node) =>
    node.remove(),
  );
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('element selector generation', () => {
  it('returns the document root and standards-escaped ids', () => {
    expect(selectorFor(document.documentElement)).toBe('html');
    const node = document.createElement('div');
    node.id = '123:a b';
    node.setAttribute('data-element-panel-test', '');
    document.body.appendChild(node);

    vi.stubGlobal('CSS', {});
    const selector = selectorFor(node);
    expect(selector).toBe('#\\31 23\\:a\\ b');
  });

  it('does not trust duplicate ids and falls back to a structural path', () => {
    const parent = document.createElement('section');
    parent.setAttribute('data-element-panel-test', '');
    const first = document.createElement('div');
    const second = document.createElement('div');
    first.id = second.id = 'duplicate';
    parent.append(first, second);
    document.body.appendChild(parent);

    const selector = selectorFor(second);
    expect(selector).toContain('div:nth-of-type(2)');
    expect(document.querySelector(selector)).toBe(second);
  });

  it('implements the CSS.escape edge cases needed by old WebViews', () => {
    vi.stubGlobal('CSS', {});
    expect(escapeCssIdentifier('-')).toBe('\\-');
    expect(escapeCssIdentifier('-1x')).toBe('-\\31 x');
    expect(escapeCssIdentifier('a\0b')).toBe('a\uFFFDb');
    expect(escapeCssIdentifier('中文')).toBe('中文');
  });

  it('falls back when smooth scroll options are rejected', () => {
    const node = document.createElement('div');
    const scroll = vi
      .spyOn(node, 'scrollIntoView')
      .mockImplementationOnce(() => {
        throw new TypeError('options unsupported');
      })
      .mockImplementationOnce(() => undefined);
    scrollToElement(node);
    expect(scroll).toHaveBeenCalledTimes(2);

    scroll.mockImplementation(() => {
      throw new Error('detached');
    });
    expect(() => scrollToElement(node)).not.toThrow();
  });
});

describe('Highlighter', () => {
  it('builds with DOM APIs, hides disconnected nodes, and disposes cleanly', () => {
    const highlighter = new Highlighter();
    const detached = document.createElement('div');
    highlighter.show(detached);
    expect(document.querySelector('[data-optik-highlight]')).toBeNull();

    const node = document.createElement('div');
    node.id = 'target';
    node.setAttribute('data-element-panel-test', '');
    document.body.appendChild(node);
    vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 30,
      right: 110,
      bottom: 80,
      width: 100,
      height: 50,
      x: 10,
      y: 30,
      toJSON: () => ({}),
    });
    highlighter.show(node);
    const root = document.querySelector<HTMLElement>('[data-optik-highlight]')!;
    expect(root.children).toHaveLength(3);
    expect(root.style.display).toBe('block');
    expect(root.textContent).toContain('div#target · 100 × 50');

    root.remove();
    highlighter.show(node);
    const rebuilt = document.querySelector<HTMLElement>('[data-optik-highlight]')!;
    expect(rebuilt).not.toBe(root);
    expect(rebuilt.style.display).toBe('block');

    highlighter.hide();
    expect(rebuilt.style.display).toBe('none');
    highlighter.dispose();
    expect(document.querySelector('[data-optik-highlight]')).toBeNull();
  });

  it('contains style failures instead of crashing the panel', () => {
    const highlighter = new Highlighter();
    const node = document.createElement('div');
    node.setAttribute('data-element-panel-test', '');
    document.body.appendChild(node);
    vi.stubGlobal('getComputedStyle', () => {
      throw new Error('detached realm');
    });
    expect(() => highlighter.show(node)).not.toThrow();
    expect(document.querySelector<HTMLElement>('[data-optik-highlight]')?.style.display).toBe(
      'none',
    );
    highlighter.dispose();
  });
});
