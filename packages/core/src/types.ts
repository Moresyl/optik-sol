/** Public data model shared by the kernel, the UI, and any remote client. */

import type { RemoteObject } from './remote-object';

export type LogLevel = 'debug' | 'log' | 'info' | 'warn' | 'error';

/** Where an entry came from — drives filtering and the source badge in the UI. */
export type LogOrigin =
  'console' | 'exception' | 'unhandledrejection' | 'resource-error' | 'csp-violation' | 'user';

export interface CallFrame {
  functionName: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}

export interface LogEntry {
  id: string;
  level: LogLevel;
  origin: LogOrigin;
  /** Epoch milliseconds. */
  timestamp: number;
  /** Mirrored console arguments, in call order. */
  args: RemoteObject[];
  /**
   * Flattened plain-text rendering, computed once at ingest.
   * Search, filtering and copy all operate on this so they never touch live objects.
   */
  text: string;
  /** Result of `%c`/`%s`/`%d`/`%o` formatting, when the first argument was a format string. */
  styledParts?: StyledPart[];
  /** Repeat counter for consecutive identical entries, DevTools-style. */
  repeatCount: number;
  stackTrace?: CallFrame[];
  /** `console.group` nesting depth at the time of the call. */
  groupDepth: number;
  /** Set on the entry that opens a group. */
  groupStart?: { collapsed: boolean; label: string };
  /** User-defined channel from `optik.channel('x').log(...)`. */
  channel?: string;
}

/** A run of text carrying CSS from a `%c` directive. */
export interface StyledPart {
  text: string;
  /** Sanitised CSS declarations; layout/positioning properties are stripped. */
  css?: string;
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

export type RequestInitiator =
  'xhr' | 'fetch' | 'beacon' | 'websocket' | 'resource' | 'eventsource';

export type NetworkPhase = 'pending' | 'loading' | 'complete' | 'failed' | 'aborted';

export interface NetworkTiming {
  /** `performance.now()` at send. */
  startTime: number;
  /** First byte of the response. */
  responseStart?: number;
  endTime?: number;
  /** Milliseconds, computed on completion. */
  duration?: number;
  /** From Resource Timing when available — the numbers DevTools shows in its waterfall. */
  dns?: number;
  tcp?: number;
  tls?: number;
  ttfb?: number;
  download?: number;
}

export interface NetworkBody {
  /** Decoded text when the payload is textual. */
  text?: string;
  /** MIME from `Content-Type`, without parameters. */
  mimeType?: string;
  /** Byte length when known. */
  size?: number;
  /** True when the body was omitted (too large, binary, or streaming). */
  omitted?: boolean;
  omittedReason?: 'too-large' | 'binary' | 'streaming' | 'unavailable' | 'opaque';
  /** Parsed form of `text` for JSON bodies, mirrored lazily like a console argument. */
  parsed?: RemoteObject;
}

export interface NetworkRecord {
  id: string;
  initiator: RequestInitiator;
  method: string;
  url: string;
  /** Split out so the UI can show a compact name and a full URL on demand. */
  name: string;
  origin: string;
  query: [string, string][];
  requestHeaders: [string, string][];
  requestBody?: NetworkBody;
  status?: number;
  statusText?: string;
  responseHeaders: [string, string][];
  responseBody?: NetworkBody;
  responseType?: string;
  phase: NetworkPhase;
  timing: NetworkTiming;
  /** True when the response was served from cache (Resource Timing `transferSize === 0`). */
  fromCache?: boolean;
  error?: string;
  /** WebSocket frames, newest last. */
  frames?: WebSocketFrame[];
}

export interface WebSocketFrame {
  direction: 'send' | 'receive';
  timestamp: number;
  opcode: 'text' | 'binary' | 'close';
  payload: string;
  size: number;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export type StorageArea = 'localStorage' | 'sessionStorage' | 'cookie' | 'indexedDB';

export interface StorageItem {
  key: string;
  value: string;
  size: number;
  /** Cookie-only metadata. */
  domain?: string;
  path?: string;
  expires?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

export interface SystemInfo {
  userAgent: string;
  platform: string;
  language: string;
  /** Derived, human-readable client description. */
  client: string;
  viewport: { width: number; height: number; dpr: number };
  screen: { width: number; height: number };
  /** `env(safe-area-inset-*)` resolved at runtime — critical for notched iOS layout. */
  safeArea: { top: number; right: number; bottom: number; left: number };
  network?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean };
  memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
  /** Page-load milestones from Navigation Timing. */
  timing: Record<string, number>;
  /** Feature-detection results the UI uses to explain degraded behaviour. */
  capabilities: Record<string, boolean>;
}
