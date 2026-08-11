/**
 * Console instrumentation.
 *
 * Design rules, learned from where the incumbents get it wrong:
 *  - **Never swallow.** The original method is always called, so native DevTools,
 *    remote debuggers and error reporters keep working alongside Optik.
 *  - **Never recurse.** A re-entrancy guard means Optik's own internals can log without
 *    triggering infinite ingestion.
 *  - **Never throw into the host.** If ingestion fails, the app's `console.log` must
 *    still behave exactly as if Optik were not installed.
 *  - **Fully reversible.** `dispose()` restores the exact original descriptors, so
 *    Optik can be installed and removed at runtime.
 */

import type { LogLevel } from '../types';
import { captureStack } from './stack';
import type { CallFrame } from '../types';

export interface ConsoleRecord {
  level: LogLevel;
  args: unknown[];
  stackTrace?: CallFrame[];
  /** Group bookkeeping, resolved by the Log domain. */
  groupOp?: 'start' | 'startCollapsed' | 'end';
  /** Set by `console.clear()`. */
  clear?: boolean;
}

export interface ConsoleSink {
  (record: ConsoleRecord): void;
}

export interface ConsoleInstrumentOptions {
  /** Also invoke the original console method. Default true. */
  passthrough?: boolean;
  /** Capture a call site for each entry. Default true. */
  captureStackTrace?: boolean;
  /** Methods to intercept. Defaults to everything below. */
  methods?: ConsoleMethod[];
}

export type ConsoleMethod =
  | 'log'
  | 'info'
  | 'warn'
  | 'error'
  | 'debug'
  | 'dir'
  | 'dirxml'
  | 'table'
  | 'trace'
  | 'assert'
  | 'count'
  | 'countReset'
  | 'time'
  | 'timeEnd'
  | 'timeLog'
  | 'group'
  | 'groupCollapsed'
  | 'groupEnd'
  | 'clear';

const DEFAULT_METHODS: ConsoleMethod[] = [
  'log',
  'info',
  'warn',
  'error',
  'debug',
  'dir',
  'dirxml',
  'table',
  'trace',
  'assert',
  'count',
  'countReset',
  'time',
  'timeEnd',
  'timeLog',
  'group',
  'groupCollapsed',
  'groupEnd',
  'clear',
];

const LEVEL_BY_METHOD: Partial<Record<ConsoleMethod, LogLevel>> = {
  log: 'log',
  info: 'info',
  warn: 'warn',
  error: 'error',
  debug: 'debug',
  dir: 'log',
  dirxml: 'log',
  table: 'log',
  trace: 'log',
  assert: 'error',
  count: 'info',
  countReset: 'info',
  time: 'info',
  timeEnd: 'info',
  timeLog: 'info',
  group: 'log',
  groupCollapsed: 'log',
  groupEnd: 'log',
  clear: 'log',
};

export interface ConsoleInstrumentation {
  /** Pristine console methods, for internal logging that must not be re-ingested. */
  readonly original: Readonly<Record<string, (...args: unknown[]) => void>>;
  dispose(): void;
}

