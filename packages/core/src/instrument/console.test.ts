import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  instrumentConsole,
  type ConsoleInstrumentOptions,
  type ConsoleRecord,
} from './console';

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.restoreAllMocks();
});

function instrument(methods: ConsoleInstrumentOptions['methods']) {
  const records: ConsoleRecord[] = [];
  const instrumentation = instrumentConsole((record) => records.push(record), {
    methods,
    passthrough: false,
    captureStackTrace: false,
  });
  disposers.push(() => instrumentation.dispose());
  return { records, instrumentation };
}

describe('instrumentConsole', () => {
  it('captures ordinary methods with their expected level', () => {
    const { records } = instrument(['log', 'info', 'warn', 'error', 'debug', 'dir', 'table']);
    console.log('log');
    console.info('info');
    console.warn('warn');
    console.error('error');
    console.debug('debug');
    console.dir({ value: 1 });
    console.table([{ value: 1 }]);

    expect(records.map(({ level }) => level)).toEqual([
      'log',
      'info',
      'warn',
      'error',
      'debug',
      'log',
      'log',
    ]);
    expect(records[0]?.args).toEqual(['log']);
  });

  it('implements assertions, counts, and timers', () => {
    const { records } = instrument([
      'assert',
      'count',
      'countReset',
      'time',
      'timeLog',
      'timeEnd',
    ]);
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValueOnce(10).mockReturnValueOnce(12.5).mockReturnValueOnce(15);

    console.assert(true, 'ignored');
    console.assert(false, 'broken');
    console.count('items');
    console.count('items');
    console.countReset('items');
    console.count('items');
    console.time('task');
    console.timeLog('task', 'halfway');
    console.timeEnd('task');
    console.timeEnd('missing');

    expect(records.map(({ args }) => args)).toEqual([
      ['Assertion failed:', 'broken'],
      ['items: 1'],
      ['items: 2'],
      ['items: 1'],
      ['task: 2.500ms', 'halfway'],
      ['task: 5.000ms'],
      ["Timer 'missing' does not exist"],
    ]);
  });

  it('captures group, trace, and clear bookkeeping', () => {
    const { records } = instrument(['group', 'groupCollapsed', 'groupEnd', 'trace', 'clear']);
    console.group('open');
    console.groupCollapsed();
    console.groupEnd();
    console.trace('trace');
    console.clear();

    expect(records).toEqual([
      { level: 'log', args: ['open'], stackTrace: undefined, groupOp: 'start' },
      {
        level: 'log',
        args: ['console.group'],
        stackTrace: undefined,
        groupOp: 'startCollapsed',
      },
      { level: 'log', args: [], groupOp: 'end' },
      { level: 'log', args: ['console.trace', 'trace'], stackTrace: undefined },
      { level: 'log', args: [], clear: true },
    ]);
  });

  it('keeps the host call alive when the sink throws and prevents recursion', () => {
    const sink = vi.fn((record: ConsoleRecord) => {
      if (record.args[0] === 'outer') console.log('nested');
      throw new Error('sink failed');
    });
    const instrumentation = instrumentConsole(sink, {
      methods: ['log'],
      passthrough: false,
      captureStackTrace: false,
    });
    disposers.push(() => instrumentation.dispose());

    expect(() => console.log('outer')).not.toThrow();
    expect(sink).toHaveBeenCalledOnce();
  });

  it('supports passthrough and exposes the pristine method', () => {
    const native = vi.spyOn(console, 'log');
    const pristine = console.log;
    const instrumentation = instrumentConsole(() => {}, {
      methods: ['log'],
      passthrough: true,
      captureStackTrace: false,
    });
    disposers.push(() => instrumentation.dispose());

    console.log('host');
    expect(native).toHaveBeenCalledWith('host');
    expect(instrumentation.original['log']).toBeTypeOf('function');
    instrumentation.dispose();
    expect(console.log).toBe(pristine);
  });

  it('does not overwrite a wrapper installed after Optik', () => {
    const original = console.log;
    const { records, instrumentation } = instrument(['log']);
    const optikLog = console.log;
    const later = vi.fn((...args: unknown[]) => optikLog(...args));
    console.log = later;

    instrumentation.dispose();
    expect(console.log).toBe(later);
    console.log('after');
    expect(later).toHaveBeenCalledWith('after');
    expect(records).toEqual([]);
    console.log = original;
  });
});
