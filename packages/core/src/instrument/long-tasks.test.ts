import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LongTaskRecord } from '../types';
import { instrumentLongTasks } from './long-tasks';

class FakePerformanceObserver {
  static latest: FakePerformanceObserver;
  static observe = vi.fn();

  readonly disconnect = vi.fn();
  readonly observe = FakePerformanceObserver.observe;

  constructor(readonly callback: PerformanceObserverCallback) {
    FakePerformanceObserver.latest = this;
  }

  emit(entries: PerformanceEntry[]): void {
    this.callback(
      { getEntries: () => entries } as PerformanceObserverEntryList,
      this as unknown as PerformanceObserver,
    );
  }
}

describe('instrumentLongTasks', () => {
  let original: typeof PerformanceObserver | undefined;

  beforeEach(() => {
    original = globalThis.PerformanceObserver;
    FakePerformanceObserver.observe = vi.fn();
    Object.defineProperty(globalThis, 'PerformanceObserver', {
      configurable: true,
      value: FakePerformanceObserver,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'PerformanceObserver', {
      configurable: true,
      value: original,
    });
  });

  it('captures buffered long tasks with safe attribution', () => {
    const records: LongTaskRecord[] = [];
    let id = 0;
    const instrumentation = instrumentLongTasks({
      nextId: () => `task:${++id}`,
      onLongTask: (entry) => records.push(entry),
    });
    FakePerformanceObserver.latest.emit([
      {
        entryType: 'longtask',
        name: 'same-origin-descendant',
        startTime: 12.5,
        duration: 73,
        attribution: [
          {
            containerType: 'iframe',
            containerSrc: '/child',
            containerId: 'frame',
            containerName: 7,
          },
        ],
      } as unknown as PerformanceEntry,
    ]);

    expect(FakePerformanceObserver.observe).toHaveBeenCalledWith({
      type: 'longtask',
      buffered: true,
    });
    expect(records).toEqual([
      {
        id: 'task:1',
        name: 'same-origin-descendant',
        startTime: 12.5,
        duration: 73,
        attribution: [
          {
            containerType: 'iframe',
            containerSrc: '/child',
            containerId: 'frame',
            containerName: '',
          },
        ],
      },
    ]);
    instrumentation.dispose();
    expect(FakePerformanceObserver.latest.disconnect).toHaveBeenCalledOnce();
  });

  it('filters unrelated and invalid entries and survives hostile attribution', () => {
    const onLongTask = vi.fn();
    instrumentLongTasks({ nextId: () => 'task:1', onLongTask });
    FakePerformanceObserver.latest.emit([
      { entryType: 'mark', startTime: 0, duration: 0 } as PerformanceEntry,
      { entryType: 'longtask', startTime: Number.NaN, duration: 50 } as PerformanceEntry,
      { entryType: 'longtask', startTime: 1, duration: 49 } as PerformanceEntry,
      {
        entryType: 'longtask',
        name: '',
        startTime: 0,
        duration: 50,
        attribution: {
          [Symbol.iterator]: () => {
            throw new Error('blocked');
          },
        },
      } as unknown as PerformanceEntry,
    ]);
    expect(onLongTask).toHaveBeenCalledOnce();
    expect(onLongTask).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'unknown', attribution: [] }),
    );
  });

  it('falls back to entryTypes and stops accepting records after disposal', () => {
    FakePerformanceObserver.observe = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new TypeError('old webview');
      })
      .mockImplementationOnce(() => undefined);
    const onLongTask = vi.fn();
    const instrumentation = instrumentLongTasks({ nextId: () => 'task:1', onLongTask });
    expect(FakePerformanceObserver.observe).toHaveBeenNthCalledWith(2, {
      entryTypes: ['longtask'],
    });
    instrumentation.dispose();
    FakePerformanceObserver.latest.emit([
      { entryType: 'longtask', name: 'self', startTime: 1, duration: 51 } as PerformanceEntry,
    ]);
    expect(onLongTask).not.toHaveBeenCalled();
  });

  it('disconnects and becomes a no-op when both observer modes fail', () => {
    FakePerformanceObserver.observe = vi.fn(() => {
      throw new Error('unsupported');
    });
    const instrumentation = instrumentLongTasks({
      nextId: () => 'task:1',
      onLongTask: vi.fn(),
    });
    expect(FakePerformanceObserver.latest.disconnect).toHaveBeenCalledOnce();
    expect(() => instrumentation.dispose()).not.toThrow();
  });

  it('is a no-op without PerformanceObserver and contains sink errors', () => {
    Object.defineProperty(globalThis, 'PerformanceObserver', {
      configurable: true,
      value: undefined,
    });
    expect(() =>
      instrumentLongTasks({ nextId: () => 'x', onLongTask: vi.fn() }).dispose(),
    ).not.toThrow();

    Object.defineProperty(globalThis, 'PerformanceObserver', {
      configurable: true,
      value: FakePerformanceObserver,
    });
    instrumentLongTasks({
      nextId: () => 'task:1',
      onLongTask: () => {
        throw new Error('consumer failed');
      },
    });
    expect(() =>
      FakePerformanceObserver.latest.emit([
        { entryType: 'longtask', name: 'self', startTime: 1, duration: 51 } as PerformanceEntry,
      ]),
    ).not.toThrow();
  });

  it('bounds browser-controlled attribution and contains broken entry lists', () => {
    const onLongTask = vi.fn();
    instrumentLongTasks({ nextId: () => 'task:1', onLongTask });
    FakePerformanceObserver.latest.emit([
      {
        entryType: 'longtask',
        name: 'n'.repeat(100),
        startTime: 1,
        duration: 50,
        attribution: [
          {
            containerType: 'iframe',
            containerSrc: 'x'.repeat(3000),
            containerId: 'i'.repeat(3000),
            containerName: '',
          },
        ],
      } as unknown as PerformanceEntry,
    ]);
    const captured = onLongTask.mock.calls[0]?.[0] as LongTaskRecord;
    expect(captured.name).toHaveLength(64);
    expect(captured.attribution[0]?.containerSrc).toHaveLength(2048);
    expect(captured.attribution[0]?.containerId).toHaveLength(2048);

    expect(() =>
      FakePerformanceObserver.latest.callback(
        {
          getEntries: () => {
            throw new Error('broken list');
          },
        } as unknown as PerformanceObserverEntryList,
        FakePerformanceObserver.latest as unknown as PerformanceObserver,
      ),
    ).not.toThrow();
  });

  it('degrades when the observer constructor throws', () => {
    Object.defineProperty(globalThis, 'PerformanceObserver', {
      configurable: true,
      value: class {
        constructor() {
          throw new Error('broken implementation');
        }
      },
    });
    expect(() =>
      instrumentLongTasks({ nextId: () => 'task:1', onLongTask: vi.fn() }).dispose(),
    ).not.toThrow();
  });
});
