import { describe, expect, it } from 'vitest';
import {
  byteLengthOf,
  describeRequestBody,
  headersToEntries,
  isTextualMime,
  mimeTypeOf,
  parseHeaderString,
  splitUrl,
  truncateText,
} from './body';

describe('network body helpers', () => {
  it.each(['ascii', '中文', '😀', '\ud800x', 'x\udc00', '\ud800\u0800'])(
    'matches UTF-8 encoding for %j',
    (text) => {
      expect(byteLengthOf(text)).toBe(new TextEncoder().encode(text).byteLength);
    },
  );

  it('normalizes MIME types and detects textual formats', () => {
    expect(mimeTypeOf(' Application/Problem+JSON; Charset=UTF-8 ')).toBe(
      'application/problem+json',
    );
    expect(isTextualMime('application/vnd.api+json')).toBe(true);
    expect(isTextualMime('image/png')).toBe(false);
  });

  it('parses header strings and HeadersInit forms', () => {
    expect(parseHeaderString('X-One: 1\r\nInvalid\r\nX-Two: value:with:colons\r\n')).toEqual([
      ['X-One', '1'],
      ['X-Two', 'value:with:colons'],
    ]);
    expect(headersToEntries({ Accept: 'application/json' })).toEqual([
      ['Accept', 'application/json'],
    ]);
    expect(headersToEntries([['X-Test', 'yes']])).toEqual([['X-Test', 'yes']]);
  });

  it('describes safe request body types without consuming streams', () => {
    expect(describeRequestBody('hello', 'text/plain', 10)).toEqual({
      text: 'hello',
      mimeType: 'text/plain',
      size: 5,
    });
    expect(describeRequestBody(new URLSearchParams({ a: '1' }), undefined, 10)).toEqual({
      text: 'a=1',
      mimeType: 'application/x-www-form-urlencoded',
      size: 3,
    });
    expect(describeRequestBody(new Uint8Array(4), 'application/octet-stream')).toMatchObject({
      size: 4,
      omitted: true,
      omittedReason: 'binary',
    });
  });

  it('retains a UTF-8-bounded prefix for oversized text', () => {
    const result = truncateText('中文中文', 'text/plain', 4);
    expect(result.omittedReason).toBe('too-large');
    expect(result.text).toBeTruthy();
    expect(byteLengthOf(result.text ?? '')).toBeLessThanOrEqual(4);
    expect(result.size).toBe(12);
  });

  it('splits absolute, relative, and malformed URLs', () => {
    expect(splitUrl('https://example.test/path/file.json?a=1&a=2')).toMatchObject({
      name: 'file.json',
      origin: 'https://example.test',
      query: [
        ['a', '1'],
        ['a', '2'],
      ],
    });
    expect(splitUrl('http://[invalid')).toEqual({
      url: 'http://[invalid',
      name: 'http://[invalid',
      origin: '',
      query: [],
    });
  });
});
