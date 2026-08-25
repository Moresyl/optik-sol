import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { NetworkRecord } from '../types';
import { instrumentFetch } from './fetch';
import type { NetworkSink } from './xhr';

interface FakeResponseOptions {
  body?: string | null;
  status?: number;
  statusText?: string;
  type?: ResponseType;
  headers?: HeadersInit;
  cloneThrows?: boolean;
  textRejects?: boolean;
  streamChunks?: Uint8Array[];
  readerRead?: () => Promise<ReadableStreamReadResult<Uint8Array>>;
  readerCancel?: () => Promise<void>;
}

function response(options: FakeResponseOptions = {}): Response {
  const {
    body = 'ok',
    status = 200,
    statusText = 'OK',
    type = 'basic',
    headers = { 'Content-Type': 'text/plain' },
    cloneThrows = false,
    textRejects = false,
    streamChunks,
    readerRead,
    readerCancel,
  } = options;
  const text = vi.fn(() =>
    textRejects ? Promise.reject(new Error('unreadable')) : Promise.resolve(body ?? ''),
  );
  const clone = vi.fn(() => {
    if (cloneThrows) throw new Error('disturbed');
    let index = 0;
    const read =
      readerRead ??
      (async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
        const chunk = streamChunks?.[index++];
        return chunk === undefined ? { done: true, value: undefined } : { done: false, value: chunk };
      });
    const cloneBody =
      streamChunks || readerRead
        ? {
            getReader: () => ({
              read,
              cancel: readerCancel ?? vi.fn(async () => undefined),
              releaseLock: vi.fn(),
            }),
          }
        : null;
    return { body: cloneBody, text } as unknown as Response;
  });
  return {
    status,
    statusText,
    type,
    headers: new Headers(headers),
    body: body === null ? null : ({} as ReadableStream<Uint8Array>),
    clone,
  } as unknown as Response;
}

