import { describe, expect, it, vi } from 'vitest';
import { RingBuffer } from './ring-buffer';

describe('RingBuffer', () => {
  it('keeps insertion order while evicting the oldest item', () => {
    const onEvict = vi.fn();
    const buffer = new RingBuffer<number>(3, onEvict);

    expect(buffer.push(1)).toBeUndefined();
    buffer.push(2);
    buffer.push(3);
    expect(buffer.push(4)).toBe(1);

    expect(buffer.toArray()).toEqual([2, 3, 4]);
    expect([...buffer]).toEqual([2, 3, 4]);
    expect(buffer.at(0)).toBe(2);
    expect(buffer.at(2)).toBe(4);
    expect(buffer.at(-1)).toBeUndefined();
    expect(buffer.at(3)).toBeUndefined();
    expect(onEvict).toHaveBeenCalledWith(1);
  });

  it('preserves newest entries and reports evictions when resized', () => {
    const onEvict = vi.fn();
    const buffer = new RingBuffer<number>(4, onEvict);
    [1, 2, 3, 4].forEach((value) => buffer.push(value));

    buffer.resize(2);
    expect(buffer.capacity).toBe(2);
    expect(buffer.toArray()).toEqual([3, 4]);
    expect(onEvict.mock.calls).toEqual([[1], [2]]);

    buffer.resize(5);
    expect(buffer.toArray()).toEqual([3, 4]);
  });

  it('evicts every retained item when cleared', () => {
    const onEvict = vi.fn();
    const buffer = new RingBuffer<string>(2, onEvict);
    buffer.push('a');
    buffer.push('b');

    buffer.clear();

    expect(buffer.size).toBe(0);
    expect(buffer.toArray()).toEqual([]);
    expect(onEvict.mock.calls).toEqual([['a'], ['b']]);
  });

  it.each([0, -1, 1_000_001, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid capacity: %s',
    (capacity) => {
      expect(() => new RingBuffer(capacity)).toThrow(/capacity must be/i);
      const buffer = new RingBuffer(1);
      expect(() => buffer.resize(capacity)).toThrow(/capacity must be/i);
    },
  );
});
