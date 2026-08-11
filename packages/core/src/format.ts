/**
 * Console format-string handling (`%s %d %i %f %o %O %c %j %%`) and plain-text flattening.
 *
 * Two jobs:
 *  - `formatStyledParts`: honour `%c` CSS runs so `console.log('%cHi', 'color:red')`
 *    renders in colour, as it does in a real console.
 *  - `flattenToText`: produce the searchable/copyable plain text for an entry. This runs
 *    once at ingest; search and copy never re-walk live objects afterwards.
 */

import type { StyledPart } from './types';
import type { RemoteObject } from './remote-object';

/**
 * CSS allowlist for `%c`. A logged style string is attacker-controlled in the sense
 * that it comes from arbitrary page code, and the console renders inside our Shadow
 * DOM — letting `position`/`content`/`z-index` through would let a log line escape its
 * row and cover the UI. Colour and text decoration are safe and are what people use.
 */
const ALLOWED_CSS_PROPERTIES = new Set([
  'color',
  'background',
  'background-color',
  'background-image',
  'font-weight',
  'font-style',
  'font-size',
  'font-family',
  'text-decoration',
  'text-transform',
  'text-shadow',
  'letter-spacing',
  'word-spacing',
  'line-height',
  'border',
  'border-radius',
  'padding',
  'margin',
  'opacity',
]);

export function sanitizeCss(css: string): string {
  const out: string[] = [];
  for (const declaration of css.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon === -1) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    if (!ALLOWED_CSS_PROPERTIES.has(property)) continue;
    // `url()` can fire a network request from a log line; `expression()` is legacy IE script.
    if (/url\s*\(|expression\s*\(|javascript:/i.test(value)) continue;
    out.push(`${property}:${value}`);
  }
  return out.join(';');
}

/** True when `text` contains at least one directive we should act on. */
export function hasFormatSpecifier(text: string): boolean {
  // Match a real specifier, not `100%` or a trailing `%`. `%%` is an escape and is
  // handled during substitution rather than treated as a directive here.
  return /%[sdifoOcj]/.test(text);
}

interface FormatResult {
  parts: StyledPart[];
  /** Arguments consumed by directives; the caller appends the rest. */
  consumed: number;
}

/**
 * Applies a format string against `args`, producing styled runs.
 * `describe` renders a non-string argument (we pass the RemoteObject description).
 */
export function formatStyledParts(
  template: string,
  args: unknown[],
  describe: (value: unknown) => string,
): FormatResult {
  const parts: StyledPart[] = [];
  let buffer = '';
  let currentCss: string | undefined;
  let argIndex = 0;

  const flush = () => {
    if (buffer) {
      parts.push(currentCss ? { text: buffer, css: currentCss } : { text: buffer });
      buffer = '';
    }
  };

  for (let i = 0; i < template.length; i++) {
    const char = template[i];
    if (char !== '%') {
      buffer += char;
      continue;
    }

    const directive = template[i + 1];
    if (directive === undefined) {
      buffer += '%';
      continue;
    }
    if (directive === '%') {
      buffer += '%';
      i++;
      continue;
    }
    if (!'sdifoOcj'.includes(directive)) {
      buffer += char;
      continue;
    }
    // Out of arguments: leave the directive as literal text, matching browser behaviour.
    if (argIndex >= args.length) {
      buffer += char;
      continue;
    }

    i++; // consume the directive character
    const arg = args[argIndex++];

    switch (directive) {
      case 'c':
        flush();
        currentCss = typeof arg === 'string' ? sanitizeCss(arg) : undefined;
        break;
      case 's':
        buffer += typeof arg === 'string' ? arg : describe(arg);
        break;
      case 'd':
      case 'i': {
        const n = Number(arg);
        buffer += Number.isNaN(n) ? 'NaN' : String(Math.trunc(n));
        break;
      }
      case 'f': {
        const n = Number(arg);
        buffer += Number.isNaN(n) ? 'NaN' : String(n);
        break;
      }
      case 'j':
        try {
          buffer += JSON.stringify(arg);
        } catch {
          buffer += describe(arg);
        }
        break;
      case 'o':
      case 'O':
        buffer += describe(arg);
        break;
    }
  }

  flush();
  return { parts, consumed: argIndex };
}

/** Plain-text rendering of a mirrored argument, used for search and clipboard. */
export function remoteObjectToText(remote: RemoteObject, depth = 0): string {
  if (remote.type === 'string')
    return depth === 0 ? String(remote.value ?? '') : JSON.stringify(remote.value);
  if (remote.unserializableValue !== undefined) return remote.unserializableValue;
  if (remote.type !== 'object' && remote.type !== 'function') return remote.description;
  if (remote.subtype === 'null') return 'null';

  const preview = remote.preview;
  if (!preview) return remote.description;

  if (preview.entries) {
    const body = preview.entries
      .map((entry) =>
        entry.key
          ? `${previewToText(entry.key, depth + 1)} => ${previewToText(entry.value, depth + 1)}`
          : previewToText(entry.value, depth + 1),
      )
      .join(', ');
    return `${remote.description} {${body}${preview.overflow ? ', …' : ''}}`;
  }

  if (preview.properties.length === 0) return remote.description;

  const isArray = remote.subtype === 'array' || remote.subtype === 'typedarray';
  const body = preview.properties
    .map((property) =>
      isArray
        ? property.valuePreview
          ? previewToText(property.valuePreview, depth + 1)
          : (property.value ?? '')
        : `${property.name}: ${property.valuePreview ? previewToText(property.valuePreview, depth + 1) : (property.value ?? '')}`,
    )
    .join(', ');

  const overflow = preview.overflow ? ', …' : '';
  return isArray ? `[${body}${overflow}]` : `${remote.description} {${body}${overflow}}`;
}

function previewToText(preview: { description: string }, _depth: number): string {
  return preview.description;
}

/** Joins mirrored arguments the way a console would: space-separated. */
export function flattenToText(args: RemoteObject[]): string {
  return args.map((arg) => remoteObjectToText(arg, 0)).join(' ');
}
