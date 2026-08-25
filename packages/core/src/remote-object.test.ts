import { describe, expect, it } from 'vitest';
import { DEFAULT_PREVIEW_LIMITS, getProperties, ObjectRegistry, toRemoteObject } from './remote-object';

describe('ObjectRegistry', () => {
  it('reference-counts repeated values and mints a fresh id after final release', () => {
    const registry = new ObjectRegistry();
    const value = {};
    const first = registry.retain(value);
    expect(registry.retain(value)).toBe(first);
    expect(registry.size).toBe(1);

    registry.release(first);
    expect(registry.has(first)).toBe(true);
    registry.release(first);
    expect(registry.has(first)).toBe(false);

    const second = registry.retain(value);
    expect(second).not.toBe(first);
    registry.clear();
    expect(registry.size).toBe(0);
  });
});

describe('RemoteObject mirroring', () => {
  it('preserves JSON-unsafe primitives', () => {
    const registry = new ObjectRegistry();
    expect(toRemoteObject(Number.NaN, registry).unserializableValue).toBe('NaN');
    expect(toRemoteObject(-0, registry).unserializableValue).toBe('-0');
    expect(toRemoteObject(10n, registry).unserializableValue).toBe('10n');
    expect(toRemoteObject(Symbol('id'), registry)).toMatchObject({
      type: 'symbol',
      description: 'Symbol(id)',
    });
    expect(registry.size).toBe(0);
  });

  it('builds bounded, cycle-safe previews without invoking getters', () => {
    let getterCalls = 0;
    const value: Record<string, unknown> = { name: 'root' };
    Object.defineProperty(value, 'danger', {
      enumerable: true,
      get() {
        getterCalls++;
        return 'side effect';
      },
    });
    value['self'] = value;

    const remote = toRemoteObject(value, new ObjectRegistry(), {
      ...DEFAULT_PREVIEW_LIMITS,
      maxProperties: 3,
    });

    expect(getterCalls).toBe(0);
    expect(remote.preview?.properties.find((property) => property.name === 'danger')?.value).toBe(
      '(...)',
    );
    expect(remote.preview?.properties.find((property) => property.name === 'self')?.value).toContain(
      '[Circular]',
    );
  });

  it('lists distinct symbols even when their descriptions match', () => {
    const first = Symbol('same');
    const second = Symbol('same');
    const value = { [first]: 1, [second]: 2 };
    const registry = new ObjectRegistry();
    const remote = toRemoteObject(value, registry);

    const properties = getProperties(
      remote.objectId!,
      registry,
      { includeNonEnumerable: true },
    );
    const symbols = properties?.filter((property) => property.keyKind === 'symbol') ?? [];

    expect(symbols).toHaveLength(2);
    expect(symbols.map((property) => property.value?.value)).toEqual([1, 2]);
  });

  it('does not invoke getters unless requested and reports thrown values', () => {
    const value = {
      get ok() {
        return 42;
      },
      get broken() {
        throw new Error('no access');
      },
    };
    const registry = new ObjectRegistry();
    const remote = toRemoteObject(value, registry);

    const passive = getProperties(remote.objectId!, registry);
    expect(passive?.find((property) => property.name === 'ok')?.value).toBeUndefined();

    const invoked = getProperties(remote.objectId!, registry, { invokeGetters: true });
    expect(invoked?.find((property) => property.name === 'ok')?.value?.value).toBe(42);
    expect(invoked?.find((property) => property.name === 'broken')?.wasThrown).toBe('no access');
  });

  it('returns null after a handle is released', () => {
    const registry = new ObjectRegistry();
    const remote = toRemoteObject({}, registry);
    registry.release(remote.objectId!);
    expect(getProperties(remote.objectId!, registry)).toBeNull();
  });
});
