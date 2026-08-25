import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageDomain } from './storage';

describe('StorageDomain', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.cookie.split(';').forEach((cookie) => {
      const key = cookie.split('=')[0]?.trim();
      if (key) document.cookie = `${key}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    });
  });

  it('lists, sorts, edits, removes, and clears web storage', () => {
    const domain = new StorageDomain();
    domain.set('localStorage', '中文', '值');
    domain.set('localStorage', 'alpha', '1');

    expect(domain.list('localStorage')).toEqual(
      [
        { key: 'alpha', value: '1', size: 6 },
        { key: '中文', value: '值', size: 9 },
      ].sort((a, b) => a.key.localeCompare(b.key)),
    );
    expect(domain.status('localStorage')).toMatchObject({
      available: true,
      itemCount: 2,
      totalBytes: 15,
    });

    domain.remove('localStorage', 'alpha');
    expect(localStorage.getItem('alpha')).toBeNull();
    domain.clear('localStorage');
    expect(localStorage.length).toBe(0);
  });

  it('round-trips encoded cookie names and values through the UI-facing key', () => {
    const domain = new StorageDomain();
    domain.set('cookie', 'user name', '张 三');

    const item = domain.list('cookie').find((candidate) => candidate.key === 'user name');
    expect(item).toEqual({
      key: 'user name',
      value: '张 三',
      size: expect.any(Number),
    });
    domain.remove('cookie', item!.key);
    expect(document.cookie).not.toContain('user%20name=');
  });

  it('keeps malformed and bare cookies inspectable instead of throwing', () => {
    document.cookie = 'bare=';
    document.cookie = 'bad%ZZ=value%ZZ';
    const items = new StorageDomain().list('cookie');
    expect(items).toContainEqual({ key: 'bad%ZZ', value: 'value%ZZ', size: 14 });
  });

  it('clears every visible cookie through the same decoded key path', () => {
    const domain = new StorageDomain();
    domain.set('cookie', 'first key', '1');
    domain.set('cookie', 'second', '2');
    domain.clear('cookie');
    expect(domain.list('cookie').map((item) => item.key)).not.toEqual(
      expect.arrayContaining(['first key', 'second']),
    );
  });

  it('reports inaccessible storage instead of throwing from status', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });

    try {
      expect(new StorageDomain().status('localStorage')).toMatchObject({
        available: false,
        reason: 'blocked',
        itemCount: 0,
      });
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    }
  });

  it('keeps IndexedDB data read-only and enumerates databases defensively', async () => {
    const domain = new StorageDomain();
    expect(domain.list('indexedDB')).toEqual([]);
    expect(() => domain.set('indexedDB', 'db', 'value')).toThrow(/read-only/i);
    expect(() => domain.remove('indexedDB', 'db')).toThrow(/read-only/i);
    expect(() => domain.clear('indexedDB')).toThrow(/read-only/i);

    const original = globalThis.indexedDB;
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: { databases: vi.fn().mockResolvedValue([{ name: 'main', version: 2 }, {}]) },
    });
    try {
      await expect(domain.listDatabases()).resolves.toEqual([{ name: 'main', version: 2 }]);
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: original });
    }
  });

  it('returns empty results when database enumeration and quota estimation fail', async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const originalStorage = navigator.storage;
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: { databases: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate: vi.fn().mockRejectedValue(new Error('denied')) },
    });

    try {
      const domain = new StorageDomain();
      await expect(domain.listDatabases()).resolves.toEqual([]);
      await expect(domain.estimate()).resolves.toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        value: originalIndexedDb,
      });
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  it('handles missing database enumeration and successful quota estimation', async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const originalStorage = navigator.storage;
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: {},
    });
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate: vi.fn().mockResolvedValue({ usage: 10, quota: 100 }) },
    });
    try {
      const domain = new StorageDomain();
      await expect(domain.listDatabases()).resolves.toEqual([]);
      await expect(domain.estimate()).resolves.toEqual({ usage: 10, quota: 100 });
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        value: originalIndexedDb,
      });
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: originalStorage,
      });
    }
  });
});
