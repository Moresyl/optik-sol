/**
 * Network domain: record store, live patching, and correlation with Resource Timing.
 */

import { Emitter } from '../emitter';
import { RingBuffer } from '../ring-buffer';
import { ObjectRegistry, toRemoteObject, type PreviewLimits } from '../remote-object';
import { isTextualMime } from '../instrument/body';
import type { NetworkRecord } from '../types';

export interface NetworkDomainOptions {
  maxRecords?: number;
  previewLimits?: PreviewLimits;
  /** Parse JSON response bodies into an expandable tree. Default true. */
  parseJsonBodies?: boolean;
}

export interface NetworkDomainEvents {
  requestStarted: NetworkRecord;
  requestUpdated: NetworkRecord;
  cleared: void;
}

export class NetworkDomain {
  readonly events = new Emitter<NetworkDomainEvents>();
  readonly registry = new ObjectRegistry();

  #records: RingBuffer<NetworkRecord>;
  #byId = new Map<string, NetworkRecord>();
  #parseJson: boolean;
  #limits: PreviewLimits | undefined;
  #nextId = 1;

  constructor(options: NetworkDomainOptions = {}) {
    const { maxRecords = 1000, parseJsonBodies = true, previewLimits } = options;
    this.#parseJson = parseJsonBodies;
    this.#limits = previewLimits;
    this.#records = new RingBuffer<NetworkRecord>(maxRecords, (evicted) => {
      this.#byId.delete(evicted.id);
      this.#release(evicted);
    });
  }

  nextId = (): string => `net:${this.#nextId++}`;

  get size(): number {
    return this.#records.size;
  }

  records(): NetworkRecord[] {
    return this.#records.toArray();
  }

  get(id: string): NetworkRecord | undefined {
    return this.#byId.get(id);
  }

  onStart = (record: NetworkRecord): void => {
    this.#byId.set(record.id, record);
    this.#records.push(record);
    this.events.emit('requestStarted', record);
  };

  onUpdate = (id: string, patch: Partial<NetworkRecord>): void => {
    const record = this.#byId.get(id);
    // The record may already have been evicted by a burst of newer requests.
    if (!record) return;

    // Timing arrives in pieces from different sources (wrapper, then Resource Timing);
    // merging rather than replacing is what keeps the detailed phases once they land.
    if (patch.timing) {
      patch = { ...patch, timing: { ...record.timing, ...patch.timing } };
    }

    Object.assign(record, patch);

    if (this.#parseJson && patch.responseBody?.text && !record.responseBody?.parsed) {
      this.#attachParsedBody(record);
    }

    this.events.emit('requestUpdated', record);
  };

  /**
   * Finds a record matching a Resource Timing entry.
   *
   * Matching on URL alone is wrong when a page polls the same endpoint: the timing
   * entry would attach to the first record forever. We also require the start times to
   * be within a tolerance and prefer a record that has no detailed timing yet.
   */
  findByUrl = (url: string, startTime: number, toleranceMs = 250): string | undefined => {
    let best: NetworkRecord | undefined;
    let bestDelta = Infinity;

    for (let i = this.#records.size - 1; i >= 0; i--) {
      const record = this.#records.at(i);
      if (!record || record.url !== url) continue;
      if (record.timing.ttfb !== undefined) continue; // already correlated

      const delta = Math.abs(record.timing.startTime - startTime);
      if (delta < bestDelta && delta <= toleranceMs) {
        best = record;
        bestDelta = delta;
      }
    }
    return best?.id;
  };

  clear(): void {
    this.#records.clear();
    this.#byId.clear();
    this.events.emit('cleared', undefined);
  }

  setMaxRecords(max: number): void {
    this.#records.resize(max);
  }

  dispose(): void {
    this.#records.clear();
    this.#byId.clear();
    this.registry.clear();
    this.events.clear();
  }

  #attachParsedBody(record: NetworkRecord): void {
    const body = record.responseBody;
    if (!body?.text) return;
    // Truncated payloads are not valid JSON; parsing them produces confusing errors.
    if (body.omitted) return;

    const mime = body.mimeType;
    const looksJson =
      (mime && /json/.test(mime)) ||
      (!mime && /^\s*[[{]/.test(body.text) && isTextualMime('application/json'));
    if (!looksJson) return;

    try {
      const parsed: unknown = JSON.parse(body.text);
      body.parsed = toRemoteObject(parsed, this.registry, this.#limits);
    } catch {
      // Content-Type said JSON but the body is not; the raw text view still works.
    }
  }

  #release(record: NetworkRecord): void {
    const id = record.responseBody?.parsed?.objectId;
    if (id) this.registry.release(id);
  }
}