export function instrumentConsole(
  sink: ConsoleSink,
  options: ConsoleInstrumentOptions = {},
): ConsoleInstrumentation {
  const {
    passthrough = true,
    captureStackTrace: shouldCaptureStack = true,
    methods = DEFAULT_METHODS,
  } = options;

  const target = globalThis.console as unknown as Record<string, unknown>;
  const original: Record<string, (...args: unknown[]) => void> = {};
  const descriptors = new Map<string, PropertyDescriptor | undefined>();

  // `console.count` / `console.time` keep their own state in the browser, but the
  // browser's counters are invisible to us. We mirror them so our rendering matches.
  const counters = new Map<string, number>();
  const timers = new Map<string, number>();

  let reentrant = false;

  const emit = (record: ConsoleRecord) => {
    if (reentrant) return;
    reentrant = true;
    try {
      sink(record);
    } catch {
      // Ingestion failure must be invisible to the host page.
    } finally {
      reentrant = false;
    }
  };

  for (const method of methods) {
    const existing = target[method];
    // Some embedded webviews ship a partial console; only wrap what exists, but still
    // provide a no-op original so callers can rely on `original[method]`.
    original[method] =
      typeof existing === 'function'
        ? (existing as (...args: unknown[]) => void).bind(globalThis.console)
        : () => {};

    descriptors.set(method, Object.getOwnPropertyDescriptor(globalThis.console, method));

    const level = LEVEL_BY_METHOD[method] ?? 'log';

    const wrapper = (...args: unknown[]): void => {
      try {
        handle(method, level, args, {
          counters,
          timers,
          emit,
          shouldCaptureStack,
        });
      } catch {
        // Never let instrumentation break the call.
      }
      if (passthrough) original[method]!(...args);
    };

    // Preserve `fn.name`/`fn.length` so code that feature-detects the console
    // (surprisingly common in analytics SDKs) sees something plausible.
    Object.defineProperty(wrapper, 'name', { value: method, configurable: true });

    try {
      Object.defineProperty(globalThis.console, method, {
        value: wrapper,
        writable: true,
        configurable: true,
        enumerable: descriptors.get(method)?.enumerable ?? true,
      });
    } catch {
      // Frozen console (rare, some hardened webviews). Skip this method.
    }
  }

  return {
    original,
    dispose() {
      for (const [method, descriptor] of descriptors) {
        try {
          if (descriptor) Object.defineProperty(globalThis.console, method, descriptor);
          else delete (globalThis.console as unknown as Record<string, unknown>)[method];
        } catch {
          // Best effort.
        }
      }
      descriptors.clear();
      counters.clear();
      timers.clear();
    },
  };
}

interface HandleContext {
  counters: Map<string, number>;
  timers: Map<string, number>;
  emit: (record: ConsoleRecord) => void;
  shouldCaptureStack: boolean;
}

function handle(method: ConsoleMethod, level: LogLevel, args: unknown[], ctx: HandleContext): void {
  const { counters, timers, emit, shouldCaptureStack } = ctx;
  const stackTrace = shouldCaptureStack ? captureStack() : undefined;

  switch (method) {
    case 'assert': {
      // `console.assert(cond, ...msg)` logs only when the condition is falsy.
      if (args[0]) return;
      const rest = args.slice(1);
      emit({
        level: 'error',
        args: rest.length > 0 ? ['Assertion failed:', ...rest] : ['Assertion failed'],
        stackTrace,
      });
      return;
    }

    case 'count': {
      const label = args.length > 0 ? String(args[0]) : 'default';
      const next = (counters.get(label) ?? 0) + 1;
      counters.set(label, next);
      emit({ level: 'info', args: [`${label}: ${next}`], stackTrace });
      return;
    }

    case 'countReset': {
      const label = args.length > 0 ? String(args[0]) : 'default';
      counters.set(label, 0);
      return;
    }

    case 'time': {
      const label = args.length > 0 ? String(args[0]) : 'default';
      timers.set(label, performance.now());
      return;
    }

    case 'timeLog':
    case 'timeEnd': {
      const label = args.length > 0 ? String(args[0]) : 'default';
      const started = timers.get(label);
      if (started === undefined) {
        emit({
          level: 'warn',
          args: [`Timer '${label}' does not exist`],
          stackTrace,
        });
        return;
      }
      const elapsed = performance.now() - started;
      if (method === 'timeEnd') timers.delete(label);
      const extra = args.slice(1);
      emit({
        level: 'info',
        args: [`${label}: ${elapsed.toFixed(3)}ms`, ...extra],
        stackTrace,
      });
      return;
    }

    case 'group':
    case 'groupCollapsed': {
      emit({
        level: 'log',
        args: args.length > 0 ? args : ['console.group'],
        stackTrace,
        groupOp: method === 'group' ? 'start' : 'startCollapsed',
      });
      return;
    }

    case 'groupEnd': {
      emit({ level: 'log', args: [], groupOp: 'end' });
      return;
    }

    case 'clear': {
      emit({ level: 'log', args: [], clear: true });
      return;
    }

    case 'trace': {
      emit({
        level: 'log',
        args: args.length > 0 ? ['console.trace', ...args] : ['console.trace'],
        stackTrace,
      });
      return;
    }

    default:
      emit({ level, args, stackTrace });
  }
}
