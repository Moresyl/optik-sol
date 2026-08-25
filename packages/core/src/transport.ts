/** Transport primitives and request/response orchestration for the Optik protocol. */

import {
  ErrorCode,
  isError,
  isEvent,
  isRequest,
  isResponse,
  type Event,
  type Message,
  type ProtocolError,
  type Request,
  type Transport,
} from './protocol';

type RequestHandler = (params: unknown) => unknown | Promise<unknown>;
type EventHandler = (params: unknown) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export interface ProtocolRequestOptions {
  /** Reject if no response arrives within this many milliseconds. Default 10s. */
  timeoutMs?: number;
}

/** Error returned by a protocol peer, retaining its stable numeric code. */
export class ProtocolRequestError extends Error {
  readonly code: number;
  readonly data?: string;

  constructor(error: ProtocolError) {
    super(error.message);
    this.name = 'ProtocolRequestError';
    this.code = error.code;
    this.data = error.data;
  }
}

/**
 * Maps protocol requests to handlers. Handler exceptions are converted to a generic
 * internal error so stack traces, file paths, and secrets never cross the transport.
 */
export class ProtocolRouter {
  #handlers = new Map<string, RequestHandler>();
  #off: () => void;
  #disposed = false;

  constructor(private readonly transport: Transport) {
    this.#off = transport.onMessage((message) => {
      void this.#handle(message);
    });
  }

  register(method: string, handler: RequestHandler): () => void {
    assertMethod(method);
    if (this.#handlers.has(method)) throw new Error(`Protocol method already registered: ${method}`);
    this.#handlers.set(method, handler);
    return () => {
      if (this.#handlers.get(method) === handler) this.#handlers.delete(method);
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    try {
      this.#off();
    } catch {
      // Third-party transports can fail while detaching after a disconnect.
    }
    this.#handlers.clear();
  }

  async #handle(message: Message): Promise<void> {
    if (this.#disposed || !isRequest(message)) return;
    const handler = this.#handlers.get(message.method);
    if (!handler) {
      this.#sendError(message.id, {
        code: ErrorCode.MethodNotFound,
        message: `Method not found: ${message.method}`,
      });
      return;
    }

    try {
      const result = await handler(message.params);
      // `undefined` disappears during JSON serialization and would leave neither a
      // result nor an error member. Normalize void handlers to an explicit null.
      if (!this.#send({ id: message.id, result: result === undefined ? null : result })) {
        this.#sendError(message.id, {
          code: ErrorCode.InternalError,
          message: 'Response is not serializable',
        });
      }
    } catch (error) {
      if (error instanceof ProtocolRequestError) {
        this.#sendError(message.id, {
          code: error.code,
          message: error.message,
          data: error.data,
        });
      } else {
        this.#sendError(message.id, {
          code: ErrorCode.InternalError,
          message: 'Internal error',
        });
      }
    }
  }

  #sendError(id: number, error: ProtocolError): void {
    this.#send({ id, error });
  }

  #send(message: Message): boolean {
    if (this.#disposed) return false;
    try {
      this.transport.send(message);
      return true;
    } catch {
      // The peer may disappear while an async handler is running.
      return false;
    }
  }
}

/** Request client with event subscriptions, timeouts, and deterministic teardown. */
export class ProtocolClient {
  #nextId = 1;
  #pending = new Map<number, PendingRequest>();
  #events = new Map<string, Set<EventHandler>>();
  #off: () => void;
  #closed = false;

  constructor(private readonly transport: Transport) {
    this.#off = transport.onMessage((message) => this.#receive(message));
  }

  request<R = unknown, P = unknown>(
    method: string,
    params?: P,
    options: ProtocolRequestOptions = {},
  ): Promise<R> {
    try {
      assertMethod(method);
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.#closed) return Promise.reject(closedError());

    const timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 2_147_483_647) {
      return Promise.reject(
        new RangeError('Protocol timeout must be a finite number between 0 and 2147483647'),
      );
    }

    const id = this.#nextId++;
    return new Promise<R>((resolve, reject) => {
      const pending: PendingRequest = {
        resolve: resolve as (value: unknown) => void,
        reject,
      };
      if (timeoutMs > 0) {
        pending.timer = setTimeout(() => {
          this.#pending.delete(id);
          reject(
            new ProtocolRequestError({
              code: ErrorCode.RequestTimeout,
              message: `Protocol request timed out: ${method}`,
            }),
          );
        }, timeoutMs);
      }
      this.#pending.set(id, pending);

      try {
        const request: Request<P> = { id, method };
        if (params !== undefined) request.params = params;
        this.transport.send(request);
      } catch (error) {
        this.#settle(id, false, error instanceof Error ? error : closedError());
      }
    });
  }

