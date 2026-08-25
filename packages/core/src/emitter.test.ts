import { describe, expect, it, vi } from 'vitest';
import { Emitter } from './emitter';

interface Events {
  value: number;
  done: void;
}

describe('Emitter', () => {
  it('subscribes, unsubscribes, and clears listeners', () => {
    const emitter = new Emitter<Events>();
    const listener = vi.fn();
    const off = emitter.on('value', listener);

    emitter.emit('value', 1);
    off();
    emitter.emit('value', 2);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(1);

    emitter.on('value', listener);
    emitter.clear();
    emitter.emit('value', 3);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('runs once listeners once and survives listener failures', () => {
    const emitter = new Emitter<Events>();
    const once = vi.fn();
    const healthy = vi.fn();
    emitter.once('done', once);
    emitter.on('done', () => {
      throw new Error('listener failed');
    });
    emitter.on('done', healthy);

    expect(() => emitter.emit('done', undefined)).not.toThrow();
    emitter.emit('done', undefined);

    expect(once).toHaveBeenCalledOnce();
    expect(healthy).toHaveBeenCalledTimes(2);
  });

  it('dispatches from a snapshot when a listener unsubscribes itself', () => {
    const emitter = new Emitter<Events>();
    const calls: string[] = [];
    let off = () => {};
    off = emitter.on('value', () => {
      calls.push('first');
      off();
    });
    emitter.on('value', () => calls.push('second'));

    emitter.emit('value', 1);
    emitter.emit('value', 2);
    expect(calls).toEqual(['first', 'second', 'second']);
  });
});
