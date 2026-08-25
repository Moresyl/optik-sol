import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { NetworkRecord } from '../types';
import { instrumentEventSource, instrumentSendBeacon, instrumentWebSocket } from './misc-network';
import type { NetworkSink } from './xhr';

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readonly protocols: string | string[] | undefined;
  readonly sent: unknown[] = [];

  constructor(url: string | URL, protocols?: string | string[]) {
    super();
    this.url = String(url);
    this.protocols = protocols;
  }

  send(data: unknown): void {
    this.sent.push(data);
  }
}

class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readyState = 0;
  readonly url: string;
  readonly withCredentials: boolean;

  constructor(url: string | URL, init?: EventSourceInit) {
    super();
    this.url = String(url);
    this.withCredentials = init?.withCredentials ?? false;
  }

  close(): void {
    this.readyState = 2;
  }
}

describe('miscellaneous network instrumentation', () => {
  let originalWebSocket: typeof WebSocket;
  let originalEventSource: typeof EventSource;
  let sendBeaconDescriptor: PropertyDescriptor | undefined;
  let starts: Mock<(record: NetworkRecord) => void>;
  let updates: Mock<(id: string, patch: Partial<NetworkRecord>) => void>;
  let sink: NetworkSink;
  let next: number;

  const installSocketFakes = () => {
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      writable: true,
      value: FakeWebSocket,
    });
    Object.defineProperty(globalThis, 'EventSource', {
      configurable: true,
      writable: true,
      value: FakeEventSource,
    });
  };

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    originalEventSource = globalThis.EventSource;
    sendBeaconDescriptor = Object.getOwnPropertyDescriptor(navigator, 'sendBeacon');
    starts = vi.fn<(record: NetworkRecord) => void>();
    updates = vi.fn<(id: string, patch: Partial<NetworkRecord>) => void>();
    sink = { onStart: starts, onUpdate: updates };
    next = 1;
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      writable: true,
      value: originalWebSocket,
    });
    Object.defineProperty(globalThis, 'EventSource', {
      configurable: true,
      writable: true,
      value: originalEventSource,
    });
    if (sendBeaconDescriptor) Object.defineProperty(navigator, 'sendBeacon', sendBeaconDescriptor);
    else delete (navigator as unknown as { sendBeacon?: typeof navigator.sendBeacon }).sendBeacon;
  });

  it.each([true, false])('captures whether sendBeacon was accepted: %s', (accepted) => {
    const original = vi.fn().mockReturnValue(accepted);
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: original,
    });
    const instrumentation = instrumentSendBeacon(sink, { nextId: () => `net:${next++}` });

    expect(navigator.sendBeacon('https://example.test/collect?a=1', 'payload')).toBe(accepted);
    expect(original).toHaveBeenCalledWith('https://example.test/collect?a=1', 'payload');
    expect(starts).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'net:1',
        initiator: 'beacon',
        method: 'POST',
        query: [['a', '1']],
        phase: accepted ? 'complete' : 'failed',
        status: accepted ? 202 : 0,
        error: accepted ? undefined : 'navigator.sendBeacon() returned false',
        requestBody: expect.objectContaining({ text: 'payload' }),
      }),
    );
    instrumentation.dispose();
    expect(navigator.sendBeacon).toBe(original);
  });

  it('records and rethrows sendBeacon failures', () => {
    const error = new TypeError('bad URL');
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: vi.fn(() => {
        throw error;
      }),
    });
    const instrumentation = instrumentSendBeacon(sink, { nextId: () => `net:${next++}` });
    expect(() => navigator.sendBeacon('invalid')).toThrow(error);
    expect(starts).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'failed', error: 'TypeError: bad URL' }),
    );
    instrumentation.dispose();
  });

  it('captures bounded WebSocket frames and connection state', () => {
    installSocketFakes();
    const instrumentation = instrumentWebSocket(sink, {
      nextId: () => `net:${next++}`,
      maxFrames: 2,
      maxFramePayload: 4,
    });
    const socket = new WebSocket('wss://example.test/socket?room=1', ['chat', 'json']) as unknown as FakeWebSocket;
    expect(starts).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'net:1',
        initiator: 'websocket',
        requestHeaders: [['Sec-WebSocket-Protocol', 'chat, json']],
        phase: 'pending',
      }),
    );

    socket.dispatchEvent(new Event('open'));
    socket.send('abcdef');
    socket.dispatchEvent(new MessageEvent('message', { data: 'received' }));
    socket.send(new Uint8Array(3));

    const framePatch = updates.mock.calls.filter(([, patch]) => patch.frames).at(-1)?.[1];
    expect(framePatch?.frames).toHaveLength(2);
    expect(framePatch?.frames?.[0]).toMatchObject({
      direction: 'receive',
      opcode: 'text',
      payload: 'rece',
      size: 8,
    });
    expect(framePatch?.frames?.[1]).toMatchObject({
      direction: 'send',
      opcode: 'binary',
      size: 3,
    });
    expect(socket.sent).toEqual(['abcdef', new Uint8Array(3)]);

    socket.dispatchEvent(
      new CloseEvent('close', { code: 1006, reason: 'lost', wasClean: false }),
    );
    expect(updates).toHaveBeenLastCalledWith(
      'net:1',
      expect.objectContaining({ phase: 'failed', error: expect.stringContaining('1006') }),
    );
    instrumentation.dispose();
  });

  it('captures EventSource messages and reconnect/closed states', () => {
    installSocketFakes();
    const instrumentation = instrumentEventSource(sink, {
      nextId: () => `net:${next++}`,
      maxFrames: 1,
      maxFramePayload: 5,
    });
    const source = new EventSource('https://example.test/events') as unknown as FakeEventSource;
    source.dispatchEvent(new Event('open'));
    source.dispatchEvent(new MessageEvent('message', { data: 'first message' }));
    source.dispatchEvent(new MessageEvent('message', { data: 'second message' }));

    const framePatch = updates.mock.calls.filter(([, patch]) => patch.frames).at(-1)?.[1];
    expect(framePatch?.frames).toHaveLength(1);
    expect(framePatch?.frames?.[0]).toMatchObject({ payload: 'secon', size: 14 });

    source.readyState = 0;
    source.dispatchEvent(new Event('error'));
    expect(updates).toHaveBeenLastCalledWith(
      'net:1',
      expect.objectContaining({ phase: 'loading', error: 'EventSource reconnecting' }),
    );
    source.readyState = 2;
    source.dispatchEvent(new Event('error'));
    expect(updates).toHaveBeenLastCalledWith(
      'net:1',
      expect.objectContaining({ phase: 'failed', error: 'EventSource closed' }),
    );
    instrumentation.dispose();
  });

  it('stops recording existing transports after disposal and preserves later wrappers', () => {
    installSocketFakes();
    const webSocketInstrumentation = instrumentWebSocket(sink, { nextId: () => `net:${next++}` });
    const optikWebSocket = globalThis.WebSocket;
    const socket = new WebSocket('wss://example.test/socket') as unknown as FakeWebSocket;
    class LaterWebSocket extends (optikWebSocket as typeof WebSocket) {}
    globalThis.WebSocket = LaterWebSocket;

    webSocketInstrumentation.dispose();
    const before = updates.mock.calls.length;
    socket.dispatchEvent(new MessageEvent('message', { data: 'ignored' }));
    expect(updates).toHaveBeenCalledTimes(before);
    expect(globalThis.WebSocket).toBe(LaterWebSocket);

    new WebSocket('wss://example.test/after');
    expect(starts).toHaveBeenCalledOnce();
  });
});
