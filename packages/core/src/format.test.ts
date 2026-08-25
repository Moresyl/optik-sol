import { describe, expect, it } from 'vitest';
import {
  flattenToText,
  formatStyledParts,
  hasFormatSpecifier,
  remoteObjectToText,
  sanitizeCss,
} from './format';
import type { RemoteObject } from './remote-object';

describe('console formatting', () => {
  it('sanitizes style declarations that could escape a log row', () => {
    expect(
      sanitizeCss(
        'color: red; position: fixed; background-image: url(https://tracker.test/x); font-weight: 700',
      ),
    ).toBe('color:red;font-weight:700');
  });

  it('handles substitutions, escaped percent signs, and styled runs', () => {
    const result = formatStyledParts(
      'value=%d ratio=%f %cstyled%c plain %% %o',
      [3.8, '2.5', 'color:red', 'font-weight:bold', { ok: true }],
      (value) => JSON.stringify(value),
    );

    expect(result.consumed).toBe(5);
    expect(result.parts).toEqual([
      { text: 'value=3 ratio=2.5 ' },
      { text: 'styled', css: 'color:red' },
      { text: ' plain % {"ok":true}', css: 'font-weight:bold' },
    ]);
  });

  it('leaves missing and unknown directives as literal text', () => {
    const result = formatStyledParts('%s %q %d %', ['ok'], String);
    expect(result.parts).toEqual([{ text: 'ok %q %d %' }]);
    expect(hasFormatSpecifier('100% complete')).toBe(false);
    expect(hasFormatSpecifier('%cstyled')).toBe(true);
  });

  it('falls back when JSON formatting sees a cycle', () => {
    const value: { self?: unknown } = {};
    value.self = value;
    const result = formatStyledParts('%j', [value], () => '[cycle]');
    expect(result.parts).toEqual([{ text: '[cycle]' }]);
  });
});

describe('RemoteObject text rendering', () => {
  it('renders primitives, arrays, objects, and entries', () => {
    const string: RemoteObject = { type: 'string', value: 'hello', description: '"hello"' };
    const array: RemoteObject = {
      type: 'object',
      subtype: 'array',
      description: 'Array(2)',
      preview: {
        type: 'object',
        subtype: 'array',
        description: 'Array(2)',
        overflow: false,
        properties: [
          { name: '0', type: 'number', value: '1' },
          { name: '1', type: 'string', value: '"x"' },
        ],
      },
    };
    const map: RemoteObject = {
      type: 'object',
      subtype: 'map',
      description: 'Map(1)',
      preview: {
        type: 'object',
        subtype: 'map',
        description: 'Map(1)',
        overflow: false,
        properties: [],
        entries: [
          {
            key: { type: 'string', description: '"key"', overflow: false, properties: [] },
            value: { type: 'number', description: '1', overflow: false, properties: [] },
          },
        ],
      },
    };

    expect(remoteObjectToText(string)).toBe('hello');
    expect(remoteObjectToText(string, 1)).toBe('"hello"');
    expect(remoteObjectToText(array)).toBe('[1, "x"]');
    expect(remoteObjectToText(map)).toBe('Map(1) {"key" => 1}');
    expect(flattenToText([string, array])).toBe('hello [1, "x"]');
  });
});
