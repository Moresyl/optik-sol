import { describe, expect, it } from 'vitest';
import packageMetadata from '../package.json';
import type { NetworkRecord } from './types';
import { createHar, serializeHar } from './har';

function record(overrides: Partial<NetworkRecord> = {}): NetworkRecord {
  return {
    id: 'net:1',
    initiator: 'fetch',
    method: 'POST',
    url: 'https://example.test/api?access_token=url-secret&view=full',
    name: 'api',
    origin: 'https://example.test',
    query: [
      ['access_token', 'url-secret'],
      ['view', 'full'],
    ],
    requestHeaders: [
      ['Authorization', 'Bearer header-secret'],
      ['Content-Type', 'application/json'],
    ],
    requestBody: {
      text: '{"user":"alice","password":"body-secret","nested":{"apiKey":"key-secret"}}',
      mimeType: 'application/json',
    },
    status: 200,
    statusText: 'OK',
    responseHeaders: [
      ['Content-Type', 'application/json'],
      ['Set-Cookie', 'session=reply-secret'],
      ['Location', 'https://redirect.test/callback?authorization_code=redirect-secret'],
    ],
    responseBody: { text: '{"token":"reply-token","ok":true}', mimeType: 'application/json' },
    phase: 'complete',
    timing: {
      startTime: 250,
      duration: 50,
      dns: 2,
      tcp: 4,
      tls: 3,
      ttfb: 30,
      download: 10,
    },
    fromCache: true,
    frames: [
      {
        direction: 'send',
        timestamp: 300,
        opcode: 'text',
        payload: '{"accessToken":"socket-secret","message":"hello"}',
        size: 49,
      },
    ],
    ...overrides,
  };
}

