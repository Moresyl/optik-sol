/**
 * The transports everyone forgets: `sendBeacon`, `WebSocket`, `EventSource`.
 *
 * Beacons are how analytics and crash reporting leave the page, and wrapper-based
 * consoles typically ignore them entirely — or list the call without ever reporting
 * whether the browser actually accepted it, which is the only thing worth knowing.
 * WebSocket traffic is likewise undebuggable on a phone without a remote inspector;
 * here every frame is captured.
 */

import type { NetworkRecord, WebSocketFrame } from '../types';
import type { Instrumentation, NetworkSink } from './xhr';
import { byteLengthOf, describeRequestBody, splitUrl, truncateText } from './body';

export interface MiscNetworkOptions {
  nextId(): string;
  /** Cap on retained frames per socket. */
  maxFrames?: number;
  /** Cap on a single frame's recorded payload. */
  maxFramePayload?: number;
}

export function instrumentSendBeacon(sink: NetworkSink, options: MiscNetworkOptions): Instrumentation {
  const original = globalThis.navigator?.sendBeacon;
  if (typeof original !== 'function') return { dispose() {} };

  const wrapped = function sendBeacon(this: Navigator, rawUrl: string | URL, data?: BodyInit | null): boolean {
    const id = options.nextId();
    const startTime = performance.now();
    const { url, name, origin, query } = splitUrl(String(rawUrl));

    let accepted = false;
    let error: unknown;
    try {
      accepted = original.call(globalThis.navigator, rawUrl, data);
    } catch (err) {
      error = err;
    }

    const endTime = performance.now();
    try {
      const record: NetworkRecord = {
        id,
        initiator: 'beacon',
        method: 'POST',
        url,
        name,
        origin,
        query,
        requestHeaders: [],
        requestBody: describeRequestBody(data, undefined),
        responseHeaders: [],
        // A beacon has no response by design; `accepted` is the only signal that
        // exists, so we surface it as the status rather than pretending it is HTTP.
        phase: accepted ? 'complete' : 'failed',
        status: accepted ? 202 : 0,
        statusText: accepted ? 'Queued by browser' : 'Rejected (queue full or payload too large)',
        error: error ? String(error) : accepted ? undefined : 'navigator.sendBeacon() returned false',
        timing: { startTime, endTime, duration: endTime - startTime },
      };
      sink.onStart(record);
    } catch {
      // Ignore.
    }

    if (error) throw error;
    return accepted;
  };

  globalThis.navigator.sendBeacon = wrapped;
  return {
    dispose() {
      globalThis.navigator.sendBeacon = original;
    },
  };
}

export function instrumentWebSocket(sink: NetworkSink, options: MiscNetworkOptions): Instrumentation {
  const Original = globalThis.WebSocket;
  if (typeof Original !== 'function') return { dispose() {} };

  const { maxFrames = 500, maxFramePayload = 8 * 1024 } = options;

  class OptikWebSocket extends Original {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);

      const id = options.nextId();
      const startTime = performance.now();
      const { url: fullUrl, name, origin, query } = splitUrl(String(url));
      const frames: WebSocketFrame[] = [];

      const pushFrame = (frame: WebSocketFrame) => {
        frames.push(frame);
        // Bound retention: a chatty socket must not grow without limit.
        if (frames.length > maxFrames) frames.splice(0, frames.length - maxFrames);
        try {
          sink.onUpdate(id, { frames: [...frames] });
        } catch {
          // Ignore.
        }
      };

      try {
        sink.onStart({
          id,
          initiator: 'websocket',
          method: 'GET',
          url: fullUrl,
          name,
          origin,
          query,
          requestHeaders: protocols
            ? [['Sec-WebSocket-Protocol', Array.isArray(protocols) ? protocols.join(', ') : protocols]]
            : [],
          responseHeaders: [],
          phase: 'pending',
          timing: { startTime },
          frames: [],
        });
      } catch {
        // Ignore.
      }

      this.addEventListener('open', () => {
        const now = performance.now();
        try {
          sink.onUpdate(id, {
            phase: 'loading',
            status: 101,
            statusText: 'Switching Protocols',
            timing: { startTime, responseStart: now },
          });
        } catch {
          // Ignore.
        }
      });

      this.addEventListener('message', (event: MessageEvent) => {
        pushFrame(describeFrame('receive', event.data, maxFramePayload));
      });

      this.addEventListener('close', (event: CloseEvent) => {
        const endTime = performance.now();
        pushFrame({
          direction: 'receive',
          timestamp: Date.now(),
          opcode: 'close',
          payload: `code=${event.code}${event.reason ? ` reason=${event.reason}` : ''}${
            event.wasClean ? '' : ' (unclean)'
          }`,
          size: 0,
        });
        try {
          sink.onUpdate(id, {
            phase: event.wasClean ? 'complete' : 'failed',
            error: event.wasClean ? undefined : `Connection closed uncleanly (code ${event.code})`,
            timing: { startTime, endTime, duration: endTime - startTime },
          });
        } catch {
          // Ignore.
        }
      });

      this.addEventListener('error', () => {
        try {
          sink.onUpdate(id, { phase: 'failed', error: 'WebSocket error' });
        } catch {
          // Ignore.
        }
      });

      // Wrap `send` per-instance so outbound frames are captured too.
      const originalSend = this.send.bind(this);
      this.send = (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
        try {
          pushFrame(describeFrame('send', data, maxFramePayload));
        } catch {
          // Ignore.
        }
        originalSend(data);
      };
    }
  }

  // Preserve the constants (`WebSocket.OPEN` etc.) that library code checks.
  globalThis.WebSocket = OptikWebSocket as unknown as typeof WebSocket;

  return {
    dispose() {
      globalThis.WebSocket = Original;
    },
  };
}

