/**
 * Storage domain: localStorage, sessionStorage, cookies, IndexedDB.
 *
 * Every read is defensive. In a WKWebView with cookies disabled, in a cross-origin
 * iframe, or in Safari private mode, touching `localStorage` throws a SecurityError —
 * and a console that dies when you open its Storage tab is worse than no console.
 */

import type { StorageArea, StorageItem } from '../types';
import { byteLengthOf } from '../instrument/body';

export interface StorageAreaStatus {
  area: StorageArea;
  available: boolean;
  /** Why it is unavailable, shown verbatim in the UI instead of an empty list. */
  reason?: string;
  itemCount: number;
  totalBytes: number;
}

export interface StorageSnapshot {
  status: StorageAreaStatus;
  items: StorageItem[];
}

export class StorageDomain {
  list(area: StorageArea): StorageItem[] {
    switch (area) {
      case 'localStorage':
        return this.#listWebStorage('localStorage');
      case 'sessionStorage':
        return this.#listWebStorage('sessionStorage');
      case 'cookie':
        return this.#listCookies();
      case 'indexedDB':
        if (!globalThis.indexedDB) throw new Error('IndexedDB is not available in this context');
        return [];
    }
  }

  status(area: StorageArea): StorageAreaStatus {
    return this.snapshot(area).status;
  }

  /** Reads items and status atomically so a blocked storage getter is touched only once. */
  snapshot(area: StorageArea): StorageSnapshot {
    try {
      const items = this.list(area);
      return {
        items,
        status: {
          area,
          available: true,
          itemCount: items.length,
          totalBytes: items.reduce((sum, item) => sum + item.size, 0),
        },
      };
    } catch (err) {
      return {
        items: [],
        status: {
          area,
          available: false,
          reason: err instanceof Error ? err.message : String(err),
          itemCount: 0,
          totalBytes: 0,
        },
      };
    }
  }

  set(area: StorageArea, key: string, value: string): void {
    if (area === 'cookie') {
      this.#setCookie(key, value);
      return;
    }
    if (area === 'indexedDB') throw new Error('IndexedDB values are read-only in Optik');
    const storage = this.#webStorage(area);
    storage.setItem(key, value);
  }

  remove(area: StorageArea, key: string): void {
    if (area === 'cookie') {
      this.#removeCookie(key);
      return;
    }
    if (area === 'indexedDB') throw new Error('IndexedDB values are read-only in Optik');
    this.#webStorage(area).removeItem(key);
  }