describe('instrumentFetch', () => {
  let original: typeof fetch;
  let starts: Mock<(record: NetworkRecord) => void>;
  let updates: Mock<(id: string, patch: Partial<NetworkRecord>) => void>;
  let sink: NetworkSink;
  let next: number;

  beforeEach(() => {
    original = globalThis.fetch;
    starts = vi.fn<(record: NetworkRecord) => void>();
    updates = vi.fn<(id: string, patch: Partial<NetworkRecord>) => void>();
    sink = { onStart: starts, onUpdate: updates };
    next = 1;
  });

  afterEach(() => {
    globalThis.fetch = original;
  });

  it('captures request metadata and a small textual response', async () => {
    const originalFetch = vi.fn().mockResolvedValue(
      response({
        body: '{"answer":42}',
        headers: { 'Content-Type': 'application/json', 'Content-Length': '13' },
      }),
    );
    globalThis.fetch = originalFetch;
    const instrumentation = instrumentFetch(sink, { nextId: () => `net:${next++}` });

    const result = await fetch('https://example.test/api?a=1', {
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      body: '{"request":true}',
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(result.status).toBe(200);
    expect(originalFetch).toHaveBeenCalledOnce();
    expect(starts).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'net:1',
        method: 'POST',
        query: [['a', '1']],
        requestHeaders: [['Content-Type', 'application/json']],
        requestBody: expect.objectContaining({ text: '{"request":true}' }),
      }),
    );
    expect(updates).toHaveBeenCalledWith(
      'net:1',
      expect.objectContaining({ phase: 'loading', status: 200 }),
    );
    expect(updates).toHaveBeenCalledWith(
      'net:1',
      expect.objectContaining({
        phase: 'complete',
        responseBody: expect.objectContaining({ text: '{"answer":42}', size: 13 }),
      }),
    );
    instrumentation.dispose();
  });

  it.each([
    [
      'opaque',
      response({ type: 'opaque', body: null }),
      { omittedReason: 'opaque' },
    ],
    [
      'binary',
      response({ headers: { 'Content-Type': 'image/png', 'Content-Length': '42' } }),
      { omittedReason: 'binary', size: 42 },
    ],
    [
      'too large',
      response({ headers: { 'Content-Type': 'text/plain', 'Content-Length': '1000' } }),
      { omittedReason: 'too-large', size: 1000 },
    ],
    [
      'bodyless',
      response({ body: null, headers: { 'Content-Type': 'text/plain' } }),
      { omittedReason: 'unavailable' },
    ],
  ])('finishes %s responses without reading a body', async (_label, value, expected) => {
    globalThis.fetch = vi.fn().mockResolvedValue(value);
    const instrumentation = instrumentFetch(sink, {
      nextId: () => `net:${next++}`,
      maxBodyBytes: 100,
    });

    await fetch('https://example.test/resource');

    expect(updates).toHaveBeenLastCalledWith(
      'net:1',
      expect.objectContaining({
        phase: 'complete',
        responseBody: expect.objectContaining(expected),
      }),
    );
    expect(value.clone).not.toHaveBeenCalled();
    instrumentation.dispose();
  });

  it.each([
    ['clone failure', response({ cloneThrows: true })],
    [
      'read failure',
      response({ textRejects: true, headers: { 'Content-Type': 'text/plain', 'Content-Length': '2' } }),
    ],
  ])('degrades gracefully after a %s', async (_label, value) => {
    globalThis.fetch = vi.fn().mockResolvedValue(value);
    const instrumentation = instrumentFetch(sink, { nextId: () => `net:${next++}` });

    await fetch('https://example.test/text');
    await Promise.resolve();
    await Promise.resolve();

    expect(updates).toHaveBeenLastCalledWith(
      'net:1',
      expect.objectContaining({
        phase: 'complete',
        responseBody: expect.objectContaining({ omittedReason: 'unavailable' }),
      }),
    );
    instrumentation.dispose();
  });

  it.each([
    [new DOMException('cancelled', 'AbortError'), 'aborted'],
    [new TypeError('offline'), 'failed'],
  ] as const)('records rejected requests without changing the rejection', async (error, phase) => {
    globalThis.fetch = vi.fn().mockRejectedValue(error);
    const instrumentation = instrumentFetch(sink, { nextId: () => `net:${next++}` });

    await expect(fetch('https://example.test/fail')).rejects.toBe(error);
    expect(updates).toHaveBeenLastCalledWith(
      'net:1',
      expect.objectContaining({ phase, error: `${error.name}: ${error.message}` }),
    );
    instrumentation.dispose();
  });

  it('records a synchronous native fetch failure and rethrows it', () => {
    const error = new TypeError('invalid URL');
    globalThis.fetch = vi.fn(() => {
      throw error;
    });
    const instrumentation = instrumentFetch(sink, { nextId: () => `net:${next++}` });

    expect(() => fetch('invalid')).toThrow(error);
    expect(updates).toHaveBeenLastCalledWith(
      'net:1',
      expect.objectContaining({ phase: 'failed', error: 'TypeError: invalid URL' }),
    );
    instrumentation.dispose();
  });

  it('does not overwrite a wrapper installed after Optik during disposal', async () => {
    const originalFetch = vi.fn().mockResolvedValue(response({ body: null }));
    globalThis.fetch = originalFetch;
    const instrumentation = instrumentFetch(sink, { nextId: () => `net:${next++}` });
    const optikFetch = globalThis.fetch;
    const laterWrapper = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      optikFetch(input, init),
    );
    globalThis.fetch = laterWrapper;

    instrumentation.dispose();

    expect(globalThis.fetch).toBe(laterWrapper);
    await fetch('https://example.test/after-dispose');
    expect(originalFetch).toHaveBeenCalledOnce();
    expect(starts).not.toHaveBeenCalled();
  });

  it('stops reading an undeclared oversized body at the configured byte ceiling', async () => {
    const cancel = vi.fn(async () => undefined);
    const value = response({
      streamChunks: [new TextEncoder().encode('abcdef')],
      readerCancel: cancel,
    });
    globalThis.fetch = vi.fn().mockResolvedValue(value);
    const instrumentation = instrumentFetch(sink, {
      nextId: () => `net:${next++}`,
      maxBodyBytes: 4,
    });

    await fetch('https://example.test/unbounded');
    await vi.waitFor(() => {
      expect(updates).toHaveBeenLastCalledWith(
        'net:1',
        expect.objectContaining({
          phase: 'complete',
          responseBody: expect.objectContaining({
            text: 'abcd',
            omitted: true,
            omittedReason: 'too-large',
          }),
        }),
      );
    });
    expect(cancel).toHaveBeenCalledOnce();
    instrumentation.dispose();
  });

  it('cancels an in-flight clone and emits no late update after disposal', async () => {
    let finishRead!: (result: ReadableStreamReadResult<Uint8Array>) => void;
    const read = vi.fn(
      () =>
        new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
          finishRead = resolve;
        }),
    );
    const cancel = vi.fn(async () => undefined);
    globalThis.fetch = vi.fn().mockResolvedValue(response({ readerRead: read, readerCancel: cancel }));
    const instrumentation = instrumentFetch(sink, { nextId: () => `net:${next++}` });

    await fetch('https://example.test/pending');
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    const updatesBeforeDispose = updates.mock.calls.length;
    instrumentation.dispose();
    finishRead({ done: true, value: undefined });
    await Promise.resolve();
    await Promise.resolve();

    expect(cancel).toHaveBeenCalledOnce();
    expect(updates).toHaveBeenCalledTimes(updatesBeforeDispose);
  });

  it('returns a no-op when fetch is unavailable', () => {
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: undefined });
    const instrumentation = instrumentFetch(sink, { nextId: () => 'net:1' });
    expect(() => instrumentation.dispose()).not.toThrow();
    expect(starts).not.toHaveBeenCalled();
  });
});
