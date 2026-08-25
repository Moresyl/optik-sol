/**
 * Performance domain: bounded, queryable evidence of main-thread stalls.
 *
 * Long tasks are a stream just like logs and requests. Keeping them in a bounded
 * domain rather than exposing PerformanceObserver directly gives UI and remote
 * clients one stable API, while preventing a long-lived debugging session from
 * accumulating records forever.
 */

import { Emitter } from '../emitter';
import { RingBuffer } from '../ring-buffer';
import type { LongTaskRecord } from '../types';

export interface PerformanceDomainOptions {
  /** Largest number of long tasks retained. Default 200. */
  maxLongTasks?: number;
}

export interface PerformanceDomainEvents {
  longTaskAdded: LongTaskRecord;
  cleared: void;
  resized: number;
}

export class PerformanceDomain {
  readonly events = new Emitter<PerformanceDomainEvents>();

  #longTasks: RingBuffer<LongTaskRecord>;
  #nextId = 1;

  constructor(options: PerformanceDomainOptions = {}) {
    this.#longTasks = new RingBuffer(options.maxLongTasks ?? 200);
  }

  get size(): number {
    return this.#longTasks.size;
  }

  longTasks(): LongTaskRecord[] {
    return this.#longTasks.toArray();
  }

  nextId = (): string => `task:${this.#nextId++}`;

  onLongTask = (record: LongTaskRecord): void => {
    this.#longTasks.push(record);
    this.events.emit('longTaskAdded', record);
  };

  clear(): void {
    this.#longTasks.clear();
    this.events.emit('cleared', undefined);
  }

  setMaxLongTasks(max: number): void {
    this.#longTasks.resize(max);
    this.events.emit('resized', this.#longTasks.capacity);
  }

  dispose(): void {
    this.#longTasks.clear();
    this.events.clear();
  }
}
