/**
 * Shared request/response body handling for the network instrumentors.
 *
 * The rule everywhere: **never let inspection change the app's behaviour, and never let
 * a big payload cost the page memory.** A 50MB video response must show up in the
 * network list with correct timings and headers, and its body must be omitted with a
 * clear reason rather than buffered.
 */

import type { NetworkBody } from '../types';

/** Bodies above this are recorded as metadata only. */
export const DEFAULT_MAX_BODY_BYTES = 512 * 1024;

const TEXTUAL_MIME = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|graphql|ld\+json|problem\+json)|.*\+json$|.*\+xml$)/i;

export function mimeTypeOf(contentType: string | null | undefined): string | undefined {
  if (!contentType) return undefined;
  const semicolon = contentType.indexOf(';');
  return (semicolon === -1 ? contentType : contentType.slice(0, semicolon)).trim().toLowerCase();
}

export function isTextualMime(mime: string | undefined): boolean {
  if (!mime) return false;
  return TEXTUAL_MIME.test(mime);
}

/** Approximate UTF-8 byte length without allocating an encoder for every call. */
export function byteLengthOf(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4; // surrogate pair
      i++;
    } else bytes += 3;
  }
  return bytes;
}

export function parseHeaderString(raw: string): [string, string][] {
  const out: [string, string][] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    out.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return out;
}

export function headersToEntries(headers: HeadersInit | Headers | undefined): [string, string][] {
  if (!headers) return [];
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return [...headers.entries()];
  }
  if (Array.isArray(headers)) return headers.map(([k, v]) => [String(k), String(v)]);
  return Object.entries(headers as Record<string, string>).map(([k, v]) => [k, String(v)]);
}

/**
 * Turns a request body init into a recordable body without consuming streams.
 * `ReadableStream` and `Blob` are deliberately *not* read: doing so would either
 * consume the app's stream or force a large async read on the request path.
 */
export function describeRequestBody(
  body: BodyInit | null | undefined,
  contentType: string | undefined,
  maxBytes = DEFAULT_MAX_BODY_BYTES,
): NetworkBody | undefined {
  if (body === null || body === undefined) return undefined;

  const mime = mimeTypeOf(contentType);

  if (typeof body === 'string') {
    return truncateText(body, mime, maxBytes);
  }
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return truncateText(body.toString(), mime ?? 'application/x-www-form-urlencoded', maxBytes);
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    // Serialising FormData is safe (it is not a stream) and is what people actually
    // need to see when debugging an upload.
    const parts: string[] = [];
    try {
      for (const [key, value] of body.entries()) {
        parts.push(
          typeof value === 'string'
            ? `${key}=${value}`
            : `${key}=(File ${value.name}, ${value.size} bytes, ${value.type || 'unknown'})`,
        );
      }
    } catch {
      return { mimeType: 'multipart/form-data', omitted: true, omittedReason: 'unavailable' };
    }
    return truncateText(parts.join('\n'), 'multipart/form-data', maxBytes);
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return {
      mimeType: body.type || mime,
      size: body.size,
      omitted: true,
      omittedReason: 'binary',
    };
  }
  if (ArrayBuffer.isView(body) || body instanceof ArrayBuffer) {
    const size = body instanceof ArrayBuffer ? body.byteLength : body.byteLength;
    return { mimeType: mime, size, omitted: true, omittedReason: 'binary' };
  }

  // ReadableStream and anything exotic.
  return { mimeType: mime, omitted: true, omittedReason: 'streaming' };
}

export function truncateText(
  text: string,
  mime: string | undefined,
  maxBytes = DEFAULT_MAX_BODY_BYTES,
): NetworkBody {
  const size = byteLengthOf(text);
  if (size <= maxBytes) return { text, mimeType: mime, size };
  return {
    // Keep a usable head so the shape of the payload is still visible.
    text: text.slice(0, Math.floor(maxBytes / 2)),
    mimeType: mime,
    size,
    omitted: true,
    omittedReason: 'too-large',
  };
}

export function splitUrl(rawUrl: string): { url: string; name: string; origin: string; query: [string, string][] } {
  let parsed: URL | undefined;
  try {
    parsed = new URL(rawUrl, globalThis.location?.href);
  } catch {
    // Non-absolute, non-resolvable (data:, blob:, or a malformed string).
  }

  if (!parsed) {
    return { url: rawUrl, name: rawUrl.slice(0, 120), origin: '', query: [] };
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  const name = last ?? parsed.hostname;

  return {
    url: parsed.href,
    name,
    origin: parsed.origin,
    query: [...parsed.searchParams.entries()],
  };
}
