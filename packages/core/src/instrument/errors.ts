/**
 * Global error capture: uncaught exceptions, unhandled rejections, failed subresources
 * and CSP violations.
 *
 * We use `addEventListener` rather than assigning `window.onerror`, so we coexist with
 * Sentry and every other reporter instead of clobbering them. Resource errors are
 * caught in the *capture* phase because `error` events from `<img>`/`<script>` do not
 * bubble — the single most-missed class of mobile bug (a CDN asset 404ing on 4G).
 */

import type { CallFrame, LogLevel, LogOrigin } from '../types';
import { parseStack } from './stack';

export interface ErrorRecord {
  level: LogLevel;
  origin: LogOrigin;
  args: unknown[];
  stackTrace?: CallFrame[];
}

export interface ErrorSink {
  (record: ErrorRecord): void;
}

export interface ErrorInstrumentOptions {
  captureExceptions?: boolean;
  captureRejections?: boolean;
  captureResourceErrors?: boolean;
  captureCspViolations?: boolean;
}

export interface ErrorInstrumentation {
  dispose(): void;
}

export function instrumentErrors(
  sink: ErrorSink,
  options: ErrorInstrumentOptions = {},
): ErrorInstrumentation {
  const {
    captureExceptions = true,
    captureRejections = true,
    captureResourceErrors = true,
    captureCspViolations = true,
  } = options;

  const teardown: Array<() => void> = [];

  const safeEmit = (record: ErrorRecord) => {
    try {
      sink(record);
    } catch {
      // An error in the error handler must not cascade.
    }
  };

  if (captureExceptions || captureResourceErrors) {
    const onError = (event: Event) => {
      const errorEvent = event as ErrorEvent;

      // A resource error is an `error` event whose target is an element, not the window.
      const target = event.target;
      const isResourceError =
        target !== null && target !== globalThis.window && (target as Node).nodeType === 1;

      if (isResourceError) {
        if (!captureResourceErrors) return;
        const element = target as Element;
        const url =
          element.getAttribute('src') ||
          element.getAttribute('href') ||
          element.getAttribute('data-src') ||
          '(unknown)';
        safeEmit({
          level: 'error',
          origin: 'resource-error',
          args: [`Failed to load ${element.tagName.toLowerCase()}: ${url}`, element],
        });
        return;
      }

      if (!captureExceptions) return;

      const error = errorEvent.error;
      const stackTrace =
        error instanceof Error && typeof error.stack === 'string'
          ? parseStack(error.stack)
          : errorEvent.filename
            ? [
                {
                  functionName: '(anonymous)',
                  url: errorEvent.filename,
                  lineNumber: errorEvent.lineno ?? 0,
                  columnNumber: errorEvent.colno ?? 0,
                },
              ]
            : undefined;

      safeEmit({
        level: 'error',
        origin: 'exception',
        // Prefer the Error object: it mirrors with a full stack and expandable props.
        args: [error ?? errorEvent.message ?? 'Unknown error'],
        stackTrace,
      });
    };

    // `true` = capture phase, required to see non-bubbling resource errors.
    globalThis.addEventListener('error', onError, true);
    teardown.push(() => globalThis.removeEventListener('error', onError, true));
  }

  if (captureRejections) {
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const stackTrace =
        reason instanceof Error && typeof reason.stack === 'string'
          ? parseStack(reason.stack)
          : undefined;
      safeEmit({
        level: 'error',
        origin: 'unhandledrejection',
        args: ['Uncaught (in promise)', reason],
        stackTrace,
      });
    };
    globalThis.addEventListener('unhandledrejection', onRejection as EventListener);
    teardown.push(() =>
      globalThis.removeEventListener('unhandledrejection', onRejection as EventListener),
    );
  }

  if (captureCspViolations) {
    const onViolation = (event: SecurityPolicyViolationEvent) => {
      safeEmit({
        level: 'error',
        origin: 'csp-violation',
        args: [
          `CSP violation: ${event.violatedDirective}`,
          {
            blockedURI: event.blockedURI,
            violatedDirective: event.violatedDirective,
            originalPolicy: event.originalPolicy,
            sourceFile: event.sourceFile,
            lineNumber: event.lineNumber,
          },
        ],
      });
    };
    globalThis.addEventListener('securitypolicyviolation', onViolation as EventListener);
    teardown.push(() =>
      globalThis.removeEventListener('securitypolicyviolation', onViolation as EventListener),
    );
  }

  return {
    dispose() {
      for (const fn of teardown) {
        try {
          fn();
        } catch {
          // Best effort.
        }
      }
      teardown.length = 0;
    },
  };
}
