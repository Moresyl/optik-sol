import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OptikKernel } from 'optik-core';
import { createStore } from './store';

describe('createStore', () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let kernel: OptikKernel;

  beforeEach(() => {
    vi.useFakeTimers();
    frames = new Map();
    nextFrame = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    kernel = new OptikKernel({ capture: { console: false } });
  });

  afterEach(() => {
    kernel.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const flush = () => {
    const queued = [...frames.values()];
    frames.clear();
    for (const callback of queued) callback(performance.now());
  };

  it('batches domain events and prunes selections evicted by a resize', () => {
    const store = createStore(kernel);
    const first = kernel.log.ingest({ level: 'log', origin: 'user', args: ['first'] })!;
    kernel.log.ingest({ level: 'warn', origin: 'user', args: ['second'] });
    flush();
    store.toggleSelected(first.id);
    expect(store.selection().has(first.id)).toBe(true);

    kernel.log.setMaxEntries(1);
    expect(store.logs()).toHaveLength(2);
    flush();

    expect(store.logs().map((entry) => entry.text)).toEqual(['second']);
    expect(store.selection().has(first.id)).toBe(false);
    store.dispose();
  });

  it('refreshes network state after a runtime capacity change', () => {
    const store = createStore(kernel);
    for (let index = 0; index < 2; index++) {
      kernel.network.onStart({
        id: `net:${index}`,
        initiator: 'fetch',
        method: 'GET',
        url: `https://example.test/${index}`,
        name: String(index),
        origin: 'https://example.test',
        query: [],
        requestHeaders: [],
        responseHeaders: [],
        phase: 'pending',
        timing: { startTime: index },
      });
    }
    flush();
    kernel.network.setMaxRecords(1);
    flush();
    expect(store.requests().map((record) => record.id)).toEqual(['net:1']);
    store.dispose();
  });

  it('retains a bounded, deduplicated REPL history for the mounted session', () => {
    const store = createStore(kernel);
    for (let index = 0; index < 52; index++) store.recordReplCommand(String(index));
    store.recordReplCommand('40');

    expect(store.replHistory()).toHaveLength(50);
    expect(store.replHistory().slice(0, 3)).toEqual(['40', '51', '50']);
    expect(store.replHistory().filter((item) => item === '40')).toHaveLength(1);
    store.dispose();
  });

  it('cancels a pending refresh and unsubscribes on dispose', () => {
    const store = createStore(kernel);
    kernel.log.ingest({ level: 'log', origin: 'user', args: ['queued'] });
    expect(frames.size).toBe(1);

    store.dispose();
    expect(frames.size).toBe(0);
    kernel.log.ingest({ level: 'log', origin: 'user', args: ['after dispose'] });
    expect(frames.size).toBe(0);
  });

  it('uses a timeout watchdog when an animation frame is paused in the background', () => {
    const store = createStore(kernel);
    kernel.log.ingest({ level: 'log', origin: 'user', args: ['background'] });
    expect(store.logs()).toHaveLength(0);
    expect(frames.size).toBe(1);

    vi.advanceTimersByTime(99);
    expect(store.logs()).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(store.logs().map((entry) => entry.text)).toEqual(['background']);
    expect(frames.size).toBe(0);
    store.dispose();
  });

  it('falls back to a short timer when requestAnimationFrame throws', () => {
    vi.stubGlobal('requestAnimationFrame', () => {
      throw new Error('blocked');
    });
    const store = createStore(kernel);
    kernel.log.ingest({ level: 'log', origin: 'user', args: ['fallback'] });
    vi.advanceTimersByTime(15);
    expect(store.logs()).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(store.logs().map((entry) => entry.text)).toEqual(['fallback']);
    store.dispose();
  });
});
