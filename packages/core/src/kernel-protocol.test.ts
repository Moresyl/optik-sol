import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachKernelProtocol, KernelProtocolMethods } from './kernel-protocol';
import { OptikKernel } from './kernel';
import { ErrorCode } from './protocol';
import { createInProcessTransportPair, ProtocolClient } from './transport';
import type { NetworkRecord } from './types';

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function session(): { kernel: OptikKernel; client: ProtocolClient; disposeServer: () => void } {
  const kernel = new OptikKernel({ capture: { console: false } });
  const [clientTransport, serverTransport] = createInProcessTransportPair();
  const server = attachKernelProtocol(kernel, serverTransport);
  const client = new ProtocolClient(clientTransport);
  cleanups.push(() => kernel.dispose(), () => server.dispose(), () => client.close());
  return { kernel, client, disposeServer: () => server.dispose() };
}

describe('attachKernelProtocol', () => {
  it('queries logs, expands retained objects, clears, and reports released handles', async () => {
    const { kernel, client } = session();
    const added = vi.fn();
    const cleared = vi.fn();
    client.on('Log.entryAdded', added);
    client.on('Log.cleared', cleared);
    const entry = kernel.log.ingest({
      level: 'log',
      origin: 'user',
      args: ['object', { answer: 42 }],
    })!;
    const objectId = entry.args[1]!.objectId!;

    await expect(client.request(KernelProtocolMethods.LogEntries)).resolves.toEqual({
      total: 1,
      entries: [entry],
    });
    const originalText = entry.text;
    const remotePage = await client.request<{ total: number; entries: typeof entry[] }>(
      KernelProtocolMethods.LogEntries,
    );
    remotePage.entries[0]!.text = 'mutated remotely';
    expect(kernel.log.entries()[0]!.text).toBe(originalText);
    await expect(
      client.request(KernelProtocolMethods.LogGetProperties, { objectId }),
    ).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'answer' })]));
    expect(added).toHaveBeenCalledWith(entry);

    await expect(client.request(KernelProtocolMethods.LogClear)).resolves.toEqual({});
    expect(cleared).toHaveBeenCalledWith({});
    await expect(
      client.request(KernelProtocolMethods.LogGetProperties, { objectId }),
    ).rejects.toMatchObject({ code: ErrorCode.ObjectReleased, data: objectId });
  });

  it('validates expansion params without invoking getters', async () => {
    const { kernel, client } = session();
    const getter = vi.fn(() => 'secret');
    const source = Object.defineProperty({}, 'value', { enumerable: true, get: getter });
    const entry = kernel.log.ingest({ level: 'log', origin: 'user', args: [source] })!;
    const objectId = entry.args[0]!.objectId!;

    const initialProperties = await client.request<
      Array<{ name: string; get?: { objectId?: string }; set?: { objectId?: string }; value?: { objectId?: string } }>
    >(KernelProtocolMethods.LogGetProperties, {
      objectId,
      options: { invokeGetters: false },
    });
    expect(initialProperties).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'value' })]),
    );
    expect(getter).not.toHaveBeenCalled();
    await expect(
      client.request(KernelProtocolMethods.LogGetProperties, {
        objectId,
        options: { invokeGetters: 'yes' },
      }),
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    await expect(
      client.request(KernelProtocolMethods.LogGetProperties, { objectId: 'x'.repeat(257) }),
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    await expect(
      client.request(KernelProtocolMethods.LogGetProperties, { objectId, options: true }),
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    await expect(
      client.request(KernelProtocolMethods.LogGetProperties, {
        objectId,
        options: { maxProperties: 0 },
      }),
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    await expect(
      client.request(KernelProtocolMethods.LogGetProperties, {
        objectId,
        options: { maxProperties: 10_001 },
      }),
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });

    const borrowedId = initialProperties.flatMap((property) => [
      property.value?.objectId,
      property.get?.objectId,
      property.set?.objectId,
    ]).find((id): id is string => Boolean(id));
    expect(borrowedId).toBeDefined();
    await expect(
      client.request(KernelProtocolMethods.LogReleaseObject, { objectId: borrowedId }),
    ).resolves.toEqual({ released: 1 });
    await expect(
      client.request(KernelProtocolMethods.LogReleaseObject, { objectId: borrowedId }),
    ).resolves.toEqual({ released: 0 });
  });

  it('exposes bounded network/performance/system data and live events', async () => {
    const { kernel, client } = session();
    const networkStarted = vi.fn();
    const taskAdded = vi.fn();
    const networkUpdated = vi.fn();
    const networkCleared = vi.fn();
    const networkResized = vi.fn();
    const performanceCleared = vi.fn();
    const performanceResized = vi.fn();
    client.on('Network.requestStarted', networkStarted);
    client.on('Network.requestUpdated', networkUpdated);
    client.on('Network.cleared', networkCleared);
    client.on('Network.resized', networkResized);
    client.on('Performance.longTaskAdded', taskAdded);
    client.on('Performance.cleared', performanceCleared);
    client.on('Performance.resized', performanceResized);
    const network = {
      id: 'net:1',
      initiator: 'fetch' as const,
      method: 'GET',
      url: 'https://example.test/api',
      name: 'api',
      origin: 'https://example.test',
      query: [],
      requestHeaders: [],
      responseHeaders: [],
      phase: 'complete' as const,
      timing: { startTime: 1, duration: 2 },
    };
    const task = {
      id: kernel.performance.nextId(),
      startTime: 3,
      duration: 55,
      name: 'self',
      attribution: [],
    };
    kernel.network.onStart(network);
    kernel.network.onUpdate(network.id, { status: 200 });
    kernel.network.setMaxRecords(10);
    kernel.performance.onLongTask(task);
    kernel.performance.setMaxLongTasks(10);

    await expect(client.request(KernelProtocolMethods.NetworkRecords)).resolves.toEqual({
      total: 1,
      records: [network],
    });
    await expect(client.request(KernelProtocolMethods.PerformanceLongTasks)).resolves.toEqual({
      total: 1,
      longTasks: [task],
    });
    await expect(client.request(KernelProtocolMethods.SystemInfo)).resolves.toEqual(
      expect.objectContaining({ capabilities: expect.any(Object), viewport: expect.any(Object) }),
    );
    expect(networkStarted).toHaveBeenCalledWith(expect.objectContaining({ id: network.id }));
    expect(networkStarted.mock.calls[0]?.[0]).not.toHaveProperty('status');
    expect(networkUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 200 }));
    expect(networkResized).toHaveBeenCalledWith({ capacity: 10 });
    expect(taskAdded).toHaveBeenCalledWith(task);
    expect(performanceResized).toHaveBeenCalledWith({ capacity: 10 });

    await expect(client.request(KernelProtocolMethods.NetworkClear)).resolves.toEqual({});
    await expect(client.request(KernelProtocolMethods.PerformanceClear)).resolves.toEqual({});
    expect(kernel.network.records()).toEqual([]);
    expect(kernel.performance.longTasks()).toEqual([]);
    expect(networkCleared).toHaveBeenCalledWith({});
    expect(performanceCleared).toHaveBeenCalledWith({});
  });

  it('paginates streams and validates runtime capacities', async () => {
    const { kernel, client } = session();
    for (let index = 0; index < 3; index++) {
      kernel.log.ingest({ level: 'log', origin: 'user', args: [`line ${index}`] });
    }
    await expect(
      client.request(KernelProtocolMethods.LogEntries, { offset: 1, limit: 1 }),
    ).resolves.toMatchObject({ total: 3, entries: [expect.objectContaining({ text: 'line 1' })] });
    await expect(
      client.request(KernelProtocolMethods.LogEntries, { offset: -1 }),
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    await expect(
      client.request(KernelProtocolMethods.LogEntries, { limit: 1.5 }),
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    await expect(
      client.request(KernelProtocolMethods.LogEntries, 'invalid'),
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });

    await expect(
      client.request(KernelProtocolMethods.LogSetMaxEntries, { capacity: 2.9 }),
    ).resolves.toEqual({ capacity: 2 });
    await expect(
      client.request(KernelProtocolMethods.NetworkSetMaxRecords, { capacity: 5 }),
    ).resolves.toEqual({ capacity: 5 });
    await expect(
      client.request(KernelProtocolMethods.PerformanceSetMaxLongTasks, { capacity: 6 }),
    ).resolves.toEqual({ capacity: 6 });
    await expect(
      client.request(KernelProtocolMethods.LogSetMaxEntries, { capacity: Number.NaN }),
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    await expect(
      client.request(KernelProtocolMethods.LogSetMaxEntries, { capacity: 1_000_001 }),
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    await expect(
      client.request(KernelProtocolMethods.LogSetMaxEntries, undefined),
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
  });

  it('expands parsed network bodies and reports released network handles', async () => {
    const { kernel, client } = session();
    const record: NetworkRecord = {
      id: 'net:body',
      initiator: 'fetch' as const,
      method: 'GET',
      url: 'https://example.test/data',
      name: 'data',
      origin: 'https://example.test',
      query: [],
      requestHeaders: [],
      responseHeaders: [['content-type', 'application/json']] as [string, string][],
      responseBody: { text: '{"nested":{"answer":42}}', mimeType: 'application/json' },
      phase: 'complete' as const,
      timing: { startTime: 1 },
    };
    kernel.network.onStart(record);
    const objectId = record.responseBody!.parsed!.objectId!;
    const properties = await client.request<Array<{ name: string; value?: { objectId?: string } }>>(
      KernelProtocolMethods.NetworkGetProperties,
      { objectId },
    );
    expect(properties).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'nested' })]));
    const nestedId = properties.find((property) => property.value?.objectId)?.value?.objectId;
    if (nestedId) {
      await expect(
        client.request(KernelProtocolMethods.NetworkReleaseObject, { objectId: nestedId }),
      ).resolves.toEqual({ released: 1 });
    }
    await expect(
      client.request(KernelProtocolMethods.NetworkGetProperties, { objectId }),
    ).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'nested' })]));
    kernel.network.clear();
    await expect(
      client.request(KernelProtocolMethods.NetworkGetProperties, { objectId }),
    ).rejects.toMatchObject({ code: ErrorCode.ObjectReleased });
  });

  it('stops forwarding events and releases borrowed handles after server disposal', async () => {
    const { kernel, client, disposeServer } = session();
    const event = vi.fn();
    client.on('Log.entryAdded', event);
    const entry = kernel.log.ingest({
      level: 'info',
      origin: 'user',
      args: [{ child: {} }],
    })!;
    const rootId = entry.args[0]!.objectId!;
    await client.request(KernelProtocolMethods.LogGetProperties, { objectId: rootId });
    expect(kernel.log.registry.size).toBeGreaterThan(1);
    event.mockClear();
    disposeServer();
    disposeServer();
    expect(kernel.log.registry.size).toBe(1);
    kernel.log.ingest({ level: 'info', origin: 'user', args: ['late'] });
    expect(event).not.toHaveBeenCalled();
  });
});
