/** PerformanceObserver bridge for Long Tasks API entries. */

import type { LongTaskAttribution, LongTaskRecord } from '../types';
import type { Instrumentation } from './xhr';

export interface LongTaskSink {
  nextId(): string;
  onLongTask(record: LongTaskRecord): void;
}

interface BrowserLongTaskEntry extends PerformanceEntry {
  attribution?: ArrayLike<{
    containerType?: unknown;
    containerSrc?: unknown;
    containerId?: unknown;
    containerName?: unknown;
  }>;
}

const MAX_NAME_LENGTH = 64;
const MAX_ATTRIBUTION_LENGTH = 2048;

/**
 * Captures earlier and future long tasks when the browser implements the API.
 * Unsupported or partially implemented WebViews degrade to a no-op.
 */
export function instrumentLongTasks(sink: LongTaskSink): Instrumentation {
  if (typeof PerformanceObserver !== 'function') return { dispose() {} };

  let active = true;
  let observer: PerformanceObserver;
  try {
    observer = new PerformanceObserver((list) => {
      if (!active) return;
      let entries: PerformanceEntryList;
      try {
        entries = list.getEntries();
      } catch {
        return;
      }

      for (const raw of entries) {
        if (!active) break;
        // Browser entries are normally trustworthy, but embedded WebViews have
        // shipped incomplete implementations whose accessors throw.
        try {
          if (raw.entryType !== 'longtask') continue;
          const startTime = finiteNonNegative(raw.startTime);
          const duration = finiteNonNegative(raw.duration);
          if (startTime === undefined || duration === undefined || duration < 50) continue;

          const entry = raw as BrowserLongTaskEntry;
          sink.onLongTask({
            id: sink.nextId(),
            startTime,
            duration,
            name:
              typeof entry.name === 'string' && entry.name
                ? entry.name.slice(0, MAX_NAME_LENGTH)
                : 'unknown',
            attribution: readAttribution(entry.attribution),
          });
        } catch {
          // Instrumentation must never break the page because an entry or consumer failed.
        }
      }
    });
  } catch {
    return { dispose() {} };
  }

  try {
    observer.observe({ type: 'longtask', buffered: true });
  } catch {
    try {
      // Older Chromium WebViews support long tasks but only accept entryTypes.
      observer.observe({ entryTypes: ['longtask'] });
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
        // Best effort.
      }
    },
  };
}

function readAttribution(
  values: BrowserLongTaskEntry['attribution'],
): LongTaskAttribution[] {
  if (!values) return [];

  try {
    return Array.from(values, (value) => ({
      containerType: stringValue(value?.containerType, 64),
      containerSrc: stringValue(value?.containerSrc, MAX_ATTRIBUTION_LENGTH),
      containerId: stringValue(value?.containerId, MAX_ATTRIBUTION_LENGTH),
      containerName: stringValue(value?.containerName, MAX_ATTRIBUTION_LENGTH),
    }));
  } catch {
    return [];
  }
}

function stringValue(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function finiteNonNegative(value: number): number | undefined {
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}
