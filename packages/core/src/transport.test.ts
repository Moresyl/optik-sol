import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, type Message } from './protocol';
import {
  createInProcessTransportPair,
  ProtocolClient,
  ProtocolRequestError,
  ProtocolRouter,
  sendEvent,
} from './transport';

const clients: ProtocolClient[] = [];
const routers: ProtocolRouter[] = [];

afterEach(() => {
  for (const client of clients.splice(0)) client.close();
  for (const router of routers.splice(0)) router.dispose();
  vi.useRealTimers();
});

function pair(): {
  client: ProtocolClient;
  router: ProtocolRouter;
  serverTransport: ReturnType<typeof createInProcessTransportPair>[0];
} {
  const [clientTransport, serverTransport] = createInProcessTransportPair();
  const router = new ProtocolRouter(serverTransport);
  const client = new ProtocolClient(clientTransport);
  clients.push(client);
  routers.push(router);
  return { client, router, serverTransport };
}

describe('protocol transport orchestration', () => {
  it('routes sync, async, and void requests', async () => {
    const { client, router } = pair();
    router.register('Math.double', (params) => Number(params) * 2);
    router.register('Math.async', async () => 'ready');
    router.register('Command.void', () => undefined);
    router.register('Command.uncloneable', () => () => undefined);

    await expect(client.request('Math.double', 4)).resolves.toBe(8);
    await expect(client.request('Math.async')).resolves.toBe('ready');
    await expect(client.request('Command.void')).resolves.toBeNull();
    await expect(client.request('Command.uncloneable')).rejects.toMatchObject({
      code: ErrorCode.InternalError,
      message: 'Response is not serializable',
    });
  });

  it('returns stable errors without leaking handler details', async () => {
    const { client, router } = pair();
    router.register('Secret.fail', () => {
      throw new Error('password=hidden C:\\private\\source.ts');
    });
    router.register('Params.fail', () => {
      throw new ProtocolRequestError({
        code: ErrorCode.InvalidParams,
        message: 'name must be a string',
      });
    });

    await expect(client.request('Missing.method')).rejects.toMatchObject({
      code: ErrorCode.MethodNotFound,
    });
    const internal = await client.request('Secret.fail').catch((error: unknown) => error);
    expect(internal).toMatchObject({ code: ErrorCode.InternalError, message: 'Internal error' });
    expect(String(internal)).not.toContain('password=hidden');
    await expect(client.request('Params.fail')).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
      message: 'name must be a string',
    });
  });

  it('isolates event listeners and supports unsubscription', () => {
    const { client, serverTransport } = pair();
    const first = vi.fn(() => {
      throw new Error('consumer failed');
    });
    const second = vi.fn();
    const off = client.on('Log.entryAdded', first);
    client.on('Log.entryAdded', second);

    sendEvent(serverTransport, 'Log.entryAdded', { id: 'log:1' });
    off();
    sendEvent(serverTransport, 'Log.entryAdded', { id: 'log:2' });

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);
    expect(() => sendEvent(serverTransport, '', {})).toThrow(TypeError);
  });

  it('times out, validates options, and rejects pending work on close', async () => {
    vi.useFakeTimers();
    const [clientTransport] = createInProcessTransportPair();
    const client = new ProtocolClient(clientTransport);
    clients.push(client);

    const timeout = client.request('Never.responds', undefined, { timeoutMs: 20 });
    const timeoutAssertion = expect(timeout).rejects.toMatchObject({
      code: ErrorCode.RequestTimeout,
    });
    await vi.advanceTimersByTimeAsync(20);
    await timeoutAssertion;
    await expect(
      client.request('Invalid.timeout', undefined, { timeoutMs: Number.POSITIVE_INFINITY }),
    ).rejects.toBeInstanceOf(RangeError);

    const pending = client.request('Still.pending', undefined, { timeoutMs: 0 });
    client.close();
    await expect(pending).rejects.toMatchObject({ code: ErrorCode.TransportClosed });
    await expect(client.request('After.close')).rejects.toMatchObject({
      code: ErrorCode.TransportClosed,
    });
    expect(() => client.close()).not.toThrow();
    expect(() => client.on('Late.event', vi.fn())()).not.toThrow();
  });

  it('contains transport listeners and honors endpoint teardown', () => {
    const [left, right] = createInProcessTransportPair();
    const broken = vi.fn(() => {
      throw new Error('listener failed');
    });
    const healthy = vi.fn();
    const offBroken = right.onMessage(broken);
    right.onMessage(healthy);
    const message: Message = { method: 'Test.event', params: {} };
    left.send(message);
    offBroken();
    left.send(message);
    right.close();
    left.send(message);

    expect(broken).toHaveBeenCalledOnce();
    expect(healthy).toHaveBeenCalledTimes(2);
    expect(() => right.close()).not.toThrow();
  });

  it('clones messages per recipient to enforce a wire-like ownership boundary', () => {
    const [left, right] = createInProcessTransportPair();
    const source = { method: 'Test.event', params: { value: 1 } } satisfies Message;
    const second = vi.fn();
    right.onMessage((message) => {
      (message as { params: { value: number } }).params.value = 9;
    });
    right.onMessage(second);
    left.send(source);

    expect(source.params.value).toBe(1);
    expect(second).toHaveBeenCalledWith({ method: 'Test.event', params: { value: 1 } });
  });

  it('uses JSON cloning in legacy environments without structuredClone', () => {
    const original = globalThis.structuredClone;
    vi.stubGlobal('structuredClone', undefined);
    try {
      const [left, right] = createInProcessTransportPair();
      const received = vi.fn();
      right.onMessage(received);
      left.send({ method: 'Test.legacy', params: { value: 1 } });
      expect(received).toHaveBeenCalledWith({ method: 'Test.legacy', params: { value: 1 } });
    } finally {
      vi.stubGlobal('structuredClone', original);
    }
  });

  it('rejects invalid methods and uncloneable request data', async () => {
    const { client, router, serverTransport } = pair();
    expect(() => router.register('x'.repeat(257), vi.fn())).toThrow(TypeError);
    expect(() => client.on('', vi.fn())).toThrow(TypeError);
    await expect(client.request('x'.repeat(257))).rejects.toBeInstanceOf(TypeError);
    await expect(
      client.request('Data.clone', { callback: () => undefined }, { timeoutMs: 1 }),
    ).rejects.toThrow();
    expect(() => sendEvent(serverTransport, 'x'.repeat(257), {})).toThrow(TypeError);
  });

  it('validates registrations and ignores a late async result after disposal', async () => {
    const { client, router } = pair();
    expect(() => router.register('', vi.fn())).toThrow(TypeError);
    const handler = vi.fn(() => 1);
    const unregister = router.register('One.method', handler);
    expect(() => router.register('One.method', handler)).toThrow('already registered');
    unregister();
    await expect(client.request('One.method')).rejects.toMatchObject({
      code: ErrorCode.MethodNotFound,
    });

    let finish!: (value: string) => void;
    router.register('Slow.method', () => new Promise((resolve) => (finish = resolve)));
    vi.useFakeTimers();
    const pending = client.request('Slow.method', undefined, { timeoutMs: 1 });
    const pendingAssertion = expect(pending).rejects.toMatchObject({
      code: ErrorCode.RequestTimeout,
    });
    router.dispose();
    finish('late');
    await vi.advanceTimersByTimeAsync(1);
    await pendingAssertion;
  });

  it('finishes client and router cleanup when a third-party transport teardown throws', async () => {
    let handler: ((message: Message) => void) | undefined;
    const transport = {
      send: vi.fn(),
      onMessage: vi.fn((next: (message: Message) => void) => {
        handler = next;
        return () => {
          throw new Error('unsubscribe failed');
        };
      }),
      close: vi.fn(() => {
        throw new Error('close failed');
      }),
    };
    const client = new ProtocolClient(transport);
    const pending = client.request('Never.responds', undefined, { timeoutMs: 0 });

    expect(() => client.close()).not.toThrow();
    await expect(pending).rejects.toMatchObject({ code: ErrorCode.TransportClosed });
    expect(transport.close).toHaveBeenCalledOnce();
    expect(handler).toBeTypeOf('function');

    const router = new ProtocolRouter(transport);
    router.register('Test.method', () => 'value');
    expect(() => router.dispose()).not.toThrow();
    handler!({ id: 1, method: 'Test.method' });
    expect(transport.send).toHaveBeenCalledTimes(1); // The client's request only.
  });
});
