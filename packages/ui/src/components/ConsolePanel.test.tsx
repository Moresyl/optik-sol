import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { OptikKernel, type CaptureOptions } from 'optik-core';
import { createStore } from '../store';
import type { CopyController } from './Copy';
import { ConsolePanel } from './ConsolePanel';

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
  longTasks: false,
};
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function inputValue(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

function key(input: HTMLInputElement, value: string): void {
  input.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }));
}

function renderPanel(): HTMLInputElement {
  const kernel = new OptikKernel({ capture: NO_CAPTURE });
  const store = createStore(kernel);
  const copier: CopyController = {
    copy: vi.fn(() => true),
    reveal: vi.fn(),
    toast: () => null,
    sheet: () => null,
    closeSheet: vi.fn(),
  };
  const host = document.createElement('div');
  document.body.appendChild(host);
  cleanups.push(
    render(() => <ConsolePanel store={store} kernel={kernel} copier={copier} />, host),
    () => store.dispose(),
    () => kernel.dispose(),
    () => host.remove(),
  );
  [...host.querySelectorAll('button')]
    .find((button) => button.textContent?.trim() === '输入框')!
    .click();
  return host.querySelector('input[placeholder="表达式，回车执行"]')!;
}

function renderWithStore(): {
  input: HTMLInputElement;
  rerender: () => HTMLInputElement;
} {
  const kernel = new OptikKernel({ capture: NO_CAPTURE });
  const store = createStore(kernel);
  const copier: CopyController = {
    copy: vi.fn(() => true),
    reveal: vi.fn(),
    toast: () => null,
    sheet: () => null,
    closeSheet: vi.fn(),
  };
  const host = document.createElement('div');
  document.body.appendChild(host);
  let disposePanel: (() => void) | undefined;
  const mount = () => {
    disposePanel = render(() => <ConsolePanel store={store} kernel={kernel} copier={copier} />, host);
    [...host.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === '输入框')!
      .click();
    return host.querySelector<HTMLInputElement>('input[placeholder="表达式，回车执行"]')!;
  };
  cleanups.push(
    () => disposePanel?.(),
    () => store.dispose(),
    () => kernel.dispose(),
    () => host.remove(),
  );
  return {
    input: mount(),
    rerender: () => {
      disposePanel?.();
      host.replaceChildren();
      return mount();
    },
  };
}

