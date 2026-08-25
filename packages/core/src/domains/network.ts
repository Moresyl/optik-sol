/**
 * Network domain: record store, live patching, and correlation with Resource Timing.
 */

import { Emitter } from '../emitter';
import { RingBuffer } from '../ring-buffer';
import {
  ObjectRegistry,
  getProperties,
  toRemoteObject,
  type GetPropertiesOptions,
  type PreviewLimits,
  type PropertyDescriptor,
} from '../remote-object';
import { isTextualMime } from '../instrument/body';
import type { NetworkBody, NetworkRecord } from '../types';

export interface NetworkDomainOptions {
  maxRecords?: number;
  previewLimits?: PreviewLimits;
  /** Parse JSON request and response bodies into an expandable tree. Default true. */
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
    if (this.#parseJson) {
      this.#attachParsedBody(record.requestBody);
      this.#attachParsedBody(record.responseBody);
    }
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

    if (this.#parseJson) {
      // A request body can arrive here rather than at onStart: fetch(Request) and
      // XHR both hand over the payload after the record already exists.
      if (patch.requestBody?.text) this.#attachParsedBody(record.requestBody);
      if (patch.responseBody?.text) this.#attachParsedBody(record.responseBody);
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

  /**
   * Expands a mirrored body one level. Returns `null` when the handle has been
   * released, which the UI must surface rather than showing an empty object.
   *
   * This domain keeps its own registry, so its ids are only meaningful here: `obj:3`
   * names one object in this registry and an unrelated one in the log domain's. A
   * caller holding a `RemoteObject` must expand it through the domain that produced
   * it — resolving it anywhere else silently returns some other object's properties.
   */
  getProperties(objectId: string, options?: GetPropertiesOptions): PropertyDescriptor[] | null {
    return getProperties(objectId, this.registry, options, this.#limits);
  }

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

  /**
   * Mirrors a JSON body into the registry so the UI can render it as a tree.
   *
   * This runs for request bodies as well as responses. A POST payload is exactly as
   * likely to be JSON as what comes back, and leaving it unparsed meant one panel
   * showed a browsable tree above a single unwrapped line of minified text —
   * the same data, one of the two readable, for no reason the user could see.
   */
  #attachParsedBody(body: NetworkBody | undefined): void {
    if (!body?.text || body.parsed) return;
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
    for (const body of [record.requestBody, record.responseBody]) {
      const id = body?.parsed?.objectId;
      if (id) this.registry.release(id);
    }
  }
}
