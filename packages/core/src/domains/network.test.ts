import { describe, expect, it, vi } from 'vitest';
import type { NetworkBody, NetworkRecord } from '../types';
import { NetworkDomain } from './network';

function record(id: string, overrides: Partial<NetworkRecord> = {}): NetworkRecord {
  return {
    id,
    initiator: 'fetch',
    method: 'GET',
    url: `https://example.test/${id}`,
    name: id,
    origin: 'https://example.test',
    query: [],
    requestHeaders: [],
    responseHeaders: [],
    phase: 'pending',
    timing: { startTime: 100 },
    ...overrides,
  };
}

describe('NetworkDomain', () => {
  it('starts, indexes, updates, and emits requests', () => {
    const domain = new NetworkDomain();
    const started = vi.fn();
    const updated = vi.fn();
    domain.events.on('requestStarted', started);
    domain.events.on('requestUpdated', updated);
    const item = record('net:1');

    domain.onStart(item);
    domain.onUpdate(item.id, {
      phase: 'complete',
      status: 200,
      timing: { startTime: 100, responseStart: 120, duration: 40 },
    });

    expect(domain.size).toBe(1);
    expect(domain.get(item.id)).toBe(item);
    expect(item).toMatchObject({
      phase: 'complete',
      status: 200,
      timing: { startTime: 100, responseStart: 120, duration: 40 },
    });
    expect(started).toHaveBeenCalledWith(item);
    expect(updated).toHaveBeenCalledWith(item);
  });

  it('merges timing patches instead of losing prior phases', () => {
    const domain = new NetworkDomain();
    const item = record('net:1', { timing: { startTime: 10, responseStart: 20 } });
    domain.onStart(item);
    domain.onUpdate(item.id, { timing: { startTime: 10, dns: 2 } });
    domain.onUpdate(item.id, { timing: { startTime: 10, download: 8, duration: 20 } });

    expect(item.timing).toEqual({
      startTime: 10,
      responseStart: 20,
      dns: 2,
      download: 8,
      duration: 20,
    });
  });

  it('parses complete JSON bodies from MIME type or shape', () => {
    const domain = new NetworkDomain();
    const requestBody: NetworkBody = { text: '{"request":true}', size: 16 };
    const responseBody: NetworkBody = {
      text: '[1,2]',
      size: 5,
      mimeType: 'application/json',
    };
    const item = record('net:1', { requestBody });
    domain.onStart(item);
    domain.onUpdate(item.id, { responseBody });

    expect(requestBody.parsed?.objectId).toBeTruthy();
    expect(responseBody.parsed?.subtype).toBe('array');
    expect(domain.registry.size).toBe(2);
    expect(
      domain
        .getProperties(requestBody.parsed!.objectId!)
        ?.find((property) => property.name === 'request')?.value?.value,
    ).toBe(true);
  });

  it('releases parsed object handles when request or response bodies are replaced', () => {
    const domain = new NetworkDomain();
    const firstRequest: NetworkBody = { text: '{"request":1}', mimeType: 'application/json' };
    const firstResponse: NetworkBody = { text: '{"response":1}', mimeType: 'application/json' };
    const item = record('net:1', { requestBody: firstRequest, responseBody: firstResponse });
    domain.onStart(item);
    const oldIds = [firstRequest.parsed!.objectId!, firstResponse.parsed!.objectId!];

    const nextRequest: NetworkBody = { text: '{"request":2}', mimeType: 'application/json' };
    const nextResponse: NetworkBody = { text: '{"response":2}', mimeType: 'application/json' };
    domain.onUpdate(item.id, { requestBody: nextRequest, responseBody: nextResponse });

    expect(oldIds.every((id) => !domain.registry.has(id))).toBe(true);
    expect(domain.registry.size).toBe(2);
    expect(nextRequest.parsed?.objectId).toBeTruthy();
    expect(nextResponse.parsed?.objectId).toBeTruthy();

    domain.onUpdate(item.id, { requestBody: nextRequest, responseBody: undefined });
    expect(domain.registry.has(nextRequest.parsed!.objectId!)).toBe(true);
    expect(domain.registry.has(nextResponse.parsed!.objectId!)).toBe(false);
  });

  it('keeps record identity stable and merges duplicate starts into one row', () => {
    const domain = new NetworkDomain();
    const item = record('net:1');
    const updated = vi.fn();
    domain.events.on('requestUpdated', updated);
    domain.onStart(item);
    domain.onUpdate(item.id, { id: 'renamed', status: 201 });
    domain.onStart(record('net:1', { phase: 'complete', status: 204 }));

    expect(domain.records()).toHaveLength(1);
    expect(domain.get('net:1')).toBe(item);
    expect(domain.get('renamed')).toBeUndefined();
    expect(item).toMatchObject({ id: 'net:1', phase: 'complete', status: 204 });
    expect(updated).toHaveBeenCalledTimes(2);
  });

  it('does not parse invalid, truncated, or disabled JSON bodies', () => {
    const domain = new NetworkDomain();
    const invalid: NetworkBody = { text: '{bad', mimeType: 'application/json' };
    const truncated: NetworkBody = {
      text: '{"partial":',
      mimeType: 'application/json',
      omitted: true,
      omittedReason: 'too-large',
    };
    domain.onStart(record('net:1', { requestBody: invalid, responseBody: truncated }));
    expect(invalid.parsed).toBeUndefined();
    expect(truncated.parsed).toBeUndefined();

    const disabled = new NetworkDomain({ parseJsonBodies: false });
    const body: NetworkBody = { text: '{}', mimeType: 'application/json' };
    disabled.onStart(record('net:2', { requestBody: body }));
    expect(body.parsed).toBeUndefined();
  });

  it('correlates the closest uncoupled URL and ignores stale or timed records', () => {
    const domain = new NetworkDomain();
    domain.onStart(record('older', { url: 'https://example.test/poll', timing: { startTime: 100 } }));
    domain.onStart(record('near', { url: 'https://example.test/poll', timing: { startTime: 210 } }));
    domain.onStart(
      record('used', {
        url: 'https://example.test/poll',
        timing: { startTime: 205, ttfb: 5 },
      }),
    );

    expect(domain.findByUrl('https://example.test/poll', 200)).toBe('near');
    expect(domain.findByUrl('https://example.test/poll', 1000)).toBeUndefined();
    expect(domain.findByUrl('https://example.test/other', 200)).toBeUndefined();
  });

  it('ignores updates after eviction and releases parsed bodies', () => {
    const domain = new NetworkDomain({ maxRecords: 1 });
    const body: NetworkBody = { text: '{"first":true}', mimeType: 'application/json' };
    domain.onStart(record('first', { responseBody: body }));
    const id = body.parsed!.objectId!;

    domain.onStart(record('second'));
    expect(domain.get('first')).toBeUndefined();
    expect(domain.registry.has(id)).toBe(false);
    expect(() => domain.onUpdate('first', { status: 500 })).not.toThrow();

    domain.clear();
    expect(domain.size).toBe(0);
    expect(domain.registry.size).toBe(0);
  });

  it('resizes, clears, disposes, and produces stable sequential ids', () => {
    const domain = new NetworkDomain({ maxRecords: 3 });
    expect(domain.nextId()).toBe('net:1');
    expect(domain.nextId()).toBe('net:2');
    domain.onStart(record('a'));
    domain.onStart(record('b'));
    domain.onStart(record('c'));
    domain.setMaxRecords(1);
    expect(domain.records().map((item) => item.id)).toEqual(['c']);
    domain.clear();
    expect(domain.records()).toEqual([]);
    domain.onStart(record('d'));
    domain.dispose();
    expect(domain.records()).toEqual([]);
  });
});
