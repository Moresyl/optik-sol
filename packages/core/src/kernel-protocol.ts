/** Exposes the kernel's bounded, JSON-safe domains through the Optik protocol. */

import type { GetPropertiesOptions, ObjectRegistry, PropertyDescriptor } from './remote-object';
import { ErrorCode, type Transport } from './protocol';
import { ProtocolRequestError, ProtocolRouter, sendEvent } from './transport';
import type { OptikKernel } from './kernel';
import type { LogEntry, LongTaskRecord, NetworkRecord } from './types';
import { MAX_RING_BUFFER_CAPACITY } from './ring-buffer';

export interface KernelProtocolServer {
  dispose(): void;
}

export interface ProtocolPageParams {
  offset?: number;
  limit?: number;
}

export interface LogEntriesResult {
  total: number;
  entries: LogEntry[];
}

export interface NetworkRecordsResult {
  total: number;
  records: NetworkRecord[];
}

export interface LongTasksResult {
  total: number;
  longTasks: LongTaskRecord[];
}

export const KernelProtocolMethods = {
  LogEntries: 'Log.entries',
  LogClear: 'Log.clear',
  LogGetProperties: 'Log.getProperties',
  LogReleaseObject: 'Log.releaseObject',
  LogSetMaxEntries: 'Log.setMaxEntries',
  NetworkRecords: 'Network.records',
  NetworkClear: 'Network.clear',
  NetworkGetProperties: 'Network.getProperties',
  NetworkReleaseObject: 'Network.releaseObject',
  NetworkSetMaxRecords: 'Network.setMaxRecords',
  PerformanceLongTasks: 'Performance.longTasks',
  PerformanceClear: 'Performance.clear',
  PerformanceSetMaxLongTasks: 'Performance.setMaxLongTasks',
  SystemInfo: 'System.info',
} as const;

/**
 * Attaches the stable read/clear surface and live domain events to any transport.
 * This surface can contain sensitive logs and network payloads, so callers must only
 * attach it to a trusted or authenticated transport. Storage mutation and arbitrary
 * expression evaluation are intentionally excluded even from that baseline surface.
 */
export function attachKernelProtocol(
  kernel: OptikKernel,
  transport: Transport,
): KernelProtocolServer {
  const router = new ProtocolRouter(transport);
  const borrowedLogObjects = new Map<string, number>();
  const borrowedNetworkObjects = new Map<string, number>();
  const registrations = [
    router.register(KernelProtocolMethods.LogEntries, (params) => {
      const entries = kernel.log.entries();
      return page(entries, params, 500, 'entries');
    }),
    router.register(KernelProtocolMethods.LogClear, () => {
      kernel.log.clear();
      return {};
    }),
    router.register(KernelProtocolMethods.LogGetProperties, (params) => {
      const { objectId, options } = propertyParams(params);
      const properties = kernel.log.getProperties(objectId, options);
      if (properties === null) throw releasedError(objectId);
      trackBorrowed(properties, borrowedLogObjects);
      return properties;
    }),
    router.register(KernelProtocolMethods.LogReleaseObject, (params) => ({
      released: releaseBorrowed(
        kernel.log.registry,
        borrowedLogObjects,
        objectIdParam(params),
      ),
    })),
    router.register(KernelProtocolMethods.LogSetMaxEntries, (params) => {
      const capacity = capacityParam(params);
      kernel.log.setMaxEntries(capacity);
      return { capacity };
    }),
    router.register(KernelProtocolMethods.NetworkRecords, (params) => {
      const records = kernel.network.records();
      return page(records, params, 200, 'records');
    }),
    router.register(KernelProtocolMethods.NetworkClear, () => {
      kernel.network.clear();
      return {};
    }),
    router.register(KernelProtocolMethods.NetworkGetProperties, (params) => {
      const { objectId, options } = propertyParams(params);
      const properties = kernel.network.getProperties(objectId, options);
      if (properties === null) throw releasedError(objectId);
      trackBorrowed(properties, borrowedNetworkObjects);
      return properties;
    }),
    router.register(KernelProtocolMethods.NetworkReleaseObject, (params) => ({
      released: releaseBorrowed(
        kernel.network.registry,
        borrowedNetworkObjects,
        objectIdParam(params),
      ),
    })),
    router.register(KernelProtocolMethods.NetworkSetMaxRecords, (params) => {
      const capacity = capacityParam(params);
      kernel.network.setMaxRecords(capacity);
      return { capacity };
    }),
    router.register(KernelProtocolMethods.PerformanceLongTasks, (params) => {
      const longTasks = kernel.performance.longTasks();
      return page(longTasks, params, 200, 'longTasks');
    }),
    router.register(KernelProtocolMethods.PerformanceClear, () => {
      kernel.performance.clear();
      return {};
    }),
    router.register(KernelProtocolMethods.PerformanceSetMaxLongTasks, (params) => {
      const capacity = capacityParam(params);
      kernel.performance.setMaxLongTasks(capacity);
      return { capacity };
    }),
    router.register(KernelProtocolMethods.SystemInfo, () => kernel.system.info()),
  ];

  const forward = (method: string, params: unknown) => {
    try {
      sendEvent(transport, method, params);
    } catch {
      // Kernel instrumentation must survive a disappearing remote peer.
    }
  };

  const offEvents = [
    kernel.events.on('logAdded', (entry) => forward('Log.entryAdded', entry)),
    kernel.events.on('logUpdated', (entry) => forward('Log.entryUpdated', entry)),
    kernel.events.on('logCleared', () => forward('Log.cleared', {})),
    kernel.events.on('logResized', (capacity) => forward('Log.resized', { capacity })),
    kernel.events.on('networkStarted', (record) => forward('Network.requestStarted', record)),
    kernel.events.on('networkUpdated', (record) => forward('Network.requestUpdated', record)),
    kernel.events.on('networkCleared', () => forward('Network.cleared', {})),
    kernel.events.on('networkResized', (capacity) =>
      forward('Network.resized', { capacity }),
    ),
    kernel.events.on('longTaskAdded', (record) =>
      forward('Performance.longTaskAdded', record),
    ),
    kernel.events.on('longTasksCleared', () => forward('Performance.cleared', {})),
    kernel.events.on('longTasksResized', (capacity) =>
      forward('Performance.resized', { capacity }),
    ),
  ];

  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const off of offEvents) off();
      for (const unregister of registrations) unregister();
      releaseAllBorrowed(kernel.log.registry, borrowedLogObjects);
      releaseAllBorrowed(kernel.network.registry, borrowedNetworkObjects);
      router.dispose();
    },
  };
}

