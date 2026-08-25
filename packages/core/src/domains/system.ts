/**
 * System domain: the environment report you actually want when a bug only reproduces
 * on someone else's phone.
 *
 * Safe-area insets are resolved at runtime rather than assumed, because they are the
 * difference between a console that sits above the iPhone home indicator and one that
 * has its bottom row permanently unreachable.
 */

import type { SystemInfo } from '../types';

export class SystemDomain {
  info(): SystemInfo {
    const nav = globalThis.navigator;
    const ua = nav?.userAgent ?? '';

    return {
      userAgent: ua,
      platform: (nav as Navigator & { platform?: string })?.platform ?? '',
      language: nav?.language ?? '',
      client: describeClient(ua),
      viewport: {
        width: globalThis.innerWidth ?? 0,
        height: globalThis.innerHeight ?? 0,
        dpr: globalThis.devicePixelRatio ?? 1,
      },
      screen: { width: globalThis.screen?.width ?? 0, height: globalThis.screen?.height ?? 0 },
      safeArea: readSafeArea(),
      network: readConnection(),
      memory: readMemory(),
      timing: readNavigationTiming(),
      capabilities: readCapabilities(),
    };
  }
}

/**
 * Reads `env(safe-area-inset-*)` by measuring a probe element.
 *
 * There is no JS API for these values. The probe must be attached to the document and
 * laid out, so we do it once, synchronously, and remove it immediately.
 */
export function readSafeArea(): SystemInfo['safeArea'] {
  const zero = { top: 0, right: 0, bottom: 0, left: 0 };
  const doc = globalThis.document;
  if (!doc?.body) return zero;

  const probe = doc.createElement('div');
  probe.style.cssText = [
    'position:fixed',
    'visibility:hidden',
    'pointer-events:none',
    'top:0',
    'left:0',
    'width:0',
    'height:0',
    'padding-top:env(safe-area-inset-top,0px)',
    'padding-right:env(safe-area-inset-right,0px)',
    'padding-bottom:env(safe-area-inset-bottom,0px)',
    'padding-left:env(safe-area-inset-left,0px)',
  ].join(';');

  try {
    doc.body.appendChild(probe);
    const computed = getComputedStyle(probe);
    return {
      top: parseFloat(computed.paddingTop) || 0,
      right: parseFloat(computed.paddingRight) || 0,
      bottom: parseFloat(computed.paddingBottom) || 0,
      left: parseFloat(computed.paddingLeft) || 0,
    };
  } catch {
    return zero;
  } finally {
    try {
      probe.remove();
    } catch {
      // Host pages can patch Element.prototype.remove. Fall back to the older API so
      // a best-effort diagnostic probe neither escapes an error nor stays in the DOM.
      try {
        probe.parentNode?.removeChild(probe);
      } catch {
        // The document may itself be tearing down; cleanup remains best-effort.
      }
    }
  }
}

function readConnection(): SystemInfo['network'] {
  try {
    const connection = (
      globalThis.navigator as Navigator & {
        connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean };
      }
    )?.connection;
    if (!connection) return undefined;
    return {
      effectiveType: connection.effectiveType,
      downlink: connection.downlink,
      rtt: connection.rtt,
      saveData: connection.saveData,
    };
  } catch {
    return undefined;
  }
}

function readMemory(): SystemInfo['memory'] {
  try {
    const memory = (
      globalThis.performance as (Performance & {
        memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
      }) | undefined
    )?.memory;
    if (!memory) return undefined;
    return {
      usedJSHeapSize: memory.usedJSHeapSize,
      totalJSHeapSize: memory.totalJSHeapSize,
      jsHeapSizeLimit: memory.jsHeapSizeLimit,
    };
  } catch {
    return undefined;
  }
}

function readNavigationTiming(): Record<string, number> {
  const out: Record<string, number> = {};
  try {
    const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    if (entry) {
      out['dns'] = round(entry.domainLookupEnd - entry.domainLookupStart);
      out['tcp'] = round(entry.connectEnd - entry.connectStart);
      out['ttfb'] = round(entry.responseStart - entry.requestStart);
      out['response'] = round(entry.responseEnd - entry.responseStart);
      out['domInteractive'] = round(entry.domInteractive);
      out['domContentLoaded'] = round(entry.domContentLoadedEventEnd);
      out['load'] = round(entry.loadEventEnd);
    }

    // Paint timings are the numbers users actually feel.
    for (const paint of performance.getEntriesByType('paint')) {
      out[paint.name] = round(paint.startTime);
    }
  } catch {
    // Not all webviews implement the Navigation Timing Level 2 entries.
  }
  return out;
}

