import { describe, expect, it } from 'vitest';
import { isError, isEvent, isRequest, isResponse, type Message, type Response } from './protocol';

describe('protocol guards', () => {
  it('distinguishes requests, responses, events, and errors', () => {
    const request: Message = { id: 1, method: 'Log.clear', params: {} };
    const response: Response = { id: 1, result: { ok: true } };
    const failure: Response = { id: 2, error: { code: -32603, message: 'failed' } };
    const event: Message = { method: 'Log.entryAdded', params: { id: 'log:1' } };

    expect(isRequest(request)).toBe(true);
    expect(isResponse(response)).toBe(true);
    expect(isResponse(failure)).toBe(true);
    expect(isError(failure)).toBe(true);
    expect(isError(response)).toBe(false);
    expect(isEvent(event)).toBe(true);
    expect(isEvent(request)).toBe(false);
  });
});
