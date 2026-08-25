import { describe, expect, it, vi } from 'vitest';
import {
  ObjectRegistry,
  getProperties,
  toRemoteObject,
  type OptikKernel,
  type PropertyDescriptor,
  type RemoteObject,
} from 'optik-core';
import { remoteObjectToDeepText } from './deep-text';

function kernelFor(registry: ObjectRegistry): OptikKernel {
  return {
    log: {
      registry,
      getProperties: (objectId: string, options: { ownProperties?: boolean }) =>
        getProperties(objectId, registry, options),
    },
  } as unknown as OptikKernel;
}

describe('remoteObjectToDeepText', () => {
  it('renders nested values, list-like containers, and non-JSON primitives', () => {
    const registry = new ObjectRegistry();
    const remote = toRemoteObject(
      {
        list: [1, 'two'],
        typed: new Uint8Array([3, 4]),
        nullable: null,
        missing: undefined,
        bigint: 5n,
      },
      registry,
    );

    const text = remoteObjectToDeepText(remote, kernelFor(registry));

    expect(text).toContain('"list": [\n    1,\n    "two"');
    expect(text).toContain('Uint8Array(2) [');
    expect(text).toContain('"nullable": null');
    expect(text).toContain('"missing": undefined');
    expect(text).toContain('"bigint": 5n');
    expect(registry.size).toBe(1);
  });

  it('marks cycles and depth overflow without invoking getters', () => {
    const registry = new ObjectRegistry();
    const getter = vi.fn(() => 'secret');
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let index = 0; index < 8; index++) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    root.self = root;
    Object.defineProperty(root, 'danger', { enumerable: true, get: getter });

    const remote = toRemoteObject(root, registry);
    const text = remoteObjectToDeepText(remote, kernelFor(registry));

    expect(text).toContain('循环引用');
    expect(text).toContain('层级过深');
    expect(text).toContain('"danger": 「取值器，未求值」');
    expect(getter).not.toHaveBeenCalled();
    expect(registry.size).toBe(1);
  });

  it('reports released handles instead of pretending the value is empty', () => {
    const registry = new ObjectRegistry();
    const remote = toRemoteObject({ value: 1 }, registry);
    registry.release(remote.objectId!);

    expect(remoteObjectToDeepText(remote, kernelFor(registry))).toContain('已不再持有');
  });

  it('bounds wide objects and releases every materialised child handle', () => {
    const registry = new ObjectRegistry();
    const wide = Object.fromEntries(
      Array.from({ length: 900 }, (_, index) => [`key${index}`, { index }]),
    );
    const remote = toRemoteObject(wide, registry);

    const text = remoteObjectToDeepText(remote, kernelFor(registry));

    expect(text).toContain('\n  …\n}');
    expect(text).not.toContain('"key899"');
    expect(registry.size).toBe(1);
  });

  it('releases ancestor borrows when a deeper expansion throws', () => {
    const registry = new ObjectRegistry();
    const child = toRemoteObject({ value: 1 }, registry);
    const root: RemoteObject = {
      type: 'object',
      description: 'Root',
      objectId: 'root',
    };
    const property: PropertyDescriptor = {
      name: 'child',
      value: child,
      isOwn: true,
      keyKind: 'string',
    };
    const release = vi.spyOn(registry, 'release');
    const kernel = {
      log: {
        registry,
        getProperties: (objectId: string) => {
          if (objectId === 'root') return [property];
          throw new Error('host bridge failed');
        },
      },
    } as unknown as OptikKernel;

    expect(remoteObjectToDeepText(root, kernel)).toBe('「Root（展开失败）」');
    expect(release).toHaveBeenCalledWith(child.objectId!);
    expect(registry.size).toBe(0);
  });
});
