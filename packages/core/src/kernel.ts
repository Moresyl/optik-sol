/**
 * The Optik kernel: owns the domains, wires up instrumentation, and exposes a
 * transport-agnostic surface.
 *
 * Nothing here knows that a UI exists. The in-page panel is just one client; a
 * WebSocket transport speaking the same protocol turns this exact object into a remote
 * debugging agent with no changes to the domains.
 */

import { Emitter } from './emitter';
import { LogDomain, type LogDomainOptions } from './domains/log';
import { NetworkDomain, type NetworkDomainOptions } from './domains/network';
import { StorageDomain } from './domains/storage';
import { SystemDomain } from './domains/system';
import { instrumentConsole, type ConsoleInstrumentation } from './instrument/console';
import { instrumentErrors } from './instrument/errors';
import { instrumentXhr, type Instrumentation } from './instrument/xhr';
import { instrumentFetch } from './instrument/fetch';
import {
  instrumentEventSource,
  instrumentSendBeacon,
  instrumentWebSocket,
} from './instrument/misc-network';
import { instrumentResourceTiming } from './instrument/resource-timing';
import type { LogEntry, NetworkRecord } from './types';

export interface CaptureOptions {
  console?: boolean;
  exceptions?: boolean;
  rejections?: boolean;
  resourceErrors?: boolean;
  cspViolations?: boolean;
  xhr?: boolean;
  fetch?: boolean;
  beacon?: boolean;
  websocket?: boolean;
  eventSource?: boolean;
  resourceTiming?: boolean;
}

export interface KernelOptions {
  log?: LogDomainOptions;
  network?: NetworkDomainOptions;
  capture?: CaptureOptions;
  /** Forward calls to the original console. Default true. */
  passthrough?: boolean;
  /** Largest request/response body retained, in bytes. Default 512 KiB. */
  maxBodyBytes?: number;
}

export interface KernelEvents {
  logAdded: LogEntry;
  logUpdated: LogEntry;
  logCleared: void;
  networkStarted: NetworkRecord;
  networkUpdated: NetworkRecord;
  networkCleared: void;
}

/**
 * The outcome of one `evaluate` call.
 *
 * This hands back the *raw* value rather than a mirrored `RemoteObject`, and that is
 * deliberate: mirroring must be done by whoever ends up owning the result. The console
 * feeds it straight into `log.ingest`, which retains a handle and releases it when the
 * entry falls out of the ring buffer. Mirroring here instead produced a handle nobody
 * was responsible for releasing — the registry kept a strong reference to every REPL
 * result for the life of the page — and it also flattened the value to a description
 * string on the way out, so the caller could no longer expand what it had just asked for.
 *
 * `threw` is not redundant with `error !== undefined`: `throw undefined` is legal, and an
 * expression evaluating to `undefined` is routine. The two must stay distinguishable.
 */
export interface EvaluationResult {
  /** What the expression produced. Meaningless when `threw`. */
  value?: unknown;
  /** What was thrown. Not necessarily an `Error` — `throw 1` is legal. */
  error?: unknown;
  threw: boolean;
  /** Wall time of the evaluation, in milliseconds. */
  duration: number;
}

const DEFAULT_CAPTURE: Required<CaptureOptions> = {
  console: true,
  exceptions: true,
  rejections: true,
  resourceErrors: true,
  cspViolations: true,
  xhr: true,
  fetch: true,
  beacon: true,
  websocket: true,
  eventSource: true,
  resourceTiming: true,
};

export class OptikKernel {
  readonly events = new Emitter<KernelEvents>();
  readonly log: LogDomain;
  readonly network: NetworkDomain;
  readonly storage = new StorageDomain();
  readonly system = new SystemDomain();

  /** Pristine console methods. Use these inside plugins to avoid feedback loops. */
  console: Readonly<Record<string, (...args: unknown[]) => void>> = globalThis.console as never;

  #instrumentation: Instrumentation[] = [];
  #consoleInstrumentation?: ConsoleInstrumentation;
  #domainUnsubscribes: Array<() => void> = [];
  #started = false;
  #capture: Required<CaptureOptions>;
  #options: KernelOptions;
  /** History of `evaluate` results, exposed to the REPL as `$_`. */
  #lastEvaluation: unknown;

  constructor(options: KernelOptions = {}) {
    this.#options = options;
    this.#capture = { ...DEFAULT_CAPTURE, ...options.capture };
    this.log = new LogDomain(options.log);
    this.network = new NetworkDomain(options.network);
    this.#wireDomains();
  }

  get started(): boolean {
    return this.#started;
  }