function describeFrame(
  direction: 'send' | 'receive',
  data: unknown,
  maxPayload: number,
): WebSocketFrame {
  if (typeof data === 'string') {
    const size = byteLengthOf(data);
    return {
      direction,
      timestamp: Date.now(),
      opcode: 'text',
      payload: truncateText(data, undefined, maxPayload).text ?? '',
      size,
    };
  }
  if (data instanceof ArrayBuffer) {
    return {
      direction,
      timestamp: Date.now(),
      opcode: 'binary',
      payload: `ArrayBuffer(${data.byteLength})`,
      size: data.byteLength,
    };
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return {
      direction,
      timestamp: Date.now(),
      opcode: 'binary',
      payload: `Blob(${data.size}, ${data.type || 'unknown'})`,
      size: data.size,
    };
  }
  if (ArrayBuffer.isView(data)) {
    return {
      direction,
      timestamp: Date.now(),
      opcode: 'binary',
      payload: `${data.constructor.name}(${data.byteLength})`,
      size: data.byteLength,
    };
  }
  return { direction, timestamp: Date.now(), opcode: 'binary', payload: String(data), size: 0 };
}

export function instrumentEventSource(sink: NetworkSink, options: MiscNetworkOptions): Instrumentation {
  const Original = globalThis.EventSource;
  if (typeof Original !== 'function') return { dispose() {} };

  const { maxFrames = 500, maxFramePayload = 8 * 1024 } = options;

  class OptikEventSource extends Original {
    constructor(url: string | URL, init?: EventSourceInit) {
      super(url, init);
      const id = options.nextId();
      const startTime = performance.now();
      const { url: fullUrl, name, origin, query } = splitUrl(String(url));
      const frames: WebSocketFrame[] = [];

      try {
        sink.onStart({
          id,
          initiator: 'eventsource',
          method: 'GET',
          url: fullUrl,
          name,
          origin,
          query,
          requestHeaders: [['Accept', 'text/event-stream']],
          responseHeaders: [],
          phase: 'pending',
          timing: { startTime },
          frames: [],
        });
      } catch {
        // Ignore.
      }

      this.addEventListener('open', () => {
        try {
          sink.onUpdate(id, { phase: 'loading', status: 200, timing: { startTime, responseStart: performance.now() } });
        } catch {
          // Ignore.
        }
      });

      this.addEventListener('message', (event: MessageEvent) => {
        frames.push(describeFrame('receive', event.data, maxFramePayload));
        if (frames.length > maxFrames) frames.splice(0, frames.length - maxFrames);
        try {
          sink.onUpdate(id, { frames: [...frames] });
        } catch {
          // Ignore.
        }
      });

      this.addEventListener('error', () => {
        try {
          sink.onUpdate(id, {
            phase: this.readyState === 2 ? 'failed' : 'loading',
            error: this.readyState === 2 ? 'EventSource closed' : 'EventSource reconnecting',
          });
        } catch {
          // Ignore.
        }
      });
    }
  }

  globalThis.EventSource = OptikEventSource as unknown as typeof EventSource;
  return {
    dispose() {
      globalThis.EventSource = Original;
    },
  };
}