function round(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : 0;
}

/**
 * Feature detection the UI uses to *explain itself* rather than silently degrade —
 * e.g. telling the user copy fell back to a legacy path because the page is not
 * served over HTTPS, instead of a copy button that mysteriously does nothing.
 */
function readCapabilities(): Record<string, boolean> {
  const has = (fn: () => unknown): boolean => {
    try {
      return Boolean(fn());
    } catch {
      return false;
    }
  };

  return {
    secureContext: has(() => globalThis.isSecureContext),
    asyncClipboard: has(() => navigator.clipboard?.writeText),
    execCommandCopy: has(() => typeof document.execCommand === 'function'),
    shadowDom: has(() => typeof Element.prototype.attachShadow === 'function'),
    resizeObserver: has(() => typeof ResizeObserver === 'function'),
    performanceObserver: has(() => typeof PerformanceObserver === 'function'),
    resourceTiming: has(() => PerformanceObserver.supportedEntryTypes?.includes('resource')),
    longTaskTiming: has(() => PerformanceObserver.supportedEntryTypes?.includes('longtask')),
    visualViewport: has(() => globalThis.visualViewport),
    pointerEvents: has(() => typeof PointerEvent === 'function'),
    webSocket: has(() => typeof WebSocket === 'function'),
    serviceWorker: has(() => navigator.serviceWorker),
    indexedDB: has(() => globalThis.indexedDB),
    localStorage: has(() => globalThis.localStorage),
    dvhUnits: has(() => CSS.supports('height', '100dvh')),
    cssEnvSafeArea: has(() => CSS.supports('padding-top', 'env(safe-area-inset-top)')),
  };
}

/** Human-readable client string: `iOS 17.4 · Safari 17.4 · WKWebView`. */
function describeClient(ua: string): string {
  if (!ua) return 'Unknown';
  const parts: string[] = [];

  const ios = /(?:iPhone|iPad|iPod).*?OS (\d+)[._](\d+)/.exec(ua);
  const android = /Android (\d+(?:\.\d+)?)/.exec(ua);
  const mac = /Mac OS X (\d+)[._](\d+)/.exec(ua);
  const windows = /Windows NT (\d+\.\d+)/.exec(ua);
  const harmony = /HarmonyOS|OpenHarmony/.exec(ua);

  if (ios) parts.push(`iOS ${ios[1]}.${ios[2]}`);
  else if (android) parts.push(`Android ${android[1]}`);
  else if (harmony) parts.push('HarmonyOS');
  else if (mac) parts.push(`macOS ${mac[1]}.${mac[2]}`);
  else if (windows) parts.push(`Windows NT ${windows[1]}`);

  // Order matters: every one of these also claims to be Safari or Chrome.
  const browser =
    /MicroMessenger\/([\d.]+)/.exec(ua) ??
    /AlipayClient\/([\d.]+)/.exec(ua) ??
    /(?:UCBrowser)\/([\d.]+)/.exec(ua) ??
    /(?:QQBrowser)\/([\d.]+)/.exec(ua) ??
    /(?:EdgA?)\/([\d.]+)/.exec(ua) ??
    /(?:CriOS)\/([\d.]+)/.exec(ua) ??
    /(?:FxiOS)\/([\d.]+)/.exec(ua) ??
    /(?:Firefox)\/([\d.]+)/.exec(ua) ??
    /(?:Chrome)\/([\d.]+)/.exec(ua) ??
    /Version\/([\d.]+).*Safari/.exec(ua);

  if (browser) {
    const name = /MicroMessenger/.test(ua)
      ? 'WeChat'
      : /AlipayClient/.test(ua)
        ? 'Alipay'
        : /UCBrowser/.test(ua)
          ? 'UC'
          : /QQBrowser/.test(ua)
            ? 'QQ'
            : /EdgA?\//.test(ua)
              ? 'Edge'
              : /CriOS/.test(ua)
                ? 'Chrome iOS'
                : /FxiOS/.test(ua)
                  ? 'Firefox iOS'
                  : /Firefox/.test(ua)
                    ? 'Firefox'
                    : /Chrome/.test(ua)
                      ? 'Chrome'
                      : 'Safari';
    parts.push(`${name} ${browser[1]}`);
  }

  // A WKWebView omits the `Safari/` token that mobile Safari always sends.
  if (/(iPhone|iPad|iPod)/.test(ua) && !/Safari\//.test(ua)) parts.push('WKWebView');
  else if (/; wv\)/.test(ua)) parts.push('Android WebView');

  return parts.length > 0 ? parts.join(' · ') : ua.slice(0, 80);
}
