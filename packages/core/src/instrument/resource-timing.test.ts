import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { NetworkRecord } from '../types';
import { instrumentResourceTiming } from './resource-timing';
import type { NetworkSink } from './xhr';

function timing(overrides: Partial<PerformanceResourceTiming> = {}): PerformanceResourceTiming {
  return {
    entryType: 'resource',
    name: 'https://example.test/app.js?v=1',
    initiatorType: 'script',
    startTime: 10,
    duration: 40,
    responseEnd: 50,
    domainLookupStart: 11,
    domainLookupEnd: 13,
    connectStart: 13,
    secureConnectionStart: 14,
    connectEnd: 18,
    requestStart: 20,
    responseStart: 30,
    transferSize: 0,
    decodedBodySize: 100,
    encodedBodySize: 80,
    ...overrides,
  } as PerformanceResourceTiming;
}

class FakePerformanceObserver {
  static callback: PerformanceObserverCallback;
  static latest: FakePerformanceObserver;
  static observe = vi.fn();
  observe = FakePerformanceObserver.observe;
  disconnect = vi.fn();

  constructor(callback: PerformanceObserverCallback) {
    FakePerformanceObserver.callback = callback;
    FakePerformanceObserver.latest = this;
  }

  emit(entries: PerformanceEntry[]): void {
    FakePerformanceObserver.callback(
      { getEntries: () => entries } as PerformanceObserverEntryList,
      this as unknown as PerformanceObserver,
    );
  }
}

describe('instrumentResourceTiming', () => {
  let Original: typeof PerformanceObserver | undefined;
  let starts: Mock<(record: NetworkRecord) => void>;
  let updates: Mock<(id: string, patch: Partial<NetworkRecord>) => void>;
  let sink: NetworkSink;

  beforeEach(() => {
    FakePerformanceObserver.observe = vi.fn();
    Original = globalThis.PerformanceObserver;
    Object.defineProperty(globalThis, 'PerformanceObserver', {
      configurable: true,
      writable: true,
      value: FakePerformanceObserver,
    });
    starts = vi.fn<(record: NetworkRecord) => void>();
    updates = vi.fn<(id: string, patch: Partial<NetworkRecord>) => void>();
    sink = { onStart: starts, onUpdate: updates };
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'PerformanceObserver', {
      configurable: true,
      writable: true,
      value: Original,
    });
  });

  it('correlates detailed timing with an existing request', () => {
    const findByUrl = vi.fn().mockReturnValue('net:1');
    const instrumentation = instrumentResourceTiming(sink, {
      nextId: () => 'net:2',
      findByUrl,
    });
    const entry = timing();

    FakePerformanceObserver.latest.emit([entry]);

    expect(findByUrl).toHaveBeenCalledWith(entry.name, 10);
    expect(updates).toHaveBeenCalledWith('net:1', {
      fromCache: true,
      timing: {
        startTime: 10,
        endTime: 50,
        duration: 40,
        responseStart: 30,
        dns: 2,
        tcp: 5,
        tls: 4,
        ttfb: 10,
        download: 20,
      },
    });
    expect(starts).not.toHaveBeenCalled();
    instrumentation.dispose();
    expect(FakePerformanceObserver.latest.disconnect).toHaveBeenCalledOnce();
  });

  it('records an unwrapped resource without inventing an HTTP status', () => {
    const instrumentation = instrumentResourceTiming(sink, {
      nextId: () => 'net:1',
      findByUrl: () => undefined,
    });
    FakePerformanceObserver.latest.emit([
      timing({
        initiatorType: 'img',
        domainLookupStart: 0,
        domainLookupEnd: 0,
        connectEnd: 0,
        responseStart: 0,
        transferSize: 60,
      }),
    ]);

    expect(starts).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'net:1',
        initiator: 'resource',
        method: 'GET',
        name: 'app.js',
        query: [['v', '1']],
        phase: 'complete',
        responseType: 'img',
        responseBody: { size: 100, omitted: true, omittedReason: 'unavailable' },
        fromCache: false,
        timing: { startTime: 10, endTime: 50, duration: 40 },
      }),
    );
    expect(starts.mock.calls[0]?.[0].status).toBeUndefined();
    instrumentation.dispose();
  });

  it('skips wrapper-owned initiators and respects captureUnhookedResources', () => {
    const instrumentation = instrumentResourceTiming(sink, {
      nextId: () => 'net:1',
      findByUrl: () => undefined,
      captureUnhookedResources: false,
    });
    FakePerformanceObserver.latest.emit([
      timing({ initiatorType: 'fetch' }),
      timing({ initiatorType: 'img' }),
      { entryType: 'paint', name: 'first-paint' } as PerformanceEntry,
    ]);
    expect(starts).not.toHaveBeenCalled();
    instrumentation.dispose();
  });

  it('falls back to entryTypes when buffered observation is unsupported', () => {
    FakePerformanceObserver.observe = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new TypeError('unsupported');
      })
      .mockImplementationOnce(() => undefined);
    const instrumentation = instrumentResourceTiming(sink, {
      nextId: () => 'net:1',
      findByUrl: () => undefined,
    });
    expect(FakePerformanceObserver.latest.observe).toHaveBeenNthCalledWith(1, {
      type: 'resource',
      buffered: true,
    });
    expect(FakePerformanceObserver.latest.observe).toHaveBeenNthCalledWith(2, {
      entryTypes: ['resource'],
    });
    instrumentation.dispose();
  });

  it('returns a no-op when PerformanceObserver is unavailable', () => {
    Object.defineProperty(globalThis, 'PerformanceObserver', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    const instrumentation = instrumentResourceTiming(sink, {
      nextId: () => 'net:1',
      findByUrl: () => undefined,
    });
    expect(() => instrumentation.dispose()).not.toThrow();
  });
});
