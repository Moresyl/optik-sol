import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'solid-js';
import { render } from 'solid-js/web';
import { CopyButton, CopySheet, Toast, createCopyController } from './Copy';

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
        () => (
          <CopySheet
            data={{ text: 'copy me', title: '手动复制日志', mode: 'fallback' }}
            onClose={onClose}
          />
        ),
        host,
      ),
      () => host.remove(),
    );

    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('手动复制日志');
    expect(dialog.textContent).toContain('当前环境不允许脚本写剪贴板');
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('reports synchronous success, handles empty input, and clears the toast', () => {
    vi.useFakeTimers();
    const descriptor = Object.getOwnPropertyDescriptor(document, 'execCommand');
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => true });
    cleanups.push(
      () => vi.useRealTimers(),
      () => {
        if (descriptor) Object.defineProperty(document, 'execCommand', descriptor);
        else Reflect.deleteProperty(document, 'execCommand');
      },
    );

    let controller!: ReturnType<typeof createCopyController>;
    let dispose!: () => void;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      controller = createCopyController();
    });
    cleanups.push(dispose);

    expect(controller.copy('')).toBe(false);
    expect(controller.toast()).toBe('没有可复制的内容');
    expect(controller.copy('x'.repeat(1200), '日志')).toBe(true);
    expect(controller.toast()).toBe('已复制日志（1.2k 字）');
    vi.advanceTimersByTime(1800);
    expect(controller.toast()).toBeNull();
  });

  it('opens and closes the direct reveal fallback', () => {
    let controller!: ReturnType<typeof createCopyController>;
    let dispose!: () => void;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      controller = createCopyController();
    });
    cleanups.push(dispose);

    controller.reveal('raw', '响应体');
    expect(controller.sheet()).toEqual({ text: 'raw', title: '响应体', mode: 'reveal' });
    const host = document.createElement('div');
    cleanups.push(render(() => <CopySheet data={controller.sheet()} onClose={vi.fn()} />, host));
    expect(host.textContent).toContain('未格式化的原始内容');
    expect(host.textContent).not.toContain('不允许脚本写剪贴板');
    controller.closeSheet();
    expect(controller.sheet()).toBeNull();
  });

  it('keeps row clicks isolated and resets CopyButton feedback', () => {
    vi.useFakeTimers();
    cleanups.push(() => vi.useRealTimers());
    const host = document.createElement('div');
    document.body.appendChild(host);
    cleanups.push(() => host.remove());
    const parentClick = vi.fn();
    const copier = {
      copy: vi.fn(() => true),
      reveal: vi.fn(),
      toast: () => null,
      sheet: () => null,
      closeSheet: vi.fn(),
    };
    cleanups.push(
      render(
        () => (
          <div onClick={parentClick}>
            <CopyButton copier={copier} text={() => 'value'} />
          </div>
        ),
        host,
      ),
    );

    const copy = host.querySelector('button')!;
    copy.click();
    expect(parentClick).not.toHaveBeenCalled();
    expect(copier.copy).toHaveBeenCalledWith('value', undefined);
    expect(copy.querySelectorAll('.invisible')[0]?.textContent).toBe('复制');
    vi.advanceTimersByTime(1400);
    expect(copy.querySelectorAll('.invisible')[0]?.textContent).toBe('已复制');
  });

  it('falls back to a timer when animation-frame scheduling throws', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', () => {
      throw new Error('broken frame shim');
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    cleanups.push(
      () => vi.useRealTimers(),
      render(
        () => (
          <CopySheet
            data={{ text: 'fallback', title: '复制', mode: 'fallback' }}
            onClose={vi.fn()}
          />
        ),
        host,
      ),
      () => host.remove(),
    );

    const textarea = host.querySelector('textarea')!;
    expect(document.activeElement).not.toBe(textarea);
    vi.advanceTimersByTime(16);
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(0);
    expect(textarea.selectionEnd).toBe(textarea.value.length);
  });

  it('renders live-region status only while a message exists', () => {
    const empty = document.createElement('div');
    const filled = document.createElement('div');
    cleanups.push(
      render(() => <Toast message={null} />, empty),
      render(() => <Toast message="已复制" />, filled),
    );
    expect(empty.querySelector('[role="status"]')).toBeNull();
    expect(filled.querySelector('[role="status"]')?.textContent).toBe('已复制');
  });
});
