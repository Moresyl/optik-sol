import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { NetworkRecord } from '../types';
import { instrumentXhr, OPTIK_INTERNAL, type NetworkSink } from './xhr';

class FakeXMLHttpRequest extends EventTarget {
  static readonly UNSENT = 0;
  static readonly OPENED = 1;
  static readonly HEADERS_RECEIVED = 2;
  static readonly LOADING = 3;
  static readonly DONE = 4;

  readyState = 0;
  status = 0;
  statusText = '';
  responseType: XMLHttpRequestResponseType = '';
  responseText = '';
  response: unknown = null;
  sentBody: Document | XMLHttpRequestBodyInit | null | undefined;
  throwOnSend: unknown;
  responseHeaders = '';
  requestHeaders: [string, string][] = [];

  open(_method: string, _url: string | URL): void {
    this.readyState = 1;
  }

  setRequestHeader(name: string, value: string): void {
    this.requestHeaders.push([name, value]);
  }

  send(body?: Document | XMLHttpRequestBodyInit | null): void {
    if (this.throwOnSend) throw this.throwOnSend;
    this.sentBody = body;
  }

  getAllResponseHeaders(): string {
    return this.responseHeaders;
  }

  getResponseHeader(name: string): string | null {
    const lower = name.toLowerCase();
    const line = this.responseHeaders
      .split(/\r?\n/)
      .find((entry) => entry.toLowerCase().startsWith(`${lower}:`));
    return line ? line.slice(line.indexOf(':') + 1).trim() : null;
  }

  transition(readyState: number): void {
    this.readyState = readyState;
    this.dispatchEvent(new Event('readystatechange'));
  }
}

describe('instrumentXhr', () => {
  let original: typeof XMLHttpRequest;
  let sink: NetworkSink;
  let starts: Mock<(record: NetworkRecord) => void>;
  let updates: Mock<(id: string, patch: Partial<NetworkRecord>) => void>;
  let next = 1;

  beforeEach(() => {
    next = 1;
    original = globalThis.XMLHttpRequest;
    Object.defineProperty(globalThis, 'XMLHttpRequest', {
      configurable: true,
      writable: true,
      value: FakeXMLHttpRequest,
    });
    starts = vi.fn<(record: NetworkRecord) => void>();
    updates = vi.fn<(id: string, patch: Partial<NetworkRecord>) => void>();
    sink = { onStart: starts, onUpdate: updates };
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'XMLHttpRequest', {
      configurable: true,
      writable: true,
      value: original,
    });
  });

  it('captures request and textual response details without changing the call', () => {
    const instrumentation = instrumentXhr(sink, { nextId: () => `net:${next++}` });
    const xhr = new XMLHttpRequest() as unknown as FakeXMLHttpRequest;
    xhr.open('post', 'https://example.test/api?a=1');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send('{"ok":true}');

    expect(starts).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'net:1',
        method: 'POST',
        url: 'https://example.test/api?a=1',
        query: [['a', '1']],
        requestHeaders: [['Content-Type', 'application/json']],
        requestBody: expect.objectContaining({ text: '{"ok":true}' }),
        phase: 'pending',
      }),
    );

    xhr.status = 200;
    xhr.statusText = 'OK';
    xhr.responseHeaders = 'Content-Type: application/json\r\nX-Test: yes\r\n';
    xhr.responseText = '{"answer":42}';
    xhr.transition(2);
    xhr.transition(4);

    expect(updates).toHaveBeenCalledWith(
      'net:1',
      expect.objectContaining({ phase: 'loading', status: 200 }),
    );
    expect(updates).toHaveBeenCalledWith(
      'net:1',
      expect.objectContaining({
        phase: 'complete',
        status: 200,
        responseBody: expect.objectContaining({ text: '{"answer":42}' }),
      }),
    );
    instrumentation.dispose();
  });

  it('does not retain terminal listeners when one XHR object is reused', () => {
    const instrumentation = instrumentXhr(sink, { nextId: () => `net:${next++}` });
    const xhr = new XMLHttpRequest() as unknown as FakeXMLHttpRequest;

    xhr.open('GET', 'https://example.test/first');
    xhr.send();
    xhr.status = 200;
    xhr.transition(4);
    const firstUpdates = updates.mock.calls.filter(([id]) => id === 'net:1').length;

    xhr.open('GET', 'https://example.test/second');
    xhr.send();
    xhr.status = 204;
    xhr.transition(4);

    expect(starts).toHaveBeenCalledTimes(2);
    expect(updates.mock.calls.filter(([id]) => id === 'net:1')).toHaveLength(firstUpdates);
    expect(updates.mock.calls.filter(([id]) => id === 'net:2')).toHaveLength(1);
    instrumentation.dispose();
  });

  it('records a synchronous send failure and rethrows the original value', () => {
    const instrumentation = instrumentXhr(sink, { nextId: () => `net:${next++}` });
    const xhr = new XMLHttpRequest() as unknown as FakeXMLHttpRequest;
    const failure = new DOMException('invalid body', 'InvalidStateError');
    xhr.open('POST', 'https://example.test/fail');
    xhr.throwOnSend = failure;

    expect(() => xhr.send('body')).toThrow(failure);
    expect(updates).toHaveBeenCalledWith(
      'net:1',
      expect.objectContaining({ phase: 'failed', error: 'InvalidStateError: invalid body' }),
    );
    instrumentation.dispose();
  });

  it.each([
    ['error', 'failed', 'Request failed'],
    ['abort', 'aborted', 'Request aborted'],
    ['timeout', 'failed', 'Request timed out'],
  ] as const)('captures %s terminal events exactly once', (event, phase, message) => {
    const instrumentation = instrumentXhr(sink, { nextId: () => `net:${next++}` });
    const xhr = new XMLHttpRequest() as unknown as FakeXMLHttpRequest;
    xhr.open('GET', 'https://example.test/event');
    xhr.send();
    xhr.dispatchEvent(new Event(event));
    xhr.dispatchEvent(new Event(event));

    expect(updates).toHaveBeenCalledTimes(1);
    expect(updates).toHaveBeenCalledWith(
      'net:1',
      expect.objectContaining({ phase, error: message }),
    );
    instrumentation.dispose();
  });

  it('skips internal requests and restores the exact prototype methods', () => {
    const open = FakeXMLHttpRequest.prototype.open;
    const send = FakeXMLHttpRequest.prototype.send;
    const setRequestHeader = FakeXMLHttpRequest.prototype.setRequestHeader;
    const instrumentation = instrumentXhr(sink, { nextId: () => `net:${next++}` });
    const xhr = new XMLHttpRequest() as unknown as FakeXMLHttpRequest & Record<symbol, boolean>;
    xhr[OPTIK_INTERNAL] = true;
    xhr.open('GET', 'https://example.test/internal');
    xhr.send();

    expect(starts).not.toHaveBeenCalled();
    instrumentation.dispose();
    expect(FakeXMLHttpRequest.prototype.open).toBe(open);
    expect(FakeXMLHttpRequest.prototype.send).toBe(send);
    expect(FakeXMLHttpRequest.prototype.setRequestHeader).toBe(setRequestHeader);
  });
});
