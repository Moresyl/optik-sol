import { afterEach, describe, expect, it, vi } from 'vitest';
import { instrumentErrors, type ErrorRecord } from './errors';

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function listen(options: Parameters<typeof instrumentErrors>[1] = {}) {
  const records: ErrorRecord[] = [];
  const instrumentation = instrumentErrors((record) => records.push(record), options);
  disposers.push(() => instrumentation.dispose());
  return records;
}

describe('instrumentErrors', () => {
  it('captures uncaught exceptions with parsed stack frames', () => {
    const records = listen({
      captureRejections: false,
      captureResourceErrors: false,
      captureCspViolations: false,
    });
    const error = new Error('boom');
    error.stack = 'Error: boom\n    at run (https://example.test/app.js:10:4)';
    globalThis.dispatchEvent(
      new ErrorEvent('error', {
        message: error.message,
        filename: 'https://example.test/app.js',
        lineno: 10,
        colno: 4,
        error,
      }),
    );

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: 'error',
      origin: 'exception',
      args: [error],
      stackTrace: [
        {
          functionName: 'run',
          url: 'https://example.test/app.js',
          lineNumber: 10,
          columnNumber: 4,
        },
      ],
    });
  });

  it('falls back to ErrorEvent location when no Error object exists', () => {
    const records = listen({
      captureRejections: false,
      captureResourceErrors: false,
      captureCspViolations: false,
    });
    globalThis.dispatchEvent(
      new ErrorEvent('error', {
        message: 'script failed',
        filename: 'https://example.test/legacy.js',
        lineno: 7,
        colno: 2,
      }),
    );
    expect(records[0]).toMatchObject({
      args: ['script failed'],
      stackTrace: [
        {
          functionName: '(anonymous)',
          url: 'https://example.test/legacy.js',
          lineNumber: 7,
          columnNumber: 2,
        },
      ],
    });
  });

  it('captures failed resource elements in the capture phase', () => {
    const records = listen({
      captureExceptions: false,
      captureRejections: false,
      captureCspViolations: false,
    });
    const image = document.createElement('img');
    image.src = 'https://cdn.test/missing.png';
    document.body.appendChild(image);
    image.dispatchEvent(new Event('error', { bubbles: false }));
    image.remove();

    expect(records[0]).toMatchObject({
      level: 'error',
      origin: 'resource-error',
      args: ['Failed to load img: https://cdn.test/missing.png', image],
    });
  });

  it('captures unhandled rejections and CSP violations', () => {
    const records = listen({ captureExceptions: false, captureResourceErrors: false });
    const reason = new Error('async failed');
    const rejection = new Event('unhandledrejection');
    Object.defineProperty(rejection, 'reason', { value: reason });
    globalThis.dispatchEvent(rejection);

    const violation = new Event('securitypolicyviolation');
    Object.assign(violation, {
      violatedDirective: 'script-src',
      blockedURI: 'https://evil.test/script.js',
      originalPolicy: "script-src 'self'",
      sourceFile: 'https://example.test',
      lineNumber: 1,
    });
    globalThis.dispatchEvent(violation);

    expect(records[0]).toMatchObject({
      origin: 'unhandledrejection',
      args: ['Uncaught (in promise)', reason],
    });
    expect(records[1]).toMatchObject({
      origin: 'csp-violation',
      args: [
        'CSP violation: script-src',
        expect.objectContaining({ blockedURI: 'https://evil.test/script.js' }),
      ],
    });
  });

  it('never lets a broken sink cascade and removes listeners on dispose', () => {
    const sink = vi.fn(() => {
      throw new Error('sink failed');
    });
    const instrumentation = instrumentErrors(sink, {
      captureRejections: false,
      captureResourceErrors: false,
      captureCspViolations: false,
    });
    expect(() => globalThis.dispatchEvent(new ErrorEvent('error', { message: 'first' }))).not.toThrow();
    instrumentation.dispose();
    globalThis.dispatchEvent(new ErrorEvent('error', { message: 'second' }));
    expect(sink).toHaveBeenCalledOnce();
  });
});
