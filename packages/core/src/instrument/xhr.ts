/**
 * XMLHttpRequest instrumentation.
 *
 * Correctness constraints:
 *  - The wrapper must be `instanceof`-compatible and keep all statics/constants, because
 *    plenty of SDKs do `xhr.readyState === XMLHttpRequest.DONE`.
 *  - We attach our own listeners rather than overwriting `onreadystatechange`, so an app
 *    that assigns that handler after `open()` is unaffected.
 *  - Reading `responseText` on a non-text `responseType` throws in every browser; we
 *    check the type first instead of try/catching after the fact.
 */

import type { NetworkRecord } from '../types';
import {
  byteLengthOf,
  describeRequestBody,
  DEFAULT_MAX_BODY_BYTES,
  isTextualMime,
  mimeTypeOf,
  normalizeByteLimit,
  parseHeaderString,
  splitUrl,
  truncateText,
} from './body';

export interface NetworkSink {
  onStart(record: NetworkRecord): void;
  onUpdate(id: string, patch: Partial<NetworkRecord>): void;
}

export interface XhrInstrumentOptions {
  maxBodyBytes?: number;
  nextId(): string;
}

export interface Instrumentation {
  dispose(): void;
}

/** Marks requests Optik itself issues, so a remote transport cannot log its own traffic. */
export const OPTIK_INTERNAL = Symbol.for('optik.internal-request');

export function instrumentXhr(sink: NetworkSink, options: XhrInstrumentOptions): Instrumentation {
  const { nextId } = options;
  const maxBodyBytes = normalizeByteLimit(options.maxBodyBytes, DEFAULT_MAX_BODY_BYTES);
  const Original = globalThis.XMLHttpRequest;
  if (typeof Original !== 'function') return { dispose() {} };

  interface State {
    id: string;
    method: string;
    url: string;
    requestHeaders: [string, string][];
    startTime: number;
    responseStart?: number;
    internal?: boolean;
  }

  const states = new WeakMap<XMLHttpRequest, State>();

  const originalOpen = Original.prototype.open;
  const originalSend = Original.prototype.send;
  const originalSetRequestHeader = Original.prototype.setRequestHeader;
  let active = true;
  const requestCleanups = new WeakMap<XMLHttpRequest, () => void>();
  const pendingCleanups = new Set<() => void>();

  const wrappedOpen = function open(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    if (!active) return (originalOpen as Function).call(this, method, url, ...rest);
    // open() may legally reuse an XHR before its previous send settles.
    requestCleanups.get(this)?.();
    states.set(this, {
      id: nextId(),
      method: String(method || 'GET').toUpperCase(),
      url: String(url),
      requestHeaders: [],
      startTime: 0,
      internal: (this as unknown as Record<symbol, boolean>)[OPTIK_INTERNAL] === true,
    });
    return (originalOpen as Function).call(this, method, url, ...rest);
  } as typeof originalOpen;
  Original.prototype.open = wrappedOpen;

  const wrappedSetRequestHeader = function setRequestHeader(
    this: XMLHttpRequest,
    name: string,
    value: string,
  ) {
    if (!active) return originalSetRequestHeader.call(this, name, value);
    states.get(this)?.requestHeaders.push([String(name), String(value)]);
    return originalSetRequestHeader.call(this, name, value);
  };
  Original.prototype.setRequestHeader = wrappedSetRequestHeader;

  const wrappedSend = function send(
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    if (!active) return originalSend.call(this, body as XMLHttpRequestBodyInit);
    const state = states.get(this);
    if (!state || state.internal) return originalSend.call(this, body as XMLHttpRequestBodyInit);

    state.startTime = performance.now();

    const contentType = state.requestHeaders.find(([k]) => k.toLowerCase() === 'content-type')?.[1];
    const { url, name, origin, query } = splitUrl(state.url);

    const record: NetworkRecord = {
      id: state.id,
      initiator: 'xhr',
      method: state.method,
      url,
      name,
      origin,
      query,
      requestHeaders: state.requestHeaders,
      requestBody: describeRequestBody(
        body as BodyInit | null | undefined,
        contentType,
        maxBodyBytes,
      ),
      responseHeaders: [],
      phase: 'pending',
      timing: { startTime: state.startTime },
    };

    try {
      sink.onStart(record);
    } catch {
      // Never block the request on our bookkeeping.
    }

    let settled = false;

    const cleanup = () => {
      for (const [event, listener] of [
        ['readystatechange', onReadyStateChange],
        ['error', onRequestError],
        ['abort', onAbort],
        ['timeout', onTimeout],
      ] as const) {
        try {
          this.removeEventListener(event, listener);
        } catch {
          // Best effort for partially implemented WebViews.
        }
      }
      if (requestCleanups.get(this) === cleanup) requestCleanups.delete(this);
      pendingCleanups.delete(cleanup);
    };

    const settleFailure = (phase: 'failed' | 'aborted', message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      const endTime = performance.now();
      try {
        sink.onUpdate(state.id, {
          phase,
          error: message,
          timing: {
            startTime: state.startTime,
            responseStart: state.responseStart,
            endTime,
            duration: endTime - state.startTime,
          },
        });
      } catch {
        // Ignore.
      }
    };

    const onReadyStateChange = () => {
      if (settled) return;
      try {
        if (this.readyState === 2 /* HEADERS_RECEIVED */) {
          state.responseStart = performance.now();
          sink.onUpdate(state.id, {
            phase: 'loading',
            status: this.status,
            statusText: this.statusText,
            responseHeaders: parseHeaderString(safeAllResponseHeaders(this)),
            timing: { startTime: state.startTime, responseStart: state.responseStart },
          });
        } else if (this.readyState === 4 /* DONE */) {
          settled = true;
          cleanup();
          finish(this, state);
        }
      } catch {
        // Ignore.
      }
    };

    const onRequestError = () => settleFailure('failed', 'Request failed');
    const onAbort = () => settleFailure('aborted', 'Request aborted');
    const onTimeout = () => settleFailure('failed', 'Request timed out');

    const finish = (xhr: XMLHttpRequest, s: State) => {
      const endTime = performance.now();
      // status 0 with readyState 4 means a network-level failure (CORS, DNS, offline).
      const failed = xhr.status === 0;
      sink.onUpdate(s.id, {
        phase: failed ? 'failed' : 'complete',
        status: xhr.status,
        statusText: xhr.statusText,
        responseHeaders: parseHeaderString(safeAllResponseHeaders(xhr)),
        responseType: xhr.responseType || 'text',
        responseBody: readResponseBody(xhr, maxBodyBytes),
        error: failed ? 'Network error (status 0) — CORS, DNS, or offline' : undefined,
        timing: {
          startTime: s.startTime,
          responseStart: s.responseStart,
          endTime,
          duration: endTime - s.startTime,
        },
      });
    };

    try {
      this.addEventListener('readystatechange', onReadyStateChange);
      this.addEventListener('error', onRequestError);
      this.addEventListener('abort', onAbort);
      this.addEventListener('timeout', onTimeout);
      requestCleanups.set(this, cleanup);
      pendingCleanups.add(cleanup);
    } catch {
      cleanup();
      // Instrumentation is optional; still send through the untouched host request.
    }

    try {
      return originalSend.call(this, body as XMLHttpRequestBodyInit);
    } catch (error) {
      const message =
        error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      settleFailure('failed', message);
      throw error;
    }
  };
  Original.prototype.send = wrappedSend;

  return {
    dispose() {
      active = false;
      for (const cleanup of [...pendingCleanups]) cleanup();
      // Do not overwrite an instrumentor installed after Optik. If another wrapper is
      // chained above ours, it can keep calling this now-inert pass-through safely.
      if (Original.prototype.open === wrappedOpen) Original.prototype.open = originalOpen;
      if (Original.prototype.send === wrappedSend) Original.prototype.send = originalSend;
      if (Original.prototype.setRequestHeader === wrappedSetRequestHeader) {
        Original.prototype.setRequestHeader = originalSetRequestHeader;
      }
    },
  };
}