describe('HAR export', () => {
  it('creates a valid HAR 1.2-shaped archive with timing and Optik metadata', () => {
    const archive = createHar([record()], {
      timeOrigin: 1_700_000_000_000,
      includeWebSocketFrames: true,
    });
    const entry = archive.log.entries[0]!;

    expect(archive.log.version).toBe('1.2');
    expect(archive.log.creator).toEqual({ name: 'Optik Sol', version: packageMetadata.version });
    expect(entry.startedDateTime).toBe(new Date(1_700_000_000_250).toISOString());
    expect(entry.time).toBe(50);
    expect(entry.timings).toEqual({
      blocked: 4,
      dns: 2,
      connect: 4,
      ssl: 3,
      send: -1,
      wait: 30,
      receive: 10,
    });
    expect(entry.cache).toEqual({ _optikFromCache: true });
    expect(entry._optik).toMatchObject({ id: 'net:1', initiator: 'fetch', phase: 'complete' });
  });

  it('redacts secrets from every common export surface by default', () => {
    const serialized = serializeHar([record()], {
      timeOrigin: 0,
      includeBodies: true,
      includeWebSocketFrames: true,
    });
    const archive = JSON.parse(serialized) as ReturnType<typeof createHar>;
    const entry = archive.log.entries[0]!;

    expect(serialized).not.toContain('url-secret');
    expect(serialized).not.toContain('header-secret');
    expect(serialized).not.toContain('body-secret');
    expect(serialized).not.toContain('key-secret');
    expect(serialized).not.toContain('reply-secret');
    expect(serialized).not.toContain('reply-token');
    expect(serialized).not.toContain('redirect-secret');
    expect(serialized).not.toContain('socket-secret');
    expect(entry.request['url']).toContain('access_token=%5BREDACTED%5D');
    expect(entry.request['queryString']).toContainEqual({
      name: 'access_token',
      value: '[REDACTED]',
    });
    expect(entry.request['headers']).toContainEqual({
      name: 'Authorization',
      value: '[REDACTED]',
    });
  });

  it('supports an explicit raw export and optional body omission', () => {
    const raw = serializeHar([record()], {
      redactSensitive: false,
      includeBodies: true,
      includeWebSocketFrames: true,
      timeOrigin: 0,
    });
    expect(raw).toContain('header-secret');
    expect(raw).toContain('body-secret');

    const bodyless = createHar([record()], { includeBodies: false, timeOrigin: 0 });
    const entry = bodyless.log.entries[0]!;
    expect(entry.request['postData']).toBeUndefined();
    expect(entry.response.content.text).toBeUndefined();
    expect(entry.request['bodySize']).toBeGreaterThan(0);
  });

  it('redacts form fields and preserves omitted-body metadata', () => {
    const archive = createHar(
      [
        record({
          requestBody: {
            text: 'username=alice&password=secret',
            mimeType: 'application/x-www-form-urlencoded',
          },
          responseBody: { size: 2_000_000, omitted: true, omittedReason: 'too-large' },
        }),
      ],
      { timeOrigin: 0, includeBodies: true },
    );
    const entry = archive.log.entries[0]!;
    expect((entry.request['postData'] as { text: string }).text).toBe(
      'username=alice&password=%5BREDACTED%5D',
    );
    expect(entry.response['bodySize']).toBe(2_000_000);
    expect(entry.response['content']).toMatchObject({
      size: 2_000_000,
      _optikOmittedReason: 'too-large',
    });
  });

  it('redacts URL credentials, duplicate parameters, hash tokens, and multipart fields', () => {
    const entry = createHar(
      [
        record({
          url: 'https://alice:pass@example.test/?api_key=one&api_key=two#access_token=fragment',
          query: [
            ['api_key', 'one'],
            ['api_key', 'two'],
          ],
          requestBody: {
            text: 'username=alice\npassword=multipart-secret\nfile=(File image.png, 3 bytes, image/png)',
            mimeType: 'multipart/form-data',
          },
        }),
      ],
      { timeOrigin: 0, includeBodies: true },
    ).log.entries[0]!;
    const url = String(entry.request['url']);
    const postData = entry.request['postData'] as { text: string };

    expect(url).not.toContain('alice');
    expect(url).not.toContain('pass');
    expect(url.match(/api_key=/g)).toHaveLength(2);
    expect(url).toContain('access_token=%5BREDACTED%5D');
    expect(postData.text).toContain('username=alice');
    expect(postData.text).toContain('password=[REDACTED]');
    expect(postData.text).not.toContain('multipart-secret');
  });

  it('redacts real multipart fields by Content-Disposition name while preserving safe parts', () => {
    const boundary = '----optik-test-boundary';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="username"',
      '',
      'alice',
      `--${boundary}`,
      'Content-Disposition: form-data; name="password_confirmation"',
      '',
      'multipart-password',
      `--${boundary}`,
      'Content-Disposition: form-data; name="client_secret_expires_at"',
      'Content-Type: text/plain',
      '',
      'multipart-client-secret',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const serialized = serializeHar(
      [
        record({
          requestBody: {
            text: body,
            mimeType: `multipart/form-data; boundary="${boundary}"`,
          },
        }),
      ],
      { timeOrigin: 0, includeBodies: true },
    );

    expect(serialized).toContain('alice');
    expect(serialized).not.toContain('multipart-password');
    expect(serialized).not.toContain('multipart-client-secret');
    expect(serialized.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('redacts hash credentials even when a malformed URL cannot be parsed', () => {
    const serialized = serializeHar(
      [record({ url: 'http://[invalid]#access_token=fragment-secret', query: [] })],
      { timeOrigin: 0 },
    );
    expect(serialized).not.toContain('fragment-secret');
    expect(serialized).toContain('access_token=%5BREDACTED%5D');
  });

  it('falls back to safe finite timestamps for invalid timing input', () => {
    const entry = createHar([record({ timing: { startTime: Number.NaN } })], {
      timeOrigin: Number.NaN,
    }).log.entries[0]!;
    expect(() => new Date(entry.startedDateTime)).not.toThrow();
    expect(Number.isNaN(Date.parse(entry.startedDateTime))).toBe(false);

    const overflow = createHar([record()], { timeOrigin: Number.MAX_VALUE }).log.entries[0]!;
    expect(overflow.startedDateTime).toBe('1970-01-01T00:00:00.000Z');
  });

  it('omits bodies and frame payloads by default while retaining their metadata', () => {
    const entry = createHar([record()], { timeOrigin: 0 }).log.entries[0]!;
    expect(entry.request.postData).toBeUndefined();
    expect(entry.response.content.text).toBeUndefined();
    expect(entry._optik.frames).toEqual([]);
    expect(entry._optik.omittedFrameCount).toBe(1);
    expect(entry.request.bodySize).toBeGreaterThan(0);
  });

  it('derives duration and basic fetch phases when only monotonic marks are available', () => {
    const entry = createHar(
      [
        record({
          timing: { startTime: 10, responseStart: 40, endTime: 60 },
        }),
      ],
      { timeOrigin: 0 },
    ).log.entries[0]!;
    expect(entry.time).toBe(50);
    expect(entry.timings).toMatchObject({ blocked: 0, wait: 30, receive: 20 });
  });

  it('never reports an entry time below inconsistent known phases', () => {
    const entry = createHar(
      [record({ timing: { startTime: 0, duration: 5, ttfb: 10, download: 4 } })],
      { timeOrigin: 0 },
    ).log.entries[0]!;
    expect(entry.time).toBe(14);
    expect(entry.timings).toMatchObject({ blocked: -1, wait: 10, receive: 4 });
  });

  it('uses HAR sentinel values when status, size, and detailed timing are unavailable', () => {
    const entry = createHar(
      [
        record({
          status: undefined,
          statusText: undefined,
          requestBody: undefined,
          responseBody: undefined,
          phase: 'pending',
          timing: { startTime: 0 },
        }),
      ],
      { timeOrigin: 0 },
    ).log.entries[0]!;
    expect(entry.time).toBe(0);
    expect(entry.request['bodySize']).toBe(-1);
    expect(entry.response).toMatchObject({ status: 0, bodySize: -1 });
    expect(entry.timings).toMatchObject({ dns: -1, connect: -1, ssl: -1, wait: -1, receive: -1 });
  });
});
