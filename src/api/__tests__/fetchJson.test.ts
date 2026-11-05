import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { fetchJson } from '../fetchJson';

const mockFetch = vi.fn();
global.fetch = mockFetch as typeof fetch;

const Schema = z.object({ ok: z.literal(true) });

const named = (name: string) => Object.assign(new Error(name), { name });

const json = (status: number, body: unknown) => ({
  ok: status < 400,
  status,
  json: () => Promise.resolve(body),
});

const TIMEOUT = 'Request timed out — check your connection';

const failures = [
  {
    name: 'timeout before a response',
    fetch: () => Promise.reject(named('TimeoutError')),
    message: TIMEOUT,
  },
  {
    name: 'abort before a response',
    fetch: () => Promise.reject(named('AbortError')),
    message: TIMEOUT,
  },
  {
    name: 'network failure',
    fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    message: 'Network unreachable — check your connection',
  },
  {
    name: 'other fetch error keeps its message',
    fetch: () => Promise.reject(new Error('boom')),
    message: 'boom',
  },
  {
    name: 'non-Error rejection is stringified',
    fetch: () => Promise.reject('boom'),
    message: 'boom',
  },
  {
    name: 'timeout while reading the body',
    fetch: () =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(named('TimeoutError')) }),
    message: TIMEOUT,
  },
  {
    name: 'malformed JSON',
    fetch: () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      }),
    message: 'Received a malformed response from the server',
  },
  {
    name: 'schema mismatch',
    fetch: () => Promise.resolve(json(200, { ok: false })),
    message: 'Received an unexpected response from the server',
  },
  {
    name: 'worker envelope message is surfaced',
    fetch: () =>
      Promise.resolve(
        json(502, {
          error: {
            code: 'UPSTREAM_ERROR',
            message: 'GitHub upstream responded with status 403',
            requestId: 'req_1',
          },
        }),
      ),
    message: 'GitHub upstream responded with status 403',
  },
  {
    name: 'envelope without a message falls back to the status',
    fetch: () => Promise.resolve(json(502, { error: { code: 'UPSTREAM_ERROR' } })),
    message: 'GitHub API error: 502',
  },
  {
    name: 'non-JSON error body falls back to the status',
    fetch: () =>
      Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new SyntaxError('x')) }),
    message: 'GitHub API error: 404',
  },
];

describe('fetchJson', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the body parsed through the schema', async () => {
    mockFetch.mockImplementationOnce(() => Promise.resolve(json(200, { ok: true, extra: 1 })));

    await expect(fetchJson('/x', Schema)).resolves.toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledWith(
      '/x',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  // Callers read only `message`, so every failure is a plain Error.
  it.each(failures)('$name', async ({ fetch, message }) => {
    mockFetch.mockImplementationOnce(fetch);

    const error: unknown = await fetchJson('/x', Schema).catch(e => e);

    expect(Object.getPrototypeOf(error)).toBe(Error.prototype);
    expect((error as Error).message).toBe(message);
  });
});
