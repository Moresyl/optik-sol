/**
 * Fixed-capacity circular buffer.
 *
 * The single biggest failure mode of in-page consoles is unbounded growth: a page that
 * logs in a rAF loop turns the debugger into the thing that crashes the tab. Every
 * append-only stream in Optik (log entries, network records, WebSocket frames) is
 * backed by one of these, and eviction is observable so owners can release the
 * resources an evicted item was holding (e.g. retained RemoteObject handles).
 */

export class RingBuffer<T> {
  #items: (T | undefined)[];
  #head = 0; // index of the oldest item
  #size = 0;
  #capacity: number;
  #onEvict?: (item: T) => void;

  constructor(capacity: number, onEvict?: (item: T) => void) {
    this.#capacity = normalizeCapacity(capacity);
    this.#items = new Array(this.#capacity);
    this.#onEvict = onEvict;
  }

  get size(): number {
    return this.#size;
  }

  get capacity(): number {
    return this.#capacity;
  }

  /** Pushes an item, returning the evicted item if the buffer was full. */
  push(item: T): T | undefined {
    const tail = (this.#head + this.#size) % this.#capacity;
    let evicted: T | undefined;

    if (this.#size === this.#capacity) {
      evicted = this.#items[this.#head];
      this.#head = (this.#head + 1) % this.#capacity;
    } else {
      this.#size++;
    }

    this.#items[tail] = item;
    if (evicted !== undefined) this.#onEvict?.(evicted);
    return evicted;
  }

  at(index: number): T | undefined {
    if (index < 0 || index >= this.#size) return undefined;
    return this.#items[(this.#head + index) % this.#capacity];
  }

  toArray(): T[] {
    const out: T[] = new Array(this.#size);
    for (let i = 0; i < this.#size; i++) out[i] = this.at(i)!;
    return out;
  }

  *[Symbol.iterator](): IterableIterator<T> {
    for (let i = 0; i < this.#size; i++) yield this.at(i)!;
  }

  clear(): void {
    if (this.#onEvict) {
      for (const item of this) this.#onEvict(item);
    }
    this.#items = new Array(this.#capacity);
    this.#head = 0;
    this.#size = 0;
  }

  /**
   * Grows or shrinks capacity, preserving the newest items. Shrinking evicts the
   * oldest overflow through the normal eviction callback.
   */
  resize(capacity: number): void {
    capacity = normalizeCapacity(capacity);
    if (capacity === this.#capacity) return;

    const existing = this.toArray();
    const overflow = Math.max(0, existing.length - capacity);
    const kept = existing.slice(overflow);

    if (this.#onEvict) {
      for (let i = 0; i < overflow; i++) this.#onEvict(existing[i]!);
    }

    this.#capacity = capacity;
    this.#items = new Array(capacity);
    this.#head = 0;
    this.#size = kept.length;
    for (let i = 0; i < kept.length; i++) this.#items[i] = kept[i];
  }
}

function normalizeCapacity(capacity: number): number {
  if (!Number.isFinite(capacity) || capacity < 1) {
    throw new RangeError('RingBuffer capacity must be a finite number >= 1');
  }
  return Math.floor(capacity);
}
