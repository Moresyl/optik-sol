import { describe, expect, it, vi } from 'vitest';
import { LogDomain } from './log';

describe('LogDomain', () => {
  it('ingests values and emits an entry with searchable text', () => {
    const domain = new LogDomain();
    const added = vi.fn();
    domain.events.on('entryAdded', added);

    const entry = domain.ingest({
      level: 'info',
      origin: 'console',
      args: ['answer', 42, { ok: true }],
      channel: 'system',
    });

    expect(entry).toMatchObject({
      id: 'log:1',
      level: 'info',
      origin: 'console',
      text: 'answer 42 Object {ok: true}',
      repeatCount: 1,
      groupDepth: 0,
      channel: 'system',
    });
    expect(domain.size).toBe(1);
    expect(domain.registry.size).toBe(1);
    expect(added).toHaveBeenCalledWith(entry);
  });

  it('applies console substitutions and preserves safe styled parts', () => {
    const domain = new LogDomain();
    const entry = domain.ingest({
      level: 'log',
      origin: 'console',
      args: ['%cCount %d', 'color:red;position:fixed', 2.8, 'tail'],
    });

    expect(entry?.text).toBe('Count 2 tail');
    expect(entry?.styledParts).toEqual([
      { text: 'Count 2', css: 'color:red' },
      { text: ' tail' },
    ]);
  });

  it('coalesces matching entries and releases the redundant mirror', () => {
    const domain = new LogDomain();
    const updated = vi.fn();
    domain.events.on('entryUpdated', updated);

    const shared = { value: 1 };
    const first = domain.ingest({ level: 'log', origin: 'console', args: [shared] });
    const repeated = domain.ingest({ level: 'log', origin: 'console', args: [shared] });

    expect(repeated).toBe(first);
    expect(first?.repeatCount).toBe(2);
    expect(domain.size).toBe(1);
    expect(domain.registry.size).toBe(1);
    expect(updated).toHaveBeenCalledWith(first);
  });

  it('does not collapse distinct objects that share the same shallow preview', () => {
    const domain = new LogDomain();
    const first = domain.ingest({ level: 'log', origin: 'console', args: [{}] });
    const second = domain.ingest({ level: 'log', origin: 'console', args: [{}] });

    expect(first?.text).toBe('Object');
    expect(second?.text).toBe('Object');
    expect(domain.size).toBe(2);
    expect(domain.registry.size).toBe(2);
  });

  it('coalesces equal primitives only at the same call site', () => {
    const domain = new LogDomain();
    const firstStack = [
      { functionName: 'run', url: 'app.js', lineNumber: 10, columnNumber: 2 },
    ];
    const secondStack = [
      { functionName: 'run', url: 'app.js', lineNumber: 11, columnNumber: 2 },
    ];
    const first = domain.ingest({
      level: 'log',
      origin: 'console',
      args: ['same', Number.NaN],
      stackTrace: firstStack,
    });
    domain.ingest({
      level: 'log',
      origin: 'console',
      args: ['same', Number.NaN],
      stackTrace: firstStack.map((frame) => ({ ...frame })),
    });
    domain.ingest({
      level: 'log',
      origin: 'console',
      args: ['same', Number.NaN],
      stackTrace: secondStack,
    });

    expect(first?.repeatCount).toBe(2);
    expect(domain.size).toBe(2);
  });

  it('does not coalesce entries from different levels, channels, or groups', () => {
    const domain = new LogDomain();
    domain.ingest({ level: 'log', origin: 'console', args: ['same'] });
    domain.ingest({ level: 'warn', origin: 'console', args: ['same'] });
    domain.ingest({ level: 'warn', origin: 'console', args: ['same'], channel: 'other' });
    domain.ingest({ level: 'log', origin: 'console', args: ['group'], groupOp: 'start' });
    domain.ingest({ level: 'log', origin: 'console', args: ['same'] });

    expect(domain.size).toBe(5);
  });

  it('tracks nested group depth without going below zero', () => {
    const domain = new LogDomain();
    const outer = domain.ingest({
      level: 'log',
      origin: 'console',
      args: ['outer'],
      groupOp: 'startCollapsed',
    });
    const inner = domain.ingest({ level: 'log', origin: 'console', args: ['inner'] });
    expect(domain.ingest({ level: 'log', origin: 'console', args: [], groupOp: 'end' })).toBe(
      undefined,
    );
    domain.ingest({ level: 'log', origin: 'console', args: [], groupOp: 'end' });
    const after = domain.ingest({ level: 'log', origin: 'console', args: ['after'] });

    expect(outer?.groupStart).toEqual({ collapsed: true, label: 'outer' });
    expect(outer?.groupDepth).toBe(0);
    expect(inner?.groupDepth).toBe(1);
    expect(after?.groupDepth).toBe(0);
  });

  it('releases object handles on eviction, clear, resize, and dispose', () => {
    const domain = new LogDomain({ maxEntries: 2, coalesceRepeats: false });
    const first = domain.ingest({ level: 'log', origin: 'console', args: [{ id: 1 }] })!;
    domain.ingest({ level: 'log', origin: 'console', args: [{ id: 2 }] });
    expect(domain.registry.has(first.args[0]!.objectId!)).toBe(true);

    domain.ingest({ level: 'log', origin: 'console', args: [{ id: 3 }] });
    expect(domain.registry.has(first.args[0]!.objectId!)).toBe(false);

    domain.setMaxEntries(1);
    expect(domain.size).toBe(1);
    domain.clear();
    expect(domain.size).toBe(0);
    expect(domain.registry.size).toBe(0);

    domain.ingest({ level: 'log', origin: 'console', args: [{ id: 4 }] });
    domain.dispose();
    expect(domain.registry.size).toBe(0);
  });

  it('expands retained values and reports a released handle', () => {
    const domain = new LogDomain();
    const entry = domain.ingest({ level: 'log', origin: 'user', args: [{ answer: 42 }] })!;
    const objectId = entry.args[0]!.objectId!;

    expect(domain.getProperties(objectId)?.find((property) => property.name === 'answer')?.value)
      .toMatchObject({ value: 42 });
    domain.clear();
    expect(domain.getProperties(objectId)).toBeNull();
  });
});