describe('ConsolePanel REPL history', () => {
  it('recognises a JSON string as expandable structured content', () => {
    const kernel = new OptikKernel({ capture: NO_CAPTURE });
    kernel.log.ingest({ level: 'log', origin: 'console', args: ['{"nested":{"value":42}}'] });
    const store = createStore(kernel);
    const copy = vi.fn((_text: string, _label?: string) => true);
    const copier: CopyController = {
      copy,
      reveal: vi.fn(),
      toast: () => null,
      sheet: () => null,
      closeSheet: vi.fn(),
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    cleanups.push(
      render(() => <ConsolePanel store={store} kernel={kernel} copier={copier} />, host),
      () => store.dispose(),
      () => kernel.dispose(),
      () => host.remove(),
    );

    [...host.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === '展开对象')!
      .click();
    expect(host.textContent).toContain('树形结构');
    expect(host.textContent).toContain('"nested"');
    [...host.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === '全部展开')!
      .click();
    expect(host.textContent).toContain('"value"');
  });

  it('removes log-row long-press listeners when the row is unmounted', () => {
    vi.useFakeTimers();
    vi.stubGlobal('PointerEvent', class extends MouseEvent {
      readonly pointerId = 1;
      readonly isPrimary = true;
    });
    const kernel = new OptikKernel({ capture: NO_CAPTURE });
    kernel.log.ingest({ level: 'log', origin: 'user', args: ['detached'] });
    const store = createStore(kernel);
    const copy = vi.fn((_text: string, _label?: string) => true);
    const copier: CopyController = {
      copy,
      reveal: vi.fn(),
      toast: () => null,
      sheet: () => null,
      closeSheet: vi.fn(),
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(
      () => <ConsolePanel store={store} kernel={kernel} copier={copier} />,
      host,
    );
    const row = host.querySelector<HTMLButtonElement>('[title^="复制此行"]')!.parentElement!;
    dispose();

    row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    vi.advanceTimersByTime(500);
    expect(copy).not.toHaveBeenCalled();

    store.dispose();
    kernel.dispose();
    host.remove();
  });

  it('exposes accessible regex and case-sensitive search toggles', () => {
    const input = renderPanel();
    const panel = input.closest<HTMLElement>('.relative')!;
    const regex = panel.querySelector<HTMLButtonElement>('[title="正则匹配"]')!;
    const caseSensitive = panel.querySelector<HTMLButtonElement>('[title="区分大小写"]')!;

    expect(regex.getAttribute('aria-pressed')).toBe('false');
    expect(caseSensitive.getAttribute('aria-pressed')).toBe('false');
    regex.click();
    caseSensitive.click();
    expect(regex.getAttribute('aria-pressed')).toBe('true');
    expect(caseSensitive.getAttribute('aria-pressed')).toBe('true');
  });

  it('opens the command picker as an Escape-closeable modal with initial focus', () => {
    const input = renderPanel();
    [...input.ownerDocument.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === '指令')!
      .click();
    const pickerButton = [...input.ownerDocument.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === '点选指令…',
    );
    pickerButton!.click();

    const dialog = input.ownerDocument.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const close = [...dialog.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === '关闭',
    )!;
    expect(document.activeElement).toBe(close);
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(input.ownerDocument.querySelector('[role="dialog"]')).toBeNull();
  });

  it('requires an in-place second click before running a destructive command', () => {
    const input = renderPanel();
    localStorage.setItem('keep-until-confirmed', 'yes');
    [...input.ownerDocument.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === '指令')!
      .click();
    [...input.ownerDocument.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === '点选指令…')!
      .click();
    const dialog = input.ownerDocument.querySelector<HTMLElement>('[role="dialog"]')!;
    const clear = [...dialog.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.trim().startsWith('清空本地存储'),
    )!;

    clear.click();
    expect(localStorage.getItem('keep-until-confirmed')).toBe('yes');
    expect(clear.textContent).toContain('再点一次确认');
    clear.click();
    expect(localStorage.getItem('keep-until-confirmed')).toBeNull();
    expect(input.ownerDocument.querySelector('[role="dialog"]')).toBeNull();
  });

  it('fills parameterized commands and places the caret inside the empty quotes', async () => {
    const input = renderPanel();
    [...input.ownerDocument.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === '指令')!
      .click();
    [...input.ownerDocument.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === '点选指令…')!
      .click();
    const dialog = input.ownerDocument.querySelector<HTMLElement>('[role="dialog"]')!;
    [...dialog.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim().startsWith('读某个键'))!
      .click();

    const repl = input.ownerDocument.querySelector<HTMLInputElement>(
      'input[placeholder="表达式，回车执行"]',
    )!;
    expect(repl.value).toBe("localStorage.getItem('')");
    await vi.waitFor(() => expect(document.activeElement).toBe(repl));
    expect(repl.selectionStart).toBe("localStorage.getItem('".length);
    expect(repl.selectionEnd).toBe(repl.selectionStart);
  });

  it('highlights literal matches, contains invalid regexes, and copies only checked rows', () => {
    const kernel = new OptikKernel({ capture: NO_CAPTURE });
    kernel.log.ingest({ level: 'warn', origin: 'user', args: ['Alpha [one]'] });
    kernel.log.ingest({ level: 'error', origin: 'user', args: ['Beta'] });
    const store = createStore(kernel);
    const copy = vi.fn((_text: string, _label?: string) => true);
    const copier: CopyController = {
      copy,
      reveal: vi.fn(),
      toast: () => null,
      sheet: () => null,
      closeSheet: vi.fn(),
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    cleanups.push(
      render(() => <ConsolePanel store={store} kernel={kernel} copier={copier} />, host),
      () => store.dispose(),
      () => kernel.dispose(),
      () => host.remove(),
    );

    const search = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    inputValue(search, 'alpha');
    expect(host.querySelector('mark')?.textContent).toBe('Alpha');
    host.querySelector<HTMLButtonElement>('[title="区分大小写"]')!.click();
    expect(host.textContent).toContain('没有匹配的日志');
    host.querySelector<HTMLButtonElement>('[title="区分大小写"]')!.click();
    host.querySelector<HTMLButtonElement>('[title="正则匹配"]')!.click();
    inputValue(search, '[');
    expect(host.textContent).toContain('Alpha [one]');
    inputValue(search, '^');
    expect(host.querySelector('mark')).toBeNull();

    inputValue(search, '');
    [...host.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === '勾选')!
      .click();
    host.querySelector<HTMLButtonElement>('[aria-label="选择"]')!.click();
    host.querySelector<HTMLButtonElement>('[title^="复制勾选的 1 条日志"]')!.click();
    expect(copy).toHaveBeenCalledWith(expect.stringContaining('Alpha [one]'), '勾选的 1 条日志');
    expect(String(copy.mock.calls[0]?.[0])).not.toContain('Beta');
  });

  it('walks all history entries and restores the unfinished draft', () => {
    const input = renderPanel();
    inputValue(input, '1 + 1');
    key(input, 'Enter');
    inputValue(input, '2 + 2');
    key(input, 'Enter');

    inputValue(input, 'unfinished');
    key(input, 'ArrowUp');
    expect(input.value).toBe('2 + 2');
    key(input, 'ArrowUp');
    expect(input.value).toBe('1 + 1');
    key(input, 'ArrowUp');
    expect(input.value).toBe('1 + 1');
    key(input, 'ArrowDown');
    expect(input.value).toBe('2 + 2');
    key(input, 'ArrowDown');
    expect(input.value).toBe('unfinished');
  });

  it('deduplicates repeated commands and resets navigation after a run', () => {
    const input = renderPanel();
    for (const expression of ['1', '2', '1']) {
      inputValue(input, expression);
      key(input, 'Enter');
    }

    key(input, 'ArrowUp');
    expect(input.value).toBe('1');
    key(input, 'ArrowUp');
    expect(input.value).toBe('2');
    key(input, 'Enter');
    key(input, 'ArrowUp');
    expect(input.value).toBe('2');
  });

  it('keeps history when the console tab is unmounted and mounted again', () => {
    const panel = renderWithStore();
    inputValue(panel.input, 'kept across tabs');
    key(panel.input, 'Enter');

    const input = panel.rerender();
    key(input, 'ArrowUp');
    expect(input.value).toBe('kept across tabs');
  });
});
