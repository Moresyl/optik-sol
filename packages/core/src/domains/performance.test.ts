import { describe, expect, it, vi } from 'vitest';
import type { LongTaskRecord } from '../types';
import { PerformanceDomain } from './performance';

function record(id: string, duration = 50): LongTaskRecord {
  return { id, startTime: 1, duration, name: 'self', attribution: [] };
}

describe('PerformanceDomain', () => {
  it('retains a bounded long-task history and emits additions', () => {
    const domain = new PerformanceDomain({ maxLongTasks: 2 });
    const added = vi.fn();
    domain.events.on('longTaskAdded', added);

    domain.onLongTask(record('task:1'));
    domain.onLongTask(record('task:2', 60));
    domain.onLongTask(record('task:3', 70));

    expect(domain.size).toBe(2);
    expect(domain.longTasks().map((item) => item.id)).toEqual(['task:2', 'task:3']);
    expect(added).toHaveBeenLastCalledWith(record('task:3', 70));
  });

  it('generates stable ids, clears, resizes, and rejects invalid capacities', () => {
    const domain = new PerformanceDomain({ maxLongTasks: 3 });
    const cleared = vi.fn();
    const resized = vi.fn();
    domain.events.on('cleared', cleared);
    domain.events.on('resized', resized);

    expect(domain.nextId()).toBe('task:1');
    expect(domain.nextId()).toBe('task:2');
    domain.onLongTask(record('manual'));
    domain.setMaxLongTasks(1.9);
    expect(resized).toHaveBeenCalledWith(1);
    expect(() => domain.setMaxLongTasks(Number.NaN)).toThrow(RangeError);
    domain.clear();
    expect(domain.longTasks()).toEqual([]);
    expect(cleared).toHaveBeenCalledOnce();
  });

  it('disposes retained records and listeners', () => {
    const domain = new PerformanceDomain();
    const added = vi.fn();
    domain.events.on('longTaskAdded', added);
    domain.onLongTask(record('task:1'));
    domain.dispose();
    domain.onLongTask(record('task:2'));
    expect(domain.longTasks()).toEqual([record('task:2')]);
    expect(added).toHaveBeenCalledOnce();
  });
});