  clear(area: StorageArea): void {
    if (area === 'cookie') {
      for (const item of this.#listCookies()) this.#removeCookie(item.key);
      return;
    }
    if (area === 'indexedDB') throw new Error('IndexedDB values are read-only in Optik');
    this.#webStorage(area).clear();
  }

  /** Enumerates IndexedDB databases where the browser supports it (not Firefox <126). */
  async listDatabases(): Promise<{ name: string; version?: number }[]> {
    const idb = globalThis.indexedDB as
      | (IDBFactory & { databases?: () => Promise<{ name?: string; version?: number }[]> })
      | undefined;
    if (!idb?.databases) return [];
    try {
      const dbs = await idb.databases();
      return dbs
        .filter((db): db is { name: string; version?: number } => typeof db.name === 'string')
        .map((db) => ({ name: db.name, version: db.version }));
    } catch {
      return [];
    }
  }

  canListDatabases(): boolean {
    const idb = globalThis.indexedDB as (IDBFactory & { databases?: unknown }) | undefined;
    return typeof idb?.databases === 'function';
  }

  /** UI-ready database rows. Unlike listDatabases(), reports unsupported/error states. */
  async listDatabaseItems(): Promise<StorageItem[]> {
    const idb = globalThis.indexedDB as
      | (IDBFactory & { databases?: () => Promise<{ name?: string; version?: number }[]> })
      | undefined;
    if (!idb) throw new Error('IndexedDB is not available in this context');
    if (!idb.databases) throw new Error('This browser cannot enumerate IndexedDB databases');

    const databases = await idb.databases();
    return databases
      .filter((database): database is { name: string; version?: number } =>
        typeof database.name === 'string',
      )
      .map((database) => {
        const value = database.version === undefined ? '版本未知' : `版本 ${database.version}`;
        return {
          key: database.name,
          value,
          size: byteLengthOf(database.name) + byteLengthOf(value),
        };
      })
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  /** Storage quota, so "why is my PWA failing to cache" has an answer. */
  async estimate(): Promise<{ usage?: number; quota?: number } | undefined> {
    try {
      return await navigator.storage?.estimate?.();
    } catch {
      return undefined;
    }
  }

  // -------------------------------------------------------------------------

  #webStorage(area: 'localStorage' | 'sessionStorage'): Storage {
    const storage = globalThis[area];
    if (!storage) throw new Error(`${area} is not available in this context`);
    return storage;
  }

  #listWebStorage(area: 'localStorage' | 'sessionStorage'): StorageItem[] {
    const storage = this.#webStorage(area);
    const items: StorageItem[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key === null) continue;
      const value = storage.getItem(key) ?? '';
      items.push({ key, value, size: byteLengthOf(key) + byteLengthOf(value) });
    }
    return items.sort((a, b) => a.key.localeCompare(b.key));
  }

  #listCookies(): StorageItem[] {
    const raw = globalThis.document?.cookie ?? '';
    if (!raw.trim()) return [];

    return raw
      .split(';')
      .map((pair) => {
        const eq = pair.indexOf('=');
        // A cookie may legitimately have no '=' (a bare name).
        const rawKey = (eq === -1 ? pair : pair.slice(0, eq)).trim();
        const rawValue = eq === -1 ? '' : pair.slice(eq + 1).trim();
        let key = rawKey;
        let value = rawValue;
        try {
          key = decodeURIComponent(rawKey);
        } catch {
          // Malformed percent-encoding; keep the raw key so it remains removable.
        }
        try {
          value = decodeURIComponent(rawValue);
        } catch {
          // Malformed percent-encoding; show the raw bytes rather than throwing.
        }
        return { key, value, size: byteLengthOf(rawKey) + byteLengthOf(rawValue) };
      })
      .filter((item) => item.key.length > 0)
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  #setCookie(key: string, value: string): void {
    if (!globalThis.document) throw new Error('document is not available');
    globalThis.document.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)};path=/`;
  }

  /**
   * Cookie deletion is genuinely hard: a cookie set on `.example.com` cannot be removed
   * by expiring it on `www.example.com`. We walk the domain suffixes and every path
   * prefix, which is what actually works in practice.
   */
  #removeCookie(key: string): void {
    const doc = globalThis.document;
    if (!doc) throw new Error('document is not available');

    const encodedKeys = new Set([encodeURIComponent(key), key]);
    const expiry = 'expires=Thu, 01 Jan 1970 00:00:00 GMT';
    const hostname = globalThis.location?.hostname ?? '';
    const pathname = globalThis.location?.pathname ?? '/';

    const domains = new Set<string>(['']);
    const labels = hostname.split('.');
    for (let i = 0; i < labels.length - 1; i++) {
      domains.add(labels.slice(i).join('.'));
      domains.add('.' + labels.slice(i).join('.'));
    }

    const paths = new Set<string>(['/']);
    const segments = pathname.split('/').filter(Boolean);
    let accumulated = '';
    for (const segment of segments) {
      accumulated += '/' + segment;
      paths.add(accumulated);
    }

    for (const encoded of encodedKeys) {
      for (const domain of domains) {
        for (const path of paths) {
          doc.cookie = `${encoded}=;${expiry};path=${path}${domain ? `;domain=${domain}` : ''}`;
        }
      }
    }
  }
}
