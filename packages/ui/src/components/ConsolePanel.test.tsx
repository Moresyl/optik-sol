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
