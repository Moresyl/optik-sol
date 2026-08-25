/**
 * HAR 1.2 export for moving a mobile capture into desktop tooling.
 *
 * Network captures routinely contain credentials. Export is therefore redacted by
 * default: sensitive headers, query parameters, JSON fields and form fields keep their
 * shape but replace values with a stable marker. Raw export requires an explicit opt-out.
 */

import { byteLengthOf } from './instrument/body';
import type { NetworkBody, NetworkRecord, WebSocketFrame } from './types';

export interface HarExportOptions {
  /** Redact credentials and session identifiers. Default true. */
  redactSensitive?: boolean;
  /** Include retained textual request/response bodies. Default false. */
  includeBodies?: boolean;
  /** Include Optik's non-standard WebSocket/SSE frame metadata. Default false. */
  includeWebSocketFrames?: boolean;
  /** Epoch corresponding to performance time zero. Useful for deterministic tests. */
  timeOrigin?: number;
  creatorName?: string;
  creatorVersion?: string;
}

export interface HarArchive {
  log: {
    version: '1.2';
    creator: { name: string; version: string };
    entries: HarEntry[];
  };
}

export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: HarRequest;
  response: HarResponse;
  cache: { _optikFromCache?: true };
  timings: HarTimings;
  _optik: {
    id: string;
    initiator: NetworkRecord['initiator'];
    phase: NetworkRecord['phase'];
    fromCache: boolean;
    frames: WebSocketFrame[];
    omittedFrameCount?: number;
  };
}

export interface HarNameValue {
  name: string;
  value: string;
}

export interface HarPostData {
  mimeType: string;
  text: string;
}

export interface HarRequest {
  method: string;
  url: string;
  httpVersion: string;
  headers: HarNameValue[];
  queryString: HarNameValue[];
  cookies: HarNameValue[];
  headersSize: number;
  bodySize: number;
  postData?: HarPostData;
}

export interface HarContent {
  size: number;
  mimeType: string;
  text?: string;
  _optikOmittedReason?: string;
}

export interface HarResponse {
  status: number;
  statusText: string;
  httpVersion: string;
  headers: HarNameValue[];
  cookies: HarNameValue[];
  content: HarContent;
  redirectURL: string;
  headersSize: number;
  bodySize: number;
}

export interface HarTimings {
  blocked: number;
  dns: number;
  connect: number;
  ssl: number;
  send: number;
  wait: number;
  receive: number;
}

const REDACTED = '[REDACTED]';
const EXACT_SENSITIVE = new Set([
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'apikey',
  'xapikey',
  'xauthtoken',
  'password',
  'passwd',
  'session',
  'sessionid',
    'jwt',
    'accesstoken',
    'refreshtoken',
    'authorizationcode',
    'credential',
    'signature',
    'xamzcredential',
    'xamzsignature',
    'accesskey',
    'secretkey',
    'privatekey',
  'clientsecret',
  'auth',
  'key',
  'sig',
  'ticket',
  'pwd',
  'passcode',
  'csrf',
  'xsrf',
]);

export function createHar(
  records: readonly NetworkRecord[],
  options: HarExportOptions = {},
): HarArchive {
  const {
    redactSensitive = true,
    includeBodies = false,
    includeWebSocketFrames = false,
    creatorName = 'Optik Sol',
    creatorVersion = '0.2.0',
  } = options;
  const timeOrigin = Number.isFinite(options.timeOrigin) ? options.timeOrigin! : readTimeOrigin();

  return {
    log: {
      version: '1.2',
      creator: { name: creatorName, version: creatorVersion },
      entries: records.map((record) =>
        toEntry(record, { redactSensitive, includeBodies, includeWebSocketFrames, timeOrigin }),
      ),
    },
  };
}

export function serializeHar(
  records: readonly NetworkRecord[],
  options: HarExportOptions = {},
): string {
  return JSON.stringify(createHar(records, options), null, 2);
}

interface ResolvedOptions {
  redactSensitive: boolean;
  includeBodies: boolean;
  includeWebSocketFrames: boolean;
  timeOrigin: number;
}

