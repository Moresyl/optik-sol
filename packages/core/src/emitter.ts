/**
 * Minimal typed event emitter. ~40 lines instead of a dependency.
 *
 * Listeners are copied before dispatch so a handler that unsubscribes itself (very
 * common in UI teardown) does not corrupt the iteration.
 */

export type Listener<T> = (payload: T) => void;
export type Unsubscribe = () => void;

/**
 * `Events` is constrained to `object` rather than `Record<string, unknown>` because a
 * TypeScript *interface* has no implicit index signature, so an event map declared as
 * an interface (which is what callers naturally write) would not satisfy the tighter
 * constraint. Indexing stays fully type-safe via `keyof Events`.
 */
export class Emitter<Events extends object> {
  #listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): Unsubscribe {
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => {
      set!.delete(listener as Listener<never>);
    };
  }

  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): Unsubscribe {
    const off = this.on(event, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.#listeners.get(event);
    if (!set || set.size === 0) return;
    for (const listener of [...set]) {
      try {
        (listener as Listener<Events[K]>)(payload);
      } catch {
        // A broken listener must never take down instrumentation of the host page.
      }
    }
  }

  clear(): void {
    this.#listeners.clear();
  }
}
