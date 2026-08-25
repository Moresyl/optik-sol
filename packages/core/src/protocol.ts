/**
 * Optik wire protocol.
 *
 * Deliberately shaped like the Chrome DevTools Protocol (CDP): every interaction is
 * either a `Request` (id + method + params -> Response) or a server-pushed `Event`
 * (method + params). Domains are namespaced with `Domain.command`.
 *
 * The built-in UI uses the same domain facade directly to avoid serializing high-volume
 * local events. `attachKernelProtocol` binds that facade to a trusted transport for a
 * worker or remote client without changing domain implementations.
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
  RequestTimeout: -32001,
  TransportClosed: -32002,
} as const;

export function isResponse(msg: unknown): msg is Response {
  if (!isRecord(msg) || !validId(msg['id']) || 'method' in msg) return false;
  if ('result' in msg) return !('error' in msg);
  return !('result' in msg) && isProtocolError(msg['error']);
}

export function isRequest(msg: unknown): msg is Request {
  return (
    isRecord(msg) &&
    validId(msg['id']) &&
    validMethod(msg['method']) &&
    !('result' in msg) &&
    !('error' in msg)
  );
}

export function isEvent(msg: unknown): msg is Event {
  return isRecord(msg) && !('id' in msg) && validMethod(msg['method']) && 'params' in msg;
}

export function isError(res: unknown): res is ErrorResponse {
  return isResponse(res) && 'error' in res;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validMethod(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function isProtocolError(value: unknown): value is ProtocolError {
  return (
    isRecord(value) &&
    typeof value['code'] === 'number' &&
    Number.isSafeInteger(value['code']) &&
    typeof value['message'] === 'string' &&
    (value['data'] === undefined || typeof value['data'] === 'string')
  );
}

/**
 * A transport moves protocol messages between the kernel and a client.
 * `InProcessTransport` is a direct function call; a remote transport would be a
 * WebSocket. Both must be able to survive the other end disappearing.
 */
export interface Transport {
  send(message: Message): void;
  onMessage(handler: (message: Message) => void): () => void;
  close(): void;
}
