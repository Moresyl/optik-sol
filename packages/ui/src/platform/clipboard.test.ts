import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyText, copyTextAsync, readSelectionText } from './clipboard';

describe('clipboard fallbacks', () => {
  const originalExec = Object.getOwnPropertyDescriptor(document, 'execCommand');
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const originalSecure = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');

  beforeEach(() => {
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => false),
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    if (originalExec) Object.defineProperty(document, 'execCommand', originalExec);
    else Reflect.deleteProperty(document, 'execCommand');
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
    if (originalSecure) Object.defineProperty(globalThis, 'isSecureContext', originalSecure);
    else delete (globalThis as { isSecureContext?: unknown }).isSecureContext;
  });

  it('handles empty text without touching browser APIs', () => {
    expect(copyText('')).toEqual({ ok: true, method: 'exec-command' });
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it('uses the synchronous light-DOM scratch path and removes it afterwards', () => {
    vi.mocked(document.execCommand).mockReturnValue(true);
    const before = document.body.childElementCount;
    expect(copyText('hello')).toEqual({ ok: true, method: 'exec-command' });
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(document.body.childElementCount).toBe(before);
  });

  it.each([
    ['resolve', () => Promise.resolve(), true],
    ['reject', () => Promise.reject(new Error('denied')), false],
  ])('reports an async clipboard %s to the caller', async (_label, createResult, succeeds) => {
    const callback = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(() => createResult()) },
    });

    expect(copyText('hello', { onAsyncResult: callback })).toEqual({
      ok: true,
      method: 'async-clipboard',
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(callback).toHaveBeenCalledWith(
      succeeds
        ? { ok: true, method: 'async-clipboard' }
        : {
            ok: false,
            method: 'needs-manual',
            reason: 'navigator.clipboard.writeText was rejected',
          },
    );
  });

  it('returns the manual path when no automatic API works', () => {
    expect(copyText('hello')).toMatchObject({ ok: false, method: 'needs-manual' });
  });

  it('contains synchronous clipboard throws and async callback failures', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi
          .fn()
          .mockImplementationOnce(() => {
            throw new Error('blocked');
          })
          .mockResolvedValueOnce(undefined),
      },
    });
    expect(copyText('first')).toMatchObject({ ok: false, method: 'needs-manual' });
    expect(
      copyText('second', {
        onAsyncResult() {
          throw new Error('UI disposed');
        },
      }),
    ).toMatchObject({ ok: true, method: 'async-clipboard' });
    await Promise.resolve();
    await Promise.resolve();
  });

  it('awaits the secure Clipboard API and falls back after rejection', async () => {
    Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('no'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    await expect(copyTextAsync('first')).resolves.toEqual({
      ok: true,
      method: 'async-clipboard',
    });
    vi.mocked(document.execCommand).mockReturnValue(true);
    await expect(copyTextAsync('second')).resolves.toEqual({
      ok: true,
      method: 'exec-command',
    });
  });
});

describe('readSelectionText', () => {
  it('prefers root-local selection and falls back to the document', () => {
    const root = { getSelection: () => ({ toString: () => 'shadow selection' }) } as unknown as ShadowRoot;
    expect(readSelectionText(root)).toBe('shadow selection');

    const getSelection = vi.spyOn(document, 'getSelection').mockReturnValue({
      toString: () => 'document selection',
    } as Selection);
    const emptyRoot = { getSelection: () => ({ toString: () => '' }) } as unknown as ShadowRoot;
    expect(readSelectionText(emptyRoot)).toBe('document selection');
    getSelection.mockRestore();
  });
});
