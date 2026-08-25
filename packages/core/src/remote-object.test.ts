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

  it('degrades hostile and revoked proxies without throwing from reflection', () => {
    const registry = new ObjectRegistry();
    const hostile = new Proxy(
      {},
      {
        get(_target, key) {
          if (key === Symbol.toStringTag) throw new Error('no reflection');
          return undefined;
        },
        getPrototypeOf() {
          throw new Error('no prototype');
        },
        ownKeys() {
          throw new Error('no keys');
        },
      },
    );
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(() => toRemoteObject(hostile, registry)).not.toThrow();
    expect(() => toRemoteObject(proxy, registry)).not.toThrow();
  });

  it('describes common platform subtypes and bounded map/set entries', () => {
    const registry = new ObjectRegistry();
    const cases: Array<[unknown, string, string | undefined]> = [
      [new Date('invalid'), 'Invalid Date', 'date'],
      [/value/gi, '/value/gi', 'regexp'],
      [new Uint8Array(3), 'Uint8Array(3)', 'typedarray'],
      [new ArrayBuffer(4), 'ArrayBuffer(4)', 'arraybuffer'],
      [new DataView(new ArrayBuffer(5)), 'DataView(5)', 'dataview'],
      [Promise.resolve(1), 'Promise', 'promise'],
      [new URL('https://example.test/path'), 'https://example.test/path', 'url'],
      [document.createTextNode('hello'), '#text "hello"', 'node'],
      [document.createComment('note'), '<!--note-->', 'node'],
    ];
    for (const [value, description, subtype] of cases) {
      expect(toRemoteObject(value, registry)).toMatchObject({ description, subtype });
    }
    expect(toRemoteObject(new Error('broken'), registry)).toMatchObject({ subtype: 'error' });
    expect(toRemoteObject(new Error('broken'), registry).description).toContain('broken');
    class BlobFixture {
      readonly size = 3;
      get [Symbol.toStringTag]() {
        return 'Blob';
      }
    }
    expect(toRemoteObject(new BlobFixture(), registry)).toMatchObject({
      subtype: 'blob',
      description: 'BlobFixture(3)',
    });

    const map = toRemoteObject(new Map([['a', 1], ['b', 2]]), registry, {
      ...DEFAULT_PREVIEW_LIMITS,
      maxEntries: 1,
    });
    const set = toRemoteObject(new Set([1, 2]), registry, {
      ...DEFAULT_PREVIEW_LIMITS,
      maxEntries: 1,
    });
    expect(map.preview).toMatchObject({ overflow: true, entries: [{ key: expect.anything() }] });
    expect(set.preview).toMatchObject({ overflow: true, entries: [{ value: expect.anything() }] });
  });

  it('walks prototypes and expands synthetic map/set entries', () => {
    const registry = new ObjectRegistry();
    const parent = { inherited: 1 };
    const child = Object.create(parent) as { own: number };
    child.own = 2;
    const remote = toRemoteObject(child, registry);
    const properties = getProperties(remote.objectId!, registry, { ownProperties: false });
    expect(properties?.find((property) => property.name === 'own')).toMatchObject({ isOwn: true });
    expect(properties?.find((property) => property.name === 'inherited')).toMatchObject({
      isOwn: false,
    });

    const mapped = toRemoteObject(new Map([['key', 'value']]), registry);
    expect(getProperties(mapped.objectId!, registry)?.[0]).toMatchObject({
      name: '0',
      keyKind: 'internal',
    });
    const set = toRemoteObject(new Set(['value']), registry);
    expect(getProperties(set.objectId!, registry)?.[0]?.value?.value).toBe('value');
  });
});
