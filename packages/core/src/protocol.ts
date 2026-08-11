/**
 * Optik wire protocol.
 *
 * Deliberately shaped like the Chrome DevTools Protocol (CDP): every interaction is
 * either a `Request` (id + method + params -> Response) or a server-pushed `Event`
 * (method + params). Domains are namespaced with `Domain.command`.
 *
 * Why this matters: the in-page panel and a future remote debugger speak the *same*
 * language. Swapping `InProcessTransport` for a WebSocket transport turns Optik into a
 * remote debugging agent with zero changes to the domains or the UI. It also means we
 * can proxy a real Chrome DevTools frontend later without rewriting the kernel.
 */

export interface Request<P = unknown> {
  id: number;
  method: string;
  params?: P;
}

export interface SuccessResponse<R = unknown> {
  id: number;
  result: R;
}

export interface ErrorResponse {
  id: number;
  error: ProtocolError;
}

export type Response<R = unknown> = SuccessResponse<R> | ErrorResponse;

export interface ProtocolError {
  code: number;
  message: string;
  data?: string;
}

export interface Event<P = unknown> {
  method: string;
  params: P;
}

/** Anything that can travel over a transport. */
export type Message = Request | Response | Event;

export const ErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  /** The object id referenced by the request has been evicted from the registry. */
  ObjectReleased: -32000,
} as const;

export function isResponse(msg: Message): msg is Response {
  return 'id' in msg && !('method' in msg);
}

export function isRequest(msg: Message): msg is Request {
  return 'id' in msg && 'method' in msg;
}

export function isEvent(msg: Message): msg is Event {
  return !('id' in msg) && 'method' in msg;
}

export function isError(res: Response): res is ErrorResponse {
  return 'error' in res;
}

/**
 * A transport moves protocol messages between the kernel and a client.
 * `InProcessTransport` is a direct function call; a remote transport would be a
 * WebSocket. Both must be able to survive the other end disappearing.
 */
export interface Transport {
  send(message: Message): void;
  onMessage(handler: (message: Message) => void): void;
  close(): void;
}