function propertyParams(params: unknown): {
  objectId: string;
  options: GetPropertiesOptions | undefined;
} {
  const objectId = objectIdParam(params);
  if (!isRecord(params)) throw invalidParams('params must be an object');
  const rawOptions = params['options'];
  if (rawOptions === undefined) return { objectId, options: undefined };
  if (!isRecord(rawOptions)) throw invalidParams('options must be an object');

  const options: GetPropertiesOptions = {};
  for (const key of ['ownProperties', 'includeNonEnumerable', 'invokeGetters'] as const) {
    const value = rawOptions[key];
    if (value !== undefined && typeof value !== 'boolean') {
      throw invalidParams(`${key} must be a boolean`);
    }
    if (value !== undefined) options[key] = value;
  }
  return { objectId, options };
}

function objectIdParam(params: unknown): string {
  if (
    !isRecord(params) ||
    typeof params['objectId'] !== 'string' ||
    !params['objectId'] ||
    params['objectId'].length > 256
  ) {
    throw invalidParams('objectId must be a non-empty string');
  }
  return params['objectId'];
}

function capacityParam(params: unknown): number {
  if (!isRecord(params)) throw invalidParams('params must be an object');
  const capacity = params['capacity'];
  if (
    typeof capacity !== 'number' ||
    !Number.isFinite(capacity) ||
    capacity < 1 ||
    capacity > MAX_RING_BUFFER_CAPACITY
  ) {
    throw invalidParams(`capacity must be between 1 and ${MAX_RING_BUFFER_CAPACITY}`);
  }
  return Math.floor(capacity);
}

function page<T, K extends string>(
  values: T[],
  params: unknown,
  defaultLimit: number,
  key: K,
): { total: number } & Record<K, T[]> {
  let offset = 0;
  let limit = defaultLimit;
  if (params !== undefined) {
    if (!isRecord(params)) throw invalidParams('pagination params must be an object');
    if (params['offset'] !== undefined) offset = pageInteger(params['offset'], 'offset', 0);
    if (params['limit'] !== undefined) limit = pageInteger(params['limit'], 'limit', 1);
  }
  limit = Math.min(limit, 1000);
  return { total: values.length, [key]: values.slice(offset, offset + limit) } as {
    total: number;
  } & Record<K, T[]>;
}

function pageInteger(value: unknown, name: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw invalidParams(`${name} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function trackBorrowed(
  properties: PropertyDescriptor[],
  borrowed: Map<string, number>,
): void {
  for (const property of properties) {
    for (const value of [property.value, property.get, property.set]) {
      const id = value?.objectId;
      if (id) borrowed.set(id, (borrowed.get(id) ?? 0) + 1);
    }
  }
}

function releaseBorrowed(
  registry: ObjectRegistry,
  borrowed: Map<string, number>,
  objectId: string,
): number {
  const count = borrowed.get(objectId) ?? 0;
  for (let index = 0; index < count; index++) registry.release(objectId);
  borrowed.delete(objectId);
  return count;
}

function releaseAllBorrowed(registry: ObjectRegistry, borrowed: Map<string, number>): void {
  for (const [objectId, count] of borrowed) {
    for (let index = 0; index < count; index++) registry.release(objectId);
  }
  borrowed.clear();
}

function invalidParams(message: string): ProtocolRequestError {
  return new ProtocolRequestError({ code: ErrorCode.InvalidParams, message });
}

function releasedError(objectId: string): ProtocolRequestError {
  return new ProtocolRequestError({
    code: ErrorCode.ObjectReleased,
    message: 'Object has been released',
    data: objectId,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
