import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'solid-js';
import { render } from 'solid-js/web';
import { CopySheet, createCopyController } from './Copy';

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
});

describe('copy UI lifecycle', () => {
  it('ignores a late asynchronous clipboard result after controller disposal', async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((done) => (resolve = done));
    vi.stubGlobal('isSecureContext', true);
    const execDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => pending },
    });
    cleanups.push(() => {
      if (execDescriptor) Object.defineProperty(document, 'execCommand', execDescriptor);
      else Reflect.deleteProperty(document, 'execCommand');
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    });

    let controller!: ReturnType<typeof createCopyController>;
    let dispose!: () => void;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      controller = createCopyController();
    });
    expect(controller.copy('late result')).toBe(false);
    dispose();
    resolve();
    await pending;
    await Promise.resolve();

    expect(controller.toast()).toBeNull();
    expect(controller.sheet()).toBeNull();
    expect(controller.copy('after dispose')).toBe(false);
  });

  it('exposes the manual fallback as a modal dialog and closes it with Escape', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onClose = vi.fn();
    cleanups.push(
      render(
        () => <CopySheet data={{ text: 'copy me', title: '手动复制日志' }} onClose={onClose} />,
        host,
      ),
      () => host.remove(),
    );

    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('手动复制日志');
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
