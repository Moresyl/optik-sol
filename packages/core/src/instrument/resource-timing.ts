/**
 * Resource Timing bridge.
 *
 * Two jobs no wrapper-based approach can do on its own:
 *  1. **Real network phases.** A `fetch` wrapper can only measure wall time. Resource
 *     Timing gives DNS / TCP / TLS / TTFB / download splits — the numbers that tell you
 *     whether a slow request is the server's fault or the network's. On a phone, that
 *     distinction is usually the whole investigation.
 *  2. **Requests with no JS API.** `<img>`, `<link>`, `<script>`, CSS `url()`, fonts and
 *     media never pass through fetch or XHR, so they are invisible to every wrapper-only
 *     console. They show up here.
 */

import type { NetworkRecord } from '../types';
import type { Instrumentation, NetworkSink } from './xhr';
import { splitUrl } from './body';

export interface ResourceTimingOptions {
  nextId(): string;
  /** Correlate a timing entry with an already-recorded request. */
  findByUrl(url: string, startTime: number): string | undefined;
  /** Record resources that no wrapper saw (img/css/script/font). Default true. */
  captureUnhookedResources?: boolean;
}

/** Initiator types that a wrapper already covers; adding them again would duplicate rows. */
const WRAPPED_INITIATORS = new Set(['xmlhttprequest', 'fetch', 'beacon']);

export function instrumentResourceTiming(
  sink: NetworkSink,
  options: ResourceTimingOptions,
): Instrumentation {
  if (typeof PerformanceObserver !== 'function') return { dispose() {} };

  const { captureUnhookedResources = true } = options;
  let active = true;

  const handle = (entries: PerformanceEntryList) => {
    for (const entry of entries) {
      if (!active) break;
      try {
        if (entry.entryType !== 'resource') continue;
        const timing = entry as PerformanceResourceTiming;

        const existingId = options.findByUrl(timing.name, timing.startTime);
        if (existingId) {
          sink.onUpdate(existingId, {
            timing: breakdown(timing),
            fromCache: isFromCache(timing),
          });
          continue;
        }

        if (!captureUnhookedResources) continue;
        if (WRAPPED_INITIATORS.has(timing.initiatorType)) continue;

        const { url, name, origin, query } = splitUrl(timing.name);
        sink.onStart({
          id: options.nextId(),
          initiator: 'resource',
          method: 'GET',
          url,
          name,
          origin,
          query,
          requestHeaders: [],
          responseHeaders: [],
          // Resource Timing exposes no status; a completed entry with a nonzero
          // duration means the browser got *something*. We do not invent a 200.
          phase: 'complete',
          responseType: timing.initiatorType,
          responseBody: {
            size: timing.decodedBodySize || undefined,
            omitted: true,
            omittedReason: 'unavailable',
          },
          fromCache: isFromCache(timing),
          timing: breakdown(timing),
        } satisfies NetworkRecord);
      } catch {
        // Broken WebView entries and consumer errors must not affect the page.
      }
    }
  };

  let observer: PerformanceObserver;
  try {
    observer = new PerformanceObserver((list) => {
      if (!active) return;
      try {
        handle(list.getEntries());
      } catch {
        // Ignore a broken observer entry list.
      }
    });
  } catch {
    return { dispose() {} };
  }

  try {
    // `buffered: true` replays entries that fired before Optik loaded — important
    // because the console is usually initialised after the page's first requests.
    observer.observe({ type: 'resource', buffered: true });
  } catch {
    try {
      observer.observe({ entryTypes: ['resource'] });
    } catch {
      active = false;
      try {
        observer.disconnect();
      } catch {
        // Ignore a partially constructed observer.
      }
      return { dispose() {} };
    }
  }

  return {
    dispose() {
      if (!active) return;
      active = false;
      try {
        observer.disconnect();
      } catch {
        // Ignore.
      }
    },
  };
}

function breakdown(timing: PerformanceResourceTiming): NetworkRecord['timing'] {
  // Cross-origin responses without `Timing-Allow-Origin` report 0 for the detailed
  // marks. Emitting 0ms DNS/TCP would be a lie, so those fields stay undefined.
  const detailed = timing.domainLookupEnd > 0 || timing.connectEnd > 0 || timing.responseStart > 0;

  const base: NetworkRecord['timing'] = {
    startTime: timing.startTime,
    endTime: timing.responseEnd,
    duration: timing.duration,
  };

  if (!detailed) return base;

  return {
    ...base,
    responseStart: timing.responseStart,
    dns: nonNegative(timing.domainLookupEnd - timing.domainLookupStart),
    tcp: nonNegative(timing.connectEnd - timing.connectStart),
    tls:
      timing.secureConnectionStart > 0
        ? nonNegative(timing.connectEnd - timing.secureConnectionStart)
        : undefined,
    ttfb: nonNegative(timing.responseStart - timing.requestStart),
    download: nonNegative(timing.responseEnd - timing.responseStart),
  };
}

function nonNegative(value: number): number | undefined {
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * `transferSize === 0` with a decoded body means the bytes came from cache.
 * A 304 shows a small nonzero transferSize (headers only), which is not a cache hit
 * in the "no network" sense, so we require transferSize to be exactly 0.
 */
function isFromCache(timing: PerformanceResourceTiming): boolean {
  return timing.transferSize === 0 && timing.decodedBodySize > 0;
}
