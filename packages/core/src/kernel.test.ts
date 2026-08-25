import { afterEach, describe, expect, it, vi } from 'vitest';
import { OptikKernel } from './kernel';

const instances: OptikKernel[] = [];

afterEach(() => {
  for (const kernel of instances.splice(0)) kernel.dispose();
  delete (globalThis as Record<string, unknown>)['__optikKernelTest'];
  delete (globalThis as Record<string, unknown>)['$_'];
});

function create(options: ConstructorParameters<typeof OptikKernel>[0] = {}): OptikKernel {
  const kernel = new OptikKernel(options);
  instances.push(kernel);
  return kernel;
}

describe('OptikKernel', () => {
  it('starts idempotently, captures console calls, and restores the console', () => {
    const original = console.log;
    const kernel = create({
      passthrough: false,
      capture: {
        exceptions: false,
        rejections: false,
        resourceErrors: false,
        cspViolations: false,
        xhr: false,
        fetch: false,
        beacon: false,
        websocket: false,
        eventSource: false,
        resourceTiming: false,
      },
    });
    const added = vi.fn();
    kernel.events.on('logAdded', added);

    kernel.start();
    const wrapped = console.log;
    kernel.start();
    console.log('captured', 1);

    expect(kernel.started).toBe(true);
    expect(console.log).toBe(wrapped);
    expect(kernel.log.entries().at(-1)?.text).toBe('captured 1');
    expect(added).toHaveBeenCalledOnce();

    kernel.dispose();
    expect(kernel.started).toBe(false);
    expect(console.log).toBe(original);
  });

  it('re-emits log and network domain events', () => {
    const kernel = create({ capture: { console: false } });
    const logAdded = vi.fn();
    const networkStarted = vi.fn();
    const logResized = vi.fn();
    const networkResized = vi.fn();
    const longTaskAdded = vi.fn();
    const longTasksCleared = vi.fn();
    const longTasksResized = vi.fn();
    kernel.events.on('logAdded', logAdded);
    kernel.events.on('networkStarted', networkStarted);
    kernel.events.on('logResized', logResized);
    kernel.events.on('networkResized', networkResized);
    kernel.events.on('longTaskAdded', longTaskAdded);
    kernel.events.on('longTasksCleared', longTasksCleared);
    kernel.events.on('longTasksResized', longTasksResized);

    const log = kernel.log.ingest({ level: 'warn', origin: 'user', args: ['warning'] });
    const network = {
      id: 'net:1',
      initiator: 'fetch' as const,
      method: 'GET',
      url: 'https://example.test',
      name: 'example.test',
      origin: 'https://example.test',
      query: [],
      requestHeaders: [],
      responseHeaders: [],
      phase: 'pending' as const,
      timing: { startTime: 0 },
    };
    kernel.network.onStart(network);
    kernel.log.setMaxEntries(25);
    kernel.network.setMaxRecords(10);
    const longTask = {
      id: kernel.performance.nextId(),
      startTime: 2,
      duration: 55,
      name: 'self',
      attribution: [],
    };
    kernel.performance.onLongTask(longTask);
    kernel.performance.setMaxLongTasks(10);
    kernel.performance.clear();

    expect(logAdded).toHaveBeenCalledWith(log);
    expect(networkStarted).toHaveBeenCalledWith(network);
    expect(logResized).toHaveBeenCalledWith(25);
    expect(networkResized).toHaveBeenCalledWith(10);
    expect(longTaskAdded).toHaveBeenCalledWith(longTask);
    expect(longTasksResized).toHaveBeenCalledWith(10);
    expect(longTasksCleared).toHaveBeenCalledOnce();
  });

  it('evaluates expressions and statements in global scope', () => {
    const kernel = create({ capture: { console: false } });
    const expression = kernel.evaluate('{ answer: 42 }');
    const statement = kernel.evaluate('globalThis.__optikKernelTest = 7');

    expect(expression).toMatchObject({ value: { answer: 42 }, threw: false });
    expect(statement).toMatchObject({ value: 7, threw: false });
    expect(expression.duration).toBeGreaterThanOrEqual(0);
    expect((globalThis as Record<string, unknown>)['__optikKernelTest']).toBe(7);
  });

  it('supports $_ without clobbering a page-owned value', () => {
    const kernel = create({ capture: { console: false } });
    (globalThis as Record<string, unknown>)['$_'] = 'host';

    expect(kernel.evaluate('2 + 3').value).toBe(5);
    expect(kernel.evaluate('$_ * 2').value).toBe(10);
    expect((globalThis as Record<string, unknown>)['$_']).toBe('host');
  });

  it('distinguishes thrown undefined and captures arbitrary thrown values', () => {
    const kernel = create({ capture: { console: false } });
    expect(kernel.evaluate('throw undefined')).toMatchObject({ threw: true, error: undefined });
    expect(kernel.evaluate('throw 123')).toMatchObject({ threw: true, error: 123 });
  });

  it('does not execute a runtime SyntaxError twice', () => {
    const kernel = create({ capture: { console: false } });
    (globalThis as Record<string, unknown>)['__optikSyntaxRuns'] = 0;
    const result = kernel.evaluate(
      '(() => { globalThis.__optikSyntaxRuns++; throw new SyntaxError("runtime"); })()',
    );
    expect(result).toMatchObject({ threw: true, error: expect.any(SyntaxError) });
    expect((globalThis as Record<string, unknown>)['__optikSyntaxRuns']).toBe(1);
    delete (globalThis as Record<string, unknown>)['__optikSyntaxRuns'];
  });

  it('restores the exact page-owned $_ descriptor without invoking accessors', () => {
    const kernel = create({ capture: { console: false } });
    const getter = vi.fn(() => 'host');
    const setter = vi.fn();
    Object.defineProperty(globalThis, '$_', {
      configurable: true,
      enumerable: false,
      get: getter,
      set: setter,
    });
    const before = Object.getOwnPropertyDescriptor(globalThis, '$_');
    try {
      expect(kernel.evaluate('2 + 3')).toMatchObject({ value: 5, threw: false });
      expect(getter).not.toHaveBeenCalled();
      expect(setter).not.toHaveBeenCalled();
      expect(Object.getOwnPropertyDescriptor(globalThis, '$_')).toEqual(before);
    } finally {
      delete (globalThis as Record<string, unknown>)['$_'];
    }
  });

  it('preserves an own undefined $_ property instead of deleting it', () => {
    const kernel = create({ capture: { console: false } });
    Object.defineProperty(globalThis, '$_', {
      configurable: true,
      enumerable: false,
      value: undefined,
      writable: false,
    });
    const before = Object.getOwnPropertyDescriptor(globalThis, '$_');
    try {
      kernel.evaluate('1');
      expect(Object.getOwnPropertyDescriptor(globalThis, '$_')).toEqual(before);
    } finally {
      delete (globalThis as Record<string, unknown>)['$_'];
    }
  });

  it('can be restarted after disposal', () => {
    const kernel = create({
      passthrough: false,
      capture: {
        exceptions: false,
        rejections: false,
        resourceErrors: false,
        cspViolations: false,
        xhr: false,
        fetch: false,
        beacon: false,
        websocket: false,
        eventSource: false,
        resourceTiming: false,
      },
    });
    kernel.start();
    kernel.dispose();
    const added = vi.fn();
    kernel.events.on('logAdded', added);
    kernel.start();
    const entry = kernel.log.ingest({ level: 'log', origin: 'user', args: ['after restart'] });
    expect(kernel.started).toBe(true);
    expect(added).toHaveBeenCalledWith(entry);
  });

  it('rolls back earlier hooks when instrumentation installation fails', () => {
    const originalLog = console.log;
    const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    const originalFetch = globalThis.fetch;
    expect(fetchDescriptor).toBeDefined();
    Object.defineProperty(globalThis, 'fetch', {
      value: originalFetch,
      configurable: true,
      writable: false,
    });
    const kernel = create({
      passthrough: false,
      capture: {
        console: true,
        exceptions: false,
        rejections: false,
        resourceErrors: false,
        cspViolations: false,
        xhr: false,
        fetch: true,
        beacon: false,
        websocket: false,
        eventSource: false,
        resourceTiming: false,
      },
    });

    try {
      expect(() => kernel.start()).toThrow();
      expect(kernel.started).toBe(false);
      expect(console.log).toBe(originalLog);
    } finally {
      Object.defineProperty(globalThis, 'fetch', fetchDescriptor!);
    }
  });
});