  on(method: string, handler: EventHandler): () => void {
    assertMethod(method);
    if (this.#closed) return () => undefined;
    let handlers = this.#events.get(method);
    if (!handlers) {
      handlers = new Set();
      this.#events.set(method, handlers);
    }
    handlers.add(handler);
    return () => handlers!.delete(handler);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    try {
      this.#off();
    } catch {
      // Cleanup must continue so pending requests are always rejected.
    }
    try {
      this.transport.close();
    } catch {
      // A transport is already unusable at this point; its close error is not actionable.
    }
    const error = closedError();
    for (const id of [...this.#pending.keys()]) this.#settle(id, false, error);
    this.#events.clear();
  }

  #receive(message: Message): void {
    if (this.#closed) return;
    if (isResponse(message)) {
      if (isError(message)) this.#settle(message.id, false, new ProtocolRequestError(message.error));
      else this.#settle(message.id, true, message.result);
      return;
    }
    if (!isEvent(message)) return;
    const handlers = this.#events.get(message.method);
    if (!handlers) return;
    for (const handler of [...handlers]) {
      try {
        handler(message.params);
      } catch {
        // One consumer cannot block the remaining event subscribers.
      }
    }
  }

  #settle(id: number, ok: boolean, value: unknown): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    if (pending.timer !== undefined) clearTimeout(pending.timer);
    if (ok) pending.resolve(value);
    else pending.reject(value);
  }
}

class InProcessTransport implements Transport {
  #peer?: InProcessTransport;
  #listeners = new Set<(message: Message) => void>();
  #closed = false;

  connect(peer: InProcessTransport): void {
    this.#peer = peer;
  }

  send(message: Message): void {
    const peer = this.#peer;
    if (this.#closed || !peer || peer.#closed) return;
    for (const listener of [...peer.#listeners]) {
      const cloned = cloneMessage(message);
      try {
        // A real wire transport necessarily serializes. Clone per listener so this
        // direct transport has the same ownership boundary and one consumer cannot
        // mutate kernel records or another consumer's message.
        listener(cloned);
      } catch {
        // Transport consumers are isolated from one another.
      }
    }
  }

  onMessage(handler: (message: Message) => void): () => void {
    if (this.#closed) return () => undefined;
    this.#listeners.add(handler);
    return () => this.#listeners.delete(handler);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#listeners.clear();
    const peer = this.#peer;
    this.#peer = undefined;
    if (peer && peer.#peer === this) peer.#peer = undefined;
  }
}

/** Creates two synchronous endpoints with wire-like cloning but no task scheduling. */
export function createInProcessTransportPair(): [Transport, Transport] {
  const left = new InProcessTransport();
  const right = new InProcessTransport();
  left.connect(right);
  right.connect(left);
  return [left, right];
}

export function sendEvent<P>(transport: Transport, method: string, params: P): void {
  assertMethod(method);
  const event: Event<unknown> = { method, params: params === undefined ? null : params };
  transport.send(event);
}

function closedError(): ProtocolRequestError {
  return new ProtocolRequestError({
    code: ErrorCode.TransportClosed,
    message: 'Protocol transport is closed',
  });
}

function assertMethod(method: string): void {
  if (!method || method.length > 256) {
    throw new TypeError('Protocol method must contain between 1 and 256 characters');
  }
}

function cloneMessage(message: Message): Message {
  if (typeof structuredClone === 'function') return structuredClone(message);
  // Legacy WebViews without structuredClone still support JSON, which is the format
  // expected by a WebSocket transport anyway.
  return JSON.parse(JSON.stringify(message)) as Message;
}