function toEntry(record: NetworkRecord, options: ResolvedOptions): HarEntry {
  const requestHeaders = toNameValues(record.requestHeaders, options.redactSensitive);
  const responseHeaders = toNameValues(record.responseHeaders, options.redactSensitive);
  const queryString = record.query.map(([name, value]) => ({
    name,
    value: options.redactSensitive && isSensitiveName(name) ? REDACTED : value,
  }));
  const timings = toTimings(record);
  const duration = Math.max(durationOf(record), sumKnownTimings(timings));
  const requestSize = bodySize(record.requestBody);
  const responseSize = bodySize(record.responseBody);

  const request: HarRequest = {
    method: record.method,
    url: options.redactSensitive ? redactUrl(record.url) : record.url,
    httpVersion: '',
    headers: requestHeaders,
    queryString,
    cookies: [],
    headersSize: -1,
    bodySize: requestSize ?? -1,
  };
  const requestPostData = toPostData(record.requestBody, options);
  if (requestPostData) request.postData = requestPostData;

  const content: HarContent = {
    size: responseSize ?? 0,
    mimeType: record.responseBody?.mimeType ?? headerValue(record.responseHeaders, 'content-type') ?? '',
  };
  const responseText = bodyText(record.responseBody, options);
  if (responseText !== undefined) content.text = responseText;
  if (record.responseBody?.omitted) {
    content._optikOmittedReason = record.responseBody.omittedReason ?? 'unavailable';
  }

  const startTime = finiteNonNegative(record.timing.startTime) ?? 0;

  return {
    startedDateTime: toIsoDate(options.timeOrigin + startTime),
    time: duration,
    request,
    response: {
      status: record.status ?? 0,
      statusText: record.statusText ?? record.error ?? '',
      httpVersion: '',
      headers: responseHeaders,
      cookies: [],
      content,
      redirectURL: redactMaybe(
        headerValue(record.responseHeaders, 'location') ?? '',
        options.redactSensitive,
      ),
      headersSize: -1,
      bodySize: responseSize ?? -1,
    },
    cache: record.fromCache ? { _optikFromCache: true } : {},
    timings,
    _optik: {
      id: record.id,
      initiator: record.initiator,
      phase: record.phase,
      fromCache: record.fromCache ?? false,
      frames: options.includeWebSocketFrames
        ? redactFrames(record.frames, options.redactSensitive)
        : [],
      ...(options.includeWebSocketFrames || !record.frames?.length
        ? {}
        : { omittedFrameCount: record.frames.length }),
    },
  };
}

function toPostData(
  body: NetworkBody | undefined,
  options: ResolvedOptions,
): HarPostData | undefined {
  const text = bodyText(body, options);
  if (text === undefined) return undefined;
  return { mimeType: body?.mimeType ?? '', text };
}

function bodyText(body: NetworkBody | undefined, options: ResolvedOptions): string | undefined {
  if (!options.includeBodies || body?.text === undefined) return undefined;
  return options.redactSensitive ? redactBody(body.text, body.mimeType) : body.text;
}

function bodySize(body: NetworkBody | undefined): number | undefined {
  if (body?.size !== undefined) return body.size;
  return body?.text !== undefined ? byteLengthOf(body.text) : undefined;
}

function toNameValues(entries: [string, string][], redact: boolean) {
  return entries.map(([name, value]) => ({
    name,
    value: redact ? redactHeaderValue(name, value) : value,
  }));
}

