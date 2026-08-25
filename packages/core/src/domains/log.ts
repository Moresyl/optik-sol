/**
 * Log domain: owns the entry buffer, the object registry, and ingestion.
 *
 * Ownership matters here. The registry lifetime is tied to the ring buffer: when an
 * entry is evicted, every RemoteObject it retained is released in the same step. That
 * invariant is what lets Optik run for hours in a page that logs in a render loop
 * without the debugger becoming the memory leak.
 */

import { Emitter } from '../emitter';
import { RingBuffer } from '../ring-buffer';
import {
  DEFAULT_PREVIEW_LIMITS,
  getProperties,
  ObjectRegistry,
  toRemoteObject,
  type GetPropertiesOptions,
  type PreviewLimits,
  type PropertyDescriptor,
  type RemoteObject,
} from '../remote-object';
import {
  flattenToText,
  formatStyledParts,
  hasFormatSpecifier,
  remoteObjectToText,
} from '../format';
import type { CallFrame, LogEntry, LogLevel, LogOrigin, StyledPart } from '../types';

export interface LogDomainOptions {
  maxEntries?: number;
  previewLimits?: PreviewLimits;
  /** Collapse consecutive identical entries into a repeat counter. Default true. */
  coalesceRepeats?: boolean;
}

export interface LogDomainEvents {
  entryAdded: LogEntry;
  /** Emitted when an existing entry's repeat counter increments. */
  entryUpdated: LogEntry;
  cleared: void;
  resized: number;
}

export interface IngestOptions {
  level: LogLevel;
  origin: LogOrigin;
  args: unknown[];
  stackTrace?: CallFrame[];
  groupOp?: 'start' | 'startCollapsed' | 'end';
  channel?: string;
}

export class LogDomain {
  readonly events = new Emitter<LogDomainEvents>();
  readonly registry = new ObjectRegistry();

  #entries: RingBuffer<LogEntry>;
  #limits: PreviewLimits;
  #coalesce: boolean;
  #groupDepth = 0;
  #nextId = 1;
  /** Retained handles per entry, released together on eviction. */
  #handles = new Map<string, string[]>();

  constructor(options: LogDomainOptions = {}) {
    const {
      maxEntries = 5000,
      previewLimits = DEFAULT_PREVIEW_LIMITS,
      coalesceRepeats = true,
    } = options;
    this.#limits = previewLimits;
    this.#coalesce = coalesceRepeats;
    this.#entries = new RingBuffer<LogEntry>(maxEntries, (evicted) => this.#releaseEntry(evicted));
  }

  get size(): number {
    return this.#entries.size;
  }

  entries(): LogEntry[] {
    return this.#entries.toArray();
  }

  ingest(options: IngestOptions): LogEntry | undefined {
    const { level, origin, args, stackTrace, channel } = options;

    if (options.groupOp === 'end') {
      this.#groupDepth = Math.max(0, this.#groupDepth - 1);
      return undefined;
    }

    const remoteArgs = args.map((arg) => toRemoteObject(arg, this.registry, this.#limits));
    const { text, styledParts } = this.#render(args, remoteArgs);

    const entry: LogEntry = {
      id: `log:${this.#nextId++}`,
      level,
      origin,
      timestamp: Date.now(),
      args: remoteArgs,
      text,
      styledParts,
      repeatCount: 1,
      stackTrace,
      groupDepth: this.#groupDepth,
      channel,
    };

    if (options.groupOp === 'start' || options.groupOp === 'startCollapsed') {
      entry.groupStart = { collapsed: options.groupOp === 'startCollapsed', label: text };
      this.#groupDepth++;
    }

    // Coalescing happens before insertion so a repeated line never allocates a slot.
    if (this.#coalesce && !entry.groupStart) {
      const last = this.#entries.at(this.#entries.size - 1);
      if (last && this.#isSameLine(last, entry)) {
        last.repeatCount++;
        last.timestamp = entry.timestamp;
        // The new mirror is redundant; release it immediately.
        this.#releaseHandles(remoteArgs);
        this.events.emit('entryUpdated', last);
        return last;
      }
    }

    this.#handles.set(
      entry.id,
      remoteArgs.map((arg) => arg.objectId).filter((id): id is string => id !== undefined),
    );

    this.#entries.push(entry);
    this.events.emit('entryAdded', entry);
    return entry;
  }

  /**
   * Expands a mirrored object one level. Returns `null` when the handle has been
   * released, which the UI must surface rather than showing an empty object.
   */
  getProperties(objectId: string, options?: GetPropertiesOptions): PropertyDescriptor[] | null {
    return getProperties(objectId, this.registry, options, this.#limits);
  }

  clear(): void {
    this.#entries.clear();
    this.#handles.clear();
    this.#groupDepth = 0;
    this.events.emit('cleared', undefined);
  }

  setMaxEntries(max: number): void {
    this.#entries.resize(max);
    this.events.emit('resized', this.#entries.capacity);
  }

  dispose(): void {
    this.#entries.clear();
    this.#handles.clear();
    this.registry.clear();
    this.events.clear();
  }

  // -------------------------------------------------------------------------

  /**
   * Applies console format directives when the first argument is a format string,
   * otherwise joins the arguments the way a browser console does.
   */
  #render(
    rawArgs: unknown[],
    remoteArgs: RemoteObject[],
  ): { text: string; styledParts?: StyledPart[] } {
    const first = rawArgs[0];

    if (typeof first === 'string' && rawArgs.length > 1 && hasFormatSpecifier(first)) {
      const describe = (value: unknown) => {
        const index = rawArgs.indexOf(value);
        const mirrored = index >= 0 ? remoteArgs[index] : undefined;
        return mirrored ? remoteObjectToText(mirrored, 1) : String(value);
      };

      const { parts, consumed } = formatStyledParts(first, rawArgs.slice(1), describe);
      const trailing = remoteArgs.slice(1 + consumed);
      const trailingText = trailing.length > 0 ? ' ' + flattenToText(trailing) : '';

      if (trailingText) parts.push({ text: trailingText });

      return {
        text: parts.map((part) => part.text).join(''),
        // Only keep styled parts when styling was actually requested.
        styledParts: parts.some((part) => part.css) ? parts : undefined,
      };
    }

    return { text: flattenToText(remoteArgs) };
  }

  /** Two entries coalesce only if they are textually and structurally identical. */
  #isSameLine(a: LogEntry, b: LogEntry): boolean {
    return (
      a.level === b.level &&
      a.origin === b.origin &&
      a.channel === b.channel &&
      a.groupDepth === b.groupDepth &&
      a.text === b.text &&
      a.args.length === b.args.length
    );
  }

  #releaseEntry(entry: LogEntry): void {
    const ids = this.#handles.get(entry.id);
    if (!ids) return;
    for (const id of ids) this.registry.release(id);
    this.#handles.delete(entry.id);
  }

  #releaseHandles(args: RemoteObject[]): void {
    for (const arg of args) {
      if (arg.objectId) this.registry.release(arg.objectId);
    }
  }
}
