import { describe, expect, it } from 'vitest';
import { captureStack, parseStack } from './stack';

describe('stack parsing', () => {
  it('parses Chrome, Firefox, and anonymous frames', () => {
    expect(
      parseStack(
        [
          'Error: boom',
          '    at named (https://example.test/app.js:10:4)',
          'anonymous@https://example.test/firefox.js:20:8',
          '    at https://example.test/plain.js:30:2',
        ].join('\n'),
      ),
    ).toEqual([
      {
        functionName: 'named',
        url: 'https://example.test/app.js',
        lineNumber: 10,
        columnNumber: 4,
      },
      {
        functionName: 'anonymous',
        url: 'https://example.test/firefox.js',
        lineNumber: 20,
        columnNumber: 8,
      },
      {
        functionName: '(anonymous)',
        url: 'https://example.test/plain.js',
        lineNumber: 30,
        columnNumber: 2,
      },
    ]);
  });

  it('skips malformed lines and the requested leading frames', () => {
    const frames = parseStack(
      [
        'Error',
        '    at captureStack (https://example.test/optik.js:1:1)',
        '    at instrumentConsole (https://example.test/optik.js:2:1)',
        'not a frame',
        '    at app (https://example.test/app.js:3:2)',
      ].join('\n'),
      2,
    );
    expect(frames).toEqual([
      {
        functionName: 'app',
        url: 'https://example.test/app.js',
        lineNumber: 3,
        columnNumber: 2,
      },
    ]);
  });

  it('captures a bounded live stack without throwing', () => {
    const frames = captureStack(2);
    expect(frames === undefined || frames.length <= 2).toBe(true);
  });
});
