/**
 * Stack capture and parsing.
 *
 * Every log entry gets a call site, which is the single feature people miss most in
 * in-page consoles: you can see *that* something logged, never *where*. We capture a
 * stack at ingest and strip Optik's own frames so the top frame is the caller's code.
 */

import type { CallFrame } from '../types';

/** V8: `    at fnName (url:line:col)`. Spidermonkey/JSC: `fnName@url:line:col`. */
const V8_FRAME = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;
const SPIDERMONKEY_FRAME = /^(.*?)@(.+?):(\d+):(\d+)$/;

export function parseStack(stack: string, skipFrames = 0): CallFrame[] {
  const frames: CallFrame[] = [];
  const lines = stack.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;
    // V8 prefixes the stack with the error message; it has no location to parse.
    if (!line.includes(':')) continue;

    let match = V8_FRAME.exec(line);
    if (match) {
      frames.push({
        functionName: match[1] ?? '(anonymous)',
        url: match[2] ?? '',
        lineNumber: Number(match[3]) || 0,
        columnNumber: Number(match[4]) || 0,
      });
      continue;
    }

    match = SPIDERMONKEY_FRAME.exec(line);
    if (match) {
      frames.push({
        functionName: match[1] || '(anonymous)',
        url: match[2] ?? '',
        lineNumber: Number(match[3]) || 0,
        columnNumber: Number(match[4]) || 0,
      });
    }
  }

  return frames.slice(skipFrames);
}

/** True for frames inside Optik itself, which must never be shown as a call site. */
function isInternalFrame(frame: CallFrame): boolean {
  return /\boptik\b|node_modules[\\/]@optik/.test(frame.url);
}

/**
 * Captures the current stack, dropping Optik's own frames.
 * `maxFrames` keeps memory bounded — a recursive logger can produce very deep stacks.
 */
export function captureStack(maxFrames = 12): CallFrame[] | undefined {
  const holder: { stack?: string } = {};

  // V8 fast path: skips message construction entirely.
  const CaptureStackTrace = (Error as unknown as {
    captureStackTrace?: (target: object, constructor?: Function) => void;
  }).captureStackTrace;

  if (CaptureStackTrace) {
    CaptureStackTrace(holder, captureStack);
  } else {
    holder.stack = new Error().stack;
  }

  if (!holder.stack) return undefined;

  const frames = parseStack(holder.stack);

  // Drop the leading run of internal frames, then keep everything after it. We only
  // trim the *prefix*: an app frame that happens to live in a file named `optik` deeper
  // in the stack should still be shown.
  let start = 0;
  while (start < frames.length && isInternalFrame(frames[start]!)) start++;

  const visible = frames.slice(start, start + maxFrames);
  return visible.length > 0 ? visible : undefined;
}
