/**
 * Copying text that actually works on iOS.
 *
 * This is the single most-reported failure of existing in-page consoles, and it is not
 * one bug but four:
 *
 *  1. `navigator.clipboard` **does not exist outside a secure context.** Real-device
 *     debugging happens on `http://192.168.x.x:5173`, which is not HTTPS and not
 *     localhost, so the whole Clipboard API is `undefined`. A console that only calls
 *     `navigator.clipboard.writeText()` fails silently in exactly the situation it was
 *     built for.
 *
 *  2. The `execCommand` fallback has a very specific recipe on iOS. The scratch element
 *     must be in the document, must be non-zero-sized and not `display:none`, must not
 *     be `readonly` when the range is applied, and `select()` alone is not enough —
 *     iOS needs an explicit `Range` *and* `setSelectionRange`. A font smaller than 16px
 *     makes Safari zoom the page.
 *
 *  3. Inside a **Shadow DOM**, `document.execCommand('copy')` reads the *document*
 *     selection, which does not see shadow content. The scratch element must be
 *     appended to the light DOM.
 *
 *  4. It must run **synchronously inside the user gesture**. Any `await` before the
 *     copy call invalidates the gesture, so the fast path cannot be awaited first.
 *
 * The strategy below tries the synchronous path first (works in every context, no
 * permission prompt), then the async API, and finally reports `needs-manual` so the UI
 * can present a pre-selected textarea. That last tier cannot fail: the user taps the
 * system "Copy" item. Never a silently dead button.
 */

export type CopyOutcome =
  | { ok: true; method: 'async-clipboard' | 'exec-command' }
  | { ok: false; method: 'needs-manual'; reason: string };

export interface CopyOptions {
  /**
   * Element to restore focus to afterwards. Without this, copying from a panel steals
   * focus from the REPL input and dismisses the iOS keyboard mid-typing.
   */
  restoreFocusTo?: HTMLElement | null;
  /** Reports the eventual Clipboard API result when the synchronous path failed. */
  onAsyncResult?: (outcome: CopyOutcome) => void;
}

/**
 * Copies synchronously where possible.
 *
 * Returns immediately with `exec-command` on success. When the sync path is
 * unavailable it starts the async API and resolves through `onAsyncResult`, so callers
 * that only care about the common case do not have to await anything.
 */
export function copyText(text: string, options: CopyOptions = {}): CopyOutcome {
  if (text.length === 0) return { ok: true, method: 'exec-command' };

  const activeElement = options.restoreFocusTo ?? currentFocus();
  const savedSelection = saveSelection();

  // Sync path first: it is gesture-safe by construction and works on plain HTTP.
  const execResult = copyViaExecCommand(text);

  restoreSelection(savedSelection);
  restoreFocus(activeElement);

  if (execResult.ok) return { ok: true, method: 'exec-command' };

  // execCommand is unavailable or was refused. Try the async API — still inside the
  // gesture because we have not awaited anything.
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard?.writeText) {
    let pending: Promise<void>;
    try {
      pending = Promise.resolve(clipboard.writeText(text));
    } catch {
      const outcome: CopyOutcome = {
        ok: false,
        method: 'needs-manual',
        reason: 'navigator.clipboard.writeText threw synchronously',
      };
      return outcome;
    }
    void pending.then(
      () => notifyAsync(options, { ok: true, method: 'async-clipboard' }),
      () =>
        notifyAsync(options, {
          ok: false,
          method: 'needs-manual',
          reason: 'navigator.clipboard.writeText was rejected',
        }),
    );
    return { ok: true, method: 'async-clipboard' };
  }

  return {
    ok: false,
    method: 'needs-manual',
    reason: execResult.reason,
  };
}

function notifyAsync(options: CopyOptions, outcome: CopyOutcome): void {
  try {
    options.onAsyncResult?.(outcome);
  } catch {
    // A notification callback is UI bookkeeping and must not create an unhandled rejection.
  }
}

/**
 * Async variant for callers that can await (e.g. copying a large payload from a menu
 * where a spinner is acceptable). Falls back to the sync path on rejection.
 */
export async function copyTextAsync(text: string, options: CopyOptions = {}): Promise<CopyOutcome> {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard?.writeText && globalThis.isSecureContext) {
    try {
      await clipboard.writeText(text);
      return { ok: true, method: 'async-clipboard' };
    } catch {
      // Permission denied, or the document lost focus. Fall through.
    }
  }
  return copyText(text, options);
}

