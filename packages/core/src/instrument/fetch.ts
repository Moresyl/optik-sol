/**
 * fetch() instrumentation.
 *
 * The hard part is reading the response body without stealing it from the app.
 * `response.clone()` gives us an independent stream, but cloning a response the app
 * never fully consumes makes the browser buffer the whole body in memory. So we clone
 * only when the response looks textual and small enough to be worth showing, and we
 * always read the clone (not the original) on a detached microtask so the app's
 * `await res.json()` is never delayed.
 */

import type { NetworkRecord } from '../types';
import type { Instrumentation, NetworkSink } from './xhr';
import {
  DEFAULT_MAX_BODY_BYTES,
  describeRequestBody,
  headersToEntries,
  isTextualMime,
  mimeTypeOf,
  splitUrl,
  truncateText,
} from './body';

export interface FetchInstrumentOptions {
  maxBodyBytes?: number;
  nextId(): string;
}

export function instrumentFetch(sink: NetworkSink, options: FetchInstrumentOptions): Instrumentation {
  const { maxBodyBytes = DEFAULT_MAX_BODY_BYTES, nextId } = options;
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== 'function') return { dispose() {} };

  const wrapped = function fetch(
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const id = nextId();
    const startTime = performance.now();

    let method = 'GET';
    let rawUrl = '';
    let requestHeaders: [string, string][] = [];
    let requestBody: NetworkRecord['requestBody'];

    try {
      if (typeof Request !== 'undefined' && input instanceof Request) {
        method = (init?.method ?? input.method ?? 'GET').toUpperCase();
        rawUrl = input.url;
        requestHeaders = init?.headers
          ? headersToEntries(init.headers)
          : headersToEntries(input.headers);
        // A Request's body is a stream we must not consume — record it as such.
        requestBody = init?.body
          ? describeRequestBody(
              init.body,
              findHeader(requestHeaders, 'content-type'),
              maxBodyBytes,
            )
          : input.bodyUsed || input.body
            ? { omitted: true, omittedReason: 'streaming' }
            : undefined;
      } else {
        method = (init?.method ?? 'GET').toUpperCase();
        rawUrl = String(input);
        requestHeaders = headersToEntries(init?.headers);
        requestBody = describeRequestBody(
          init?.body,
          findHeader(requestHeaders, 'content-type'),
          maxBodyBytes,
        );
      }
    } catch {
      rawUrl = String(input);
    }

    const { url, name, origin, query } = splitUrl(rawUrl);

    try {
      sink.onStart({
        id,
        initiator: 'fetch',
        method,
        url,
        name,
        origin,
        query,
        requestHeaders,
        requestBody,
        responseHeaders: [],
        phase: 'pending',
        timing: { startTime },
      });
    } catch {
      // Bookkeeping must never break the request.
    }

    let promise: Promise<Response>;
    try {
      promise = originalFetch.call(globalThis, input as RequestInfo, init);
    } catch (err) {
      // Synchronous throw (invalid input) — record and rethrow untouched.
      reportFailure(sink, id, startTime, err);
      throw err;
    }

    return promise.then(
      (response) => {
        const responseStart = performance.now();
        const responseHeaders = safeHeaderEntries(response.headers);
        const mime = mimeTypeOf(findHeader(responseHeaders, 'content-type'));
        const declaredLength = Number(findHeader(responseHeaders, 'content-length') ?? NaN);

        try {
          sink.onUpdate(id, {
            phase: 'loading',
            status: response.status,
            statusText: response.statusText,
            responseHeaders,
            responseType: response.type,
            timing: { startTime, responseStart },
          });
        } catch {
          // Ignore.
        }

        // `opaque` responses (no-cors) expose nothing at all; say so instead of
        // rendering a misleading empty 0-status row.
        if (response.type === 'opaque' || response.type === 'opaqueredirect') {
          finalize(sink, id, startTime, responseStart, {
            omitted: true,
            omittedReason: 'opaque',
            mimeType: mime,
          });
          return response;
        }

        const tooLarge = Number.isFinite(declaredLength) && declaredLength > maxBodyBytes;
        const readable = isTextualMime(mime) && !tooLarge && response.body !== null;

        if (!readable) {
          finalize(sink, id, startTime, responseStart, {
            mimeType: mime,
            size: Number.isFinite(declaredLength) ? declaredLength : undefined,
            omitted: true,
            omittedReason: tooLarge ? 'too-large' : isTextualMime(mime) ? 'unavailable' : 'binary',
          });
          return response;
        }

        let clone: Response;
        try {
          clone = response.clone();
        } catch {
          finalize(sink, id, startTime, responseStart, {
            mimeType: mime,
            omitted: true,
            omittedReason: 'unavailable',
          });
          return response;
        }

        // Detached: the app gets its Response immediately, we catch up whenever.
        clone
          .text()
          .then((text) => {
            finalize(sink, id, startTime, responseStart, truncateText(text, mime, maxBodyBytes));
          })
          .catch(() => {
            finalize(sink, id, startTime, responseStart, {
              mimeType: mime,
              omitted: true,
              omittedReason: 'unavailable',
            });
          });

        return response;
      },
      (error: unknown) => {
        reportFailure(sink, id, startTime, error);
        throw error;
      },
    );
  } as typeof globalThis.fetch;

  // Preserve identity checks some polyfills perform.
  Object.defineProperty(wrapped, 'name', { value: 'fetch', configurable: true });
  Object.defineProperty(wrapped, 'length', { value: originalFetch.length, configurable: true });

  globalThis.fetch = wrapped;

  return {
    dispose() {
      globalThis.fetch = originalFetch;
    },
  };
}

function finalize(
  sink: NetworkSink,
  id: string,
  startTime: number,
  responseStart: number,
  responseBody: NetworkRecord['responseBody'],
): void {
  const endTime = performance.now();
  try {
    sink.onUpdate(id, {
      phase: 'complete',
      responseBody,
      timing: { startTime, responseStart, endTime, duration: endTime - startTime },
    });
  } catch {
    // Ignore.
  }
}

function reportFailure(sink: NetworkSink, id: string, startTime: number, error: unknown): void {
  const endTime = performance.now();
  const aborted =
    error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
  try {
    sink.onUpdate(id, {
      phase: aborted ? 'aborted' : 'failed',
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      timing: { startTime, endTime, duration: endTime - startTime },
    });
  } catch {
    // Ignore.
  }
}

function safeHeaderEntries(headers: Headers): [string, string][] {
  try {
    return [...headers.entries()];
  } catch {
    return [];
  }
}

function findHeader(headers: [string, string][], name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers.find(([key]) => key.toLowerCase() === lower)?.[1];
}
