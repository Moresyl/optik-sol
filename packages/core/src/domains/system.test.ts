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
  ])('describes common mobile clients', (userAgent, expected) => {
    const spy = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
    try {
      expect(new SystemDomain().info().client).toBe(expected);
    } finally {
      spy.mockRestore();
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
});