function redactHeaderValue(name: string, value: string): string {
  if (isSensitiveName(name)) return REDACTED;
  const normalized = name.toLowerCase();
  if (normalized === 'location' || normalized === 'content-location' || normalized === 'referer') {
    return redactUrl(value);
  }
  if (normalized === 'refresh') {
    return value.replace(/(\burl\s*=\s*)(["']?)([^"';]+)\2/i, (_match, prefix, quote, url) =>
      `${prefix}${quote}${redactUrl(url.trim())}${quote}`,
    );
  }
  if (normalized === 'link') {
    return value.replace(/<([^>]+)>/g, (_match, url) => `<${redactUrl(url)}>`);
  }
  return value;
}

function redactUrl(raw: string): string {
  try {
    const url = new URL(raw, globalThis.location?.href);
    url.search = redactSearchParams(url.searchParams).toString();
    if (url.username) url.username = REDACTED;
    if (url.password) url.password = REDACTED;
    url.hash = redactHash(url.hash);
    return url.href;
  } catch {
    return redactMalformedUrl(raw);
  }
}

function redactBody(text: string, mimeType: string | undefined): string {
  const normalizedMime = mimeType?.toLowerCase();
  if (normalizedMime?.includes('json') || /^\s*[[{]/.test(text)) {
    try {
      return JSON.stringify(redactJson(JSON.parse(text)));
    } catch {
      // Fall through to form handling or return the original text.
    }
  }
  if (normalizedMime?.startsWith('multipart/form-data')) {
    return text
      .split(/(\r?\n)/)
      .map((line) => {
        const equals = line.indexOf('=');
        if (equals <= 0 || !isSensitiveName(line.slice(0, equals).trim())) return line;
        return `${line.slice(0, equals + 1)}${REDACTED}`;
      })
      .join('');
  }
  if (
    normalizedMime?.startsWith('application/x-www-form-urlencoded') ||
    /^[^=&\s]+=[^&\r\n]*(?:&[^=&\s]+=[^&\r\n]*)*$/.test(text)
  ) {
    return redactSearchParams(new URLSearchParams(text)).toString();
  }
  return text;
}

function redactSearchParams(params: URLSearchParams): URLSearchParams {
  const redacted = new URLSearchParams();
  for (const [name, value] of params) {
    redacted.append(name, isSensitiveName(name) ? REDACTED : value);
  }
  return redacted;
}

function redactMalformedUrl(raw: string): string {
  const question = raw.indexOf('?');
  const hash = raw.indexOf('#', question === -1 ? 0 : question);
  if (question === -1) {
    return hash === -1 ? raw : `${raw.slice(0, hash)}${redactHash(raw.slice(hash))}`;
  }
  const suffix = hash === -1 ? '' : redactHash(raw.slice(hash));
  const query = raw.slice(question + 1, hash === -1 ? undefined : hash);
  try {
    return `${raw.slice(0, question + 1)}${redactSearchParams(new URLSearchParams(query))}${suffix}`;
  } catch {
    return raw;
  }
}

function redactHash(hash: string): string {
  if (hash.length <= 1 || !hash.includes('=')) return hash;
  return `#${redactSearchParams(new URLSearchParams(hash.slice(1)))}`;
}

function redactMaybe(value: string, redact: boolean): string {
  return redact && value ? redactUrl(value) : value;
}

function redactFrames(frames: WebSocketFrame[] | undefined, redact: boolean): WebSocketFrame[] {
  if (!frames) return [];
  if (!redact) return frames.map((frame) => ({ ...frame }));
  return frames.map((frame) =>
    frame.opcode === 'text' ? { ...frame, payload: redactBody(frame.payload, undefined) } : { ...frame },
  );
}

function redactJson(value: unknown, key?: string): unknown {
  if (key && isSensitiveName(key)) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redactJson(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([name, item]) => [
        name,
        redactJson(item, name),
      ]),
    );
  }
  return value;
}

function isSensitiveName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    EXACT_SENSITIVE.has(normalized) ||
    normalized.endsWith('token') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('password')
  );
}

function headerValue(headers: [string, string][], name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers.find(([key]) => key.toLowerCase() === lower)?.[1];
}

function timingValue(value: number | undefined): number {
  return finiteNonNegative(value) ?? -1;
}

function toTimings(record: NetworkRecord): HarTimings {
  const { timing } = record;
  const duration = durationOf(record);
  const dns = timingValue(timing.dns);
  const connect = timingValue(timing.tcp);
  const ssl = timingValue(timing.tls);
  const wait = timingValue(
    timing.ttfb ??
      (timing.dns === undefined &&
      timing.tcp === undefined &&
      timing.responseStart !== undefined
        ? timing.responseStart - timing.startTime
        : undefined),
  );
  const receive = timingValue(
    timing.download ??
      (timing.responseStart !== undefined && timing.endTime !== undefined
        ? timing.endTime - timing.responseStart
        : undefined),
  );
  const known = [dns, connect, wait, receive]
    .filter((value) => value >= 0)
    .reduce((total, value) => total + value, 0);
  const hasKnownPhase = dns >= 0 || connect >= 0 || wait >= 0 || receive >= 0;
  const residual = duration - known;

  return {
    blocked: hasKnownPhase && residual >= -0.01 ? Math.max(0, residual) : -1,
    dns,
    connect,
    ssl,
    send: -1,
    wait,
    receive,
  };
}

function sumKnownTimings(timings: HarTimings): number {
  return [
    timings.blocked,
    timings.dns,
    timings.connect,
    timings.send,
    timings.wait,
    timings.receive,
  ]
    .filter((value) => value >= 0)
    .reduce((total, value) => total + value, 0);
}

function durationOf(record: NetworkRecord): number {
  const { timing } = record;
  return (
    finiteNonNegative(timing.duration) ??
    finiteNonNegative(
      timing.endTime === undefined ? undefined : timing.endTime - timing.startTime,
    ) ??
    0
  );
}

function toIsoDate(epoch: number): string {
  if (!Number.isFinite(epoch) || Math.abs(epoch) > 8.64e15) return new Date(0).toISOString();
  return new Date(epoch).toISOString();
}

function finiteNonNegative(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function readTimeOrigin(): number {
  const origin = globalThis.performance?.timeOrigin;
  if (Number.isFinite(origin)) return origin;
  const now = globalThis.performance?.now?.() ?? 0;
  return Date.now() - now;
}