interface ExecResult {
  ok: boolean;
  method: 'exec-command';
  reason: string;
}

function copyViaExecCommand(
  text: string,
): (ExecResult & { ok: true; method: 'exec-command' }) | (ExecResult & { ok: false }) {
  const doc = globalThis.document;
  if (!doc?.body || typeof doc.execCommand !== 'function') {
    return { ok: false, method: 'exec-command', reason: 'document.execCommand is unavailable' };
  }

  const scratch = doc.createElement('textarea');
  scratch.value = text;

  // `readOnly` must be false for iOS to apply the selection range, but a focusable
  // editable field would pop the keyboard — `inputMode: none` suppresses that.
  scratch.readOnly = false;
  scratch.inputMode = 'none';
  scratch.setAttribute('aria-hidden', 'true');
  scratch.tabIndex = -1;

  // iOS ignores zero-sized, `display:none` and `visibility:hidden` elements for
  // selection. It must be laid out and non-empty; we hide it behind opacity instead.
  // `font-size:16px` prevents Safari's auto-zoom on focus.
  scratch.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'width:1px',
    'height:1px',
    'padding:0',
    'border:none',
    'outline:none',
    'box-shadow:none',
    'background:transparent',
    'opacity:0',
    'font-size:16px',
    'z-index:-1',
    // Prevent the page from scrolling to the scratch element on focus.
    'overflow:hidden',
    'white-space:pre',
  ].join(';');

  // Light DOM on purpose: `execCommand` reads the document selection, which cannot
  // see inside a shadow root.
  doc.body.appendChild(scratch);

  let succeeded = false;
  let reason = 'document.execCommand("copy") returned false';

  try {
    scratch.focus({ preventScroll: true });

    // iOS needs *both* an explicit Range on the document selection and the textarea's
    // own selection range. Either one alone silently copies nothing.
    const selection = doc.getSelection();
    if (selection) {
      const range = doc.createRange();
      range.selectNodeContents(scratch);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    scratch.setSelectionRange(0, text.length);

    succeeded = doc.execCommand('copy');
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  } finally {
    scratch.remove();
  }

  return succeeded
    ? { ok: true, method: 'exec-command', reason: '' }
    : { ok: false, method: 'exec-command', reason };
}

// ---------------------------------------------------------------------------
// Selection / focus preservation
// ---------------------------------------------------------------------------

/**
 * A copy action must not destroy what the user had selected. This matters
 * specifically because Optik offers "copy the text you selected" — clobbering the
 * selection to perform the copy would defeat the feature.
 */
function saveSelection(): Range[] {
  const selection = globalThis.document?.getSelection();
  if (!selection || selection.rangeCount === 0) return [];
  const ranges: Range[] = [];
  for (let i = 0; i < selection.rangeCount; i++) {
    try {
      ranges.push(selection.getRangeAt(i).cloneRange());
    } catch {
      // Detached range.
    }
  }
  return ranges;
}

function restoreSelection(ranges: Range[]): void {
  const selection = globalThis.document?.getSelection();
  if (!selection) return;
  try {
    selection.removeAllRanges();
    for (const range of ranges) selection.addRange(range);
  } catch {
    // The nodes may have been removed in the meantime.
  }
}

function currentFocus(): HTMLElement | null {
  const active = globalThis.document?.activeElement;
  return active instanceof HTMLElement ? active : null;
}

function restoreFocus(element: HTMLElement | null): void {
  if (!element || !element.isConnected) return;
  try {
    element.focus({ preventScroll: true });
  } catch {
    // Element may no longer be focusable.
  }
}

/**
 * Reads the user's current text selection, restricted to a root.
 *
 * `getSelection()` on the document does not report selections inside a shadow root, so
 * we prefer the shadow root's own `getSelection` where the browser provides it
 * (Chromium) and fall back to the document (Safari, which does expose shadow
 * selections through `document.getSelection()`).
 */
export function readSelectionText(root: ShadowRoot | Document): string {
  const withSelection = root as unknown as { getSelection?: () => Selection | null };
  const selection =
    typeof withSelection.getSelection === 'function'
      ? withSelection.getSelection()
      : globalThis.document.getSelection();

  const text = selection?.toString() ?? '';
  if (text) return text;

  // Safari: shadow selections surface on the document selection object.
  return globalThis.document.getSelection()?.toString() ?? '';
}
