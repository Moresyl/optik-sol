import { describe, expect, it, vi } from 'vitest';
import { readSafeArea, SystemDomain } from './system';

describe('SystemDomain', () => {
  it('returns a bounded environment report with capability flags', () => {
    const info = new SystemDomain().info();
    expect(info.userAgent).toBeTypeOf('string');
    expect(info.viewport).toMatchObject({
      width: expect.any(Number),
      height: expect.any(Number),
      dpr: expect.any(Number),
    });
    expect(info.capabilities).toMatchObject({
      shadowDom: expect.any(Boolean),
      localStorage: expect.any(Boolean),
      indexedDB: expect.any(Boolean),
    });
  });

  it.each([
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1',
      'iOS 17.4 · Safari 17.4',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A; wv) AppleWebKit/537.36 Version/4.0 Chrome/123.0 Mobile Safari/537.36',
      'Android 14 · Chrome 123.0 · Android WebView',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 MicroMessenger/8.0.40',
      'iOS 16.0 · WeChat 8.0.40 · WKWebView',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) Version/17.4 Safari/605.1.15',
      'macOS 14.4 · Safari 17.4',
    ],
    ['Mozilla/5.0 (Windows NT 10.0) Edg/123.0', 'Windows NT 10.0 · Edge 123.0'],
    ['Mozilla/5.0 (HarmonyOS) Chrome/120.0', 'HarmonyOS · Chrome 120.0'],
    ['Mozilla/5.0 (Linux; Android 13) UCBrowser/15.0', 'Android 13 · UC 15.0'],
    ['Mozilla/5.0 (Linux; Android 12) QQBrowser/13.5', 'Android 12 · QQ 13.5'],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AlipayClient/10.5',
      'iOS 17.0 · Alipay 10.5 · WKWebView',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) CriOS/123.0 Mobile Safari/604.1',
      'iOS 17.0 · Chrome iOS 123.0',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) FxiOS/124.0 Mobile Safari/604.1',
      'iOS 17.0 · Firefox iOS 124.0',
    ],
    ['Mozilla/5.0 Firefox/125.0', 'Firefox 125.0'],
  ])('describes common mobile clients', (userAgent, expected) => {
    const spy = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
    try {
      expect(new SystemDomain().info().client).toBe(expected);
    } finally {
      spy.mockRestore();
    }
  });

  it('reports unknown and bounded fallback user agents', () => {
    const spy = vi.spyOn(navigator, 'userAgent', 'get');
    spy.mockReturnValueOnce('').mockReturnValueOnce('CustomClient/'.padEnd(120, 'x'));
    expect(new SystemDomain().info().client).toBe('Unknown');
    expect(new SystemDomain().info().client).toHaveLength(80);
    spy.mockRestore();
  });

  it('collects navigation, paint, connection, and heap metrics when supported', () => {
    const getEntries = vi.spyOn(performance, 'getEntriesByType').mockImplementation((type) => {
      if (type === 'navigation') {
        return [
          {
            domainLookupStart: 1,
            domainLookupEnd: 3,
            connectStart: 3,
            connectEnd: 7,
            requestStart: 8,
            responseStart: 18,
            responseEnd: 25,
            domInteractive: 30,
            domContentLoadedEventEnd: 40,
            loadEventEnd: 50,
          } as PerformanceNavigationTiming,
        ];
      }
      if (type === 'paint') return [{ name: 'first-contentful-paint', startTime: 12.345 } as PerformanceEntry];
      return [];
    });
    const connection = Object.getOwnPropertyDescriptor(navigator, 'connection');
    const memory = Object.getOwnPropertyDescriptor(performance, 'memory');
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { effectiveType: '4g', downlink: 8, rtt: 50, saveData: false },
    });
    Object.defineProperty(performance, 'memory', {
      configurable: true,
      value: { usedJSHeapSize: 1, totalJSHeapSize: 2, jsHeapSizeLimit: 3 },
    });
    try {
      const info = new SystemDomain().info();
      expect(info.network).toEqual({ effectiveType: '4g', downlink: 8, rtt: 50, saveData: false });
      expect(info.memory).toEqual({ usedJSHeapSize: 1, totalJSHeapSize: 2, jsHeapSizeLimit: 3 });
      expect(info.timing).toMatchObject({
        dns: 2,
        tcp: 4,
        ttfb: 10,
        response: 7,
        'first-contentful-paint': 12.35,
      });
    } finally {
      getEntries.mockRestore();
      if (connection) Object.defineProperty(navigator, 'connection', connection);
      else Reflect.deleteProperty(navigator, 'connection');
      if (memory) Object.defineProperty(performance, 'memory', memory);
      else Reflect.deleteProperty(performance, 'memory');
    }
  });

  it('reads safe-area values and removes its probe', () => {
    const original = globalThis.getComputedStyle;
    globalThis.getComputedStyle = vi.fn().mockReturnValue({
      paddingTop: '10px',
      paddingRight: '2px',
      paddingBottom: '20px',
      paddingLeft: '3px',
    });
    const before = document.body.childElementCount;
    try {
      expect(readSafeArea()).toEqual({ top: 10, right: 2, bottom: 20, left: 3 });
      expect(document.body.childElementCount).toBe(before);
    } finally {
      globalThis.getComputedStyle = original;
    }
  });

  it('returns zero safe-area values when style measurement throws', () => {
    const original = globalThis.getComputedStyle;
    globalThis.getComputedStyle = vi.fn(() => {
      throw new Error('layout unavailable');
    });
    try {
      expect(readSafeArea()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    } finally {
      globalThis.getComputedStyle = original;
    }
  });

  it('contains hostile probe removal and falls back to removeChild', () => {
    const remove = vi.spyOn(Element.prototype, 'remove').mockImplementation(() => {
      throw new Error('host patched remove');
    });
    const before = document.body.childElementCount;
    try {
      expect(() => readSafeArea()).not.toThrow();
      expect(document.body.childElementCount).toBe(before);
    } finally {
      remove.mockRestore();
    }
  });
});