function safeAllResponseHeaders(xhr: XMLHttpRequest): string {
  try {
    return xhr.getAllResponseHeaders() || '';
  } catch {
    return '';
  }
}

function readResponseBody(xhr: XMLHttpRequest, maxBytes: number) {
  const mime = mimeTypeOf(safeHeader(xhr, 'content-type'));
  const type = xhr.responseType;

  // Accessing `responseText` throws unless responseType is '' or 'text'.
  if (type === '' || type === 'text') {
    let text: string;
    try {
      text = xhr.responseText;
    } catch {
      return { mimeType: mime, omitted: true, omittedReason: 'unavailable' as const };
    }
    return truncateText(text, mime, maxBytes);
  }

  if (type === 'json') {
    try {
      const text = JSON.stringify(xhr.response, null, 0);
      return truncateText(text ?? 'undefined', mime ?? 'application/json', maxBytes);
    } catch {
      return { mimeType: mime, omitted: true, omittedReason: 'unavailable' as const };
    }
  }

  if (type === 'document') {
    try {
      const html = (xhr.response as Document)?.documentElement?.outerHTML ?? '';
      return truncateText(html, mime ?? 'text/html', maxBytes);
    } catch {
      return { mimeType: mime, omitted: true, omittedReason: 'unavailable' as const };
    }
  }

  // arraybuffer | blob
  const size =
    type === 'arraybuffer'
      ? ((xhr.response as ArrayBuffer | null)?.byteLength ?? 0)
      : ((xhr.response as Blob | null)?.size ?? 0);

  return {
    mimeType: mime,
    size,
    omitted: true,
    omittedReason: isTextualMime(mime) ? ('unavailable' as const) : ('binary' as const),
  };
}

function safeHeader(xhr: XMLHttpRequest, name: string): string | null {
  try {
    return xhr.getResponseHeader(name);
  } catch {
    return null;
  }
}

export { byteLengthOf };