  start(): void {
    if (this.#started) return;
    this.#wireDomains();
    this.#started = true;

    const capture = this.#capture;
    const maxBodyBytes = this.#options.maxBodyBytes;
    const networkSink = { onStart: this.network.onStart, onUpdate: this.network.onUpdate };
    const nextId = this.network.nextId;

    if (capture.console) {
      this.#consoleInstrumentation = instrumentConsole(
        (record) => {
          if (record.clear) {
            this.log.clear();
            return;
          }
          this.log.ingest({
            level: record.level,
            origin: 'console',
            args: record.args,
            stackTrace: record.stackTrace,
            groupOp: record.groupOp,
          });
        },
        { passthrough: this.#options.passthrough ?? true },
      );
      this.console = this.#consoleInstrumentation.original;
    }

    if (
      capture.exceptions ||
      capture.rejections ||
      capture.resourceErrors ||
      capture.cspViolations
    ) {
      const errors = instrumentErrors(
        (record) =>
          this.log.ingest({
            level: record.level,
            origin: record.origin,
            args: record.args,
            stackTrace: record.stackTrace,
          }),
        {
          captureExceptions: capture.exceptions,
          captureRejections: capture.rejections,
          captureResourceErrors: capture.resourceErrors,
          captureCspViolations: capture.cspViolations,
        },
      );
      this.#instrumentation.push(errors);
    }

    if (capture.xhr) {
      this.#instrumentation.push(instrumentXhr(networkSink, { nextId, maxBodyBytes }));
    }
    if (capture.fetch) {
      this.#instrumentation.push(instrumentFetch(networkSink, { nextId, maxBodyBytes }));
    }
    if (capture.beacon) {
      this.#instrumentation.push(instrumentSendBeacon(networkSink, { nextId }));
    }
    if (capture.websocket) {
      this.#instrumentation.push(instrumentWebSocket(networkSink, { nextId }));
    }
    if (capture.eventSource) {
      this.#instrumentation.push(instrumentEventSource(networkSink, { nextId }));
    }
    if (capture.resourceTiming) {
      this.#instrumentation.push(
        instrumentResourceTiming(networkSink, { nextId, findByUrl: this.network.findByUrl }),
      );
    }
  }

  /**
   * Evaluates an expression in the page's global scope — the console REPL.
   *
   * Uses indirect `eval` so the expression sees globals rather than this module's
   * closure, matching what a real console does. The expression is wrapped so an object
   * literal like `{a: 1}` parses as a value, not a block, which is the classic REPL
   * papercut.
   */
  evaluate(expression: string): EvaluationResult {
    const started = performance.now();
    const indirectEval = eval;

    // Expose `$_` (last result) the way DevTools does.
    const previous = (globalThis as Record<string, unknown>)['$_'];
    (globalThis as Record<string, unknown>)['$_'] = this.#lastEvaluation;

    try {
      let value: unknown;
      try {
        value = indirectEval(`(${expression}\n)`);
      } catch (wrapError) {
        // Statements (`let x = 1`, `if (...) {}`) fail when parenthesised; retry raw.
        if (wrapError instanceof SyntaxError) value = indirectEval(expression);
        else throw wrapError;
      }
      this.#lastEvaluation = value;
      return { value, threw: false, duration: performance.now() - started };
    } catch (error) {
      return { error, threw: true, duration: performance.now() - started };
    } finally {
      if (previous === undefined) delete (globalThis as Record<string, unknown>)['$_'];
      else (globalThis as Record<string, unknown>)['$_'] = previous;
    }
  }

  /** Removes every hook and restores the page to its pre-Optik state. */
  dispose(): void {
    for (const instrumentation of this.#instrumentation) {
      try {
        instrumentation.dispose();
      } catch {
        // Best effort — one failing restore must not block the others.
      }
    }
    this.#instrumentation = [];

    try {
      this.#consoleInstrumentation?.dispose();
    } catch {
      // Best effort.
    }
    this.#consoleInstrumentation = undefined;

    for (const unsubscribe of this.#domainUnsubscribes) unsubscribe();
    this.#domainUnsubscribes = [];
    this.log.dispose();
    this.network.dispose();
    this.events.clear();
    this.#started = false;
  }

  /** Rebuilds the domain event bridge after a dispose/start cycle. */
  #wireDomains(): void {
    if (this.#domainUnsubscribes.length > 0) return;
    this.#domainUnsubscribes = [
      this.log.events.on('entryAdded', (entry) => this.events.emit('logAdded', entry)),
      this.log.events.on('entryUpdated', (entry) => this.events.emit('logUpdated', entry)),
      this.log.events.on('cleared', () => this.events.emit('logCleared', undefined)),
      this.network.events.on('requestStarted', (record) =>
        this.events.emit('networkStarted', record),
      ),
      this.network.events.on('requestUpdated', (record) =>
        this.events.emit('networkUpdated', record),
      ),
      this.network.events.on('cleared', () => this.events.emit('networkCleared', undefined)),
    ];
  }
}
