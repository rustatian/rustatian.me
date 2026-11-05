import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type CacheKey = RequestInfo | URL;
type Worker = typeof import('../worker').default;

const fetchMock = vi.fn();
global.fetch = fetchMock as typeof fetch;

// `worker.ts` holds a module-scoped rate-limit bucket. Re-importing the
// module for every test gives each one a fresh bucket so state doesn't
// leak between tests.
let worker: Worker;
const loadWorker = async (): Promise<Worker> => {
  vi.resetModules();
  return (await import('../worker')).default;
};

const createEnv = (
  assetFetch: (request: Request) => Promise<Response> = async () =>
    new Response('Not Found', { status: 404 }),
  extras: Record<string, unknown> = {},
) =>
  ({
    ASSETS: {
      fetch: vi.fn(assetFetch),
    },
    ...extras,
  }) as unknown as Parameters<Worker['fetch']>[1];

// Derive the key from the URL, never `String(request)` — that is the constant
// "[object Request]" for every Request, which collapsed every entry into a
// single slot and made cache-key regressions invisible to these tests.
const cacheKeyOf = (request: CacheKey): string => {
  if (typeof request === 'string') return request;
  return request instanceof URL ? request.href : request.url;
};

const createMockCache = () => {
  const store = new Map<string, Response>();
  const cache = {
    add: vi.fn(),
    addAll: vi.fn(),
    delete: vi.fn(),
    keys: vi.fn(),
    match: vi.fn(async (request: CacheKey) => {
      const key = cacheKeyOf(request);
      const cached = store.get(key);
      return cached ? cached.clone() : undefined;
    }),
    put: vi.fn(async (request: CacheKey, response: Response) => {
      const key = cacheKeyOf(request);
      store.set(key, response.clone());
    }),
  } as unknown as Cache;

  return {
    cacheStorage: {
      delete: vi.fn(),
      keys: vi.fn(),
      has: vi.fn(),
      match: vi.fn(async (request: RequestInfo | URL) => {
        return cache.match(request);
      }),
      open: vi.fn(async () => {
        return cache;
      }),
    } as unknown as CacheStorage,
    store,
  };
};

const expectBaseSecurityHeaders = (response: Response): void => {
  expect(response.headers.get('x-frame-options')).toBe('DENY');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  expect(response.headers.get('permissions-policy')).toBe(
    'geolocation=(), microphone=(), camera=()',
  );
};

const githubUserPayload = () => ({
  login: 'rustatian',
  public_repos: 42,
  followers: 100,
  following: 7,
});

// Asset env where every path 404s except the prerendered 404 shell, mirroring
// what the assets binding does for a client-side route that has no file.
const shellEnv =
  (missingPath: string) =>
  async (request: Request): Promise<Response> => {
    const pathname = new URL(request.url).pathname;
    if (pathname === missingPath) {
      return new Response('Not Found', { status: 404 });
    }
    if (pathname === '/404/') {
      return new Response('<!doctype html><html><body>Not found</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=UTF-8' },
      });
    }
    return new Response('Not Found', { status: 404 });
  };

const graphqlCalendarPayload = (
  days: Array<{ date: string; contributionCount: number; contributionLevel: string }> = [
    { date: '2026-04-12', contributionCount: 0, contributionLevel: 'NONE' },
    { date: '2026-04-13', contributionCount: 5, contributionLevel: 'THIRD_QUARTILE' },
  ],
  totalContributions = 42,
) => ({
  data: {
    user: {
      contributionsCollection: {
        contributionCalendar: {
          totalContributions,
          weeks: [{ contributionDays: days }],
        },
      },
    },
  },
});

describe('worker GitHub proxy API', () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    worker = await loadWorker();
  });

  it('proxies user endpoint and serves cache hit on subsequent request', async () => {
    const { cacheStorage } = createMockCache();
    (globalThis as { caches: CacheStorage }).caches = cacheStorage;

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(githubUserPayload()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const env = createEnv();
    const request = new Request('https://rustatian.me/api/v1/github/user');

    const firstResponse = await worker.fetch(request, env);
    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get('x-cache')).toBe('MISS');
    expect(await firstResponse.json()).toMatchObject({ login: 'rustatian' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const secondResponse = await worker.fetch(request, env);
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.headers.get('x-cache')).toBe('HIT');
    expect(await secondResponse.json()).toMatchObject({ login: 'rustatian' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('strips owner-only fields from the authenticated user payload', async () => {
    const { cacheStorage } = createMockCache();
    (globalThis as { caches: CacheStorage }).caches = cacheStorage;

    // GitHub answers /users/{login} with its owner-only `private-user` schema
    // when the token belongs to that same user. None of it may reach clients.
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...githubUserPayload(),
          total_private_repos: 34,
          owned_private_repos: 34,
          private_gists: 2,
          disk_usage: 588668,
          collaborators: 3,
          two_factor_authentication: true,
          email: 'private@example.com',
          plan: { name: 'free', space: 976562499 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const response = await worker.fetch(
      new Request('https://rustatian.me/api/v1/github/user'),
      createEnv(),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['followers', 'following', 'login', 'public_repos']);
  });

  const retention = [
    {
      name: 'user: 10 minutes fresh plus a 7-day stale window',
      path: '/api/v1/github/user',
      upstream: JSON.stringify(githubUserPayload()),
      served: 'public, max-age=600',
      stored: `public, max-age=${600 + 604800}`,
    },
    {
      name: 'contributions: 24 hours fresh plus a 7-day stale window',
      path: '/api/v1/github/contributions',
      upstream: JSON.stringify(graphqlCalendarPayload()),
      served: 'public, max-age=86400',
      stored: `public, max-age=${86400 + 604800}`,
    },
  ];

  // Cloudflare evicts on the *stored* cache-control. Storing the client-facing
  // max-age would drop the entry exactly when x-edge-expires-at marks it stale,
  // making the serve-stale-on-outage path unreachable.
  it.each(retention)(
    'stores the edge copy for the TTL plus the stale window ($name)',
    async ({ path, upstream, served, stored }) => {
      const { cacheStorage, store } = createMockCache();
      (globalThis as { caches: CacheStorage }).caches = cacheStorage;

      fetchMock.mockResolvedValueOnce(
        new Response(upstream, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const response = await worker.fetch(
        new Request(`https://rustatian.me${path}`),
        createEnv(undefined, { GITHUB_TOKEN: 'test-token' }),
      );
      expect(response.headers.get('cache-control')).toBe(served);

      const entry = [...store.values()][0];
      expect(entry?.headers.get('cache-control')).toBe(stored);
    },
  );

  it('shares one cache entry for /user regardless of query string', async () => {
    const { cacheStorage } = createMockCache();
    (globalThis as { caches: CacheStorage }).caches = cacheStorage;

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(githubUserPayload()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const env = createEnv();
    await worker.fetch(new Request('https://rustatian.me/api/v1/github/user'), env);
    const busted = await worker.fetch(
      new Request('https://rustatian.me/api/v1/github/user?cache=bust'),
      env,
    );

    // Keying on `request.url` let any query string mint a fresh entry, turning
    // every request into an upstream call against the token's hourly quota.
    expect(busted.headers.get('x-cache')).toBe('HIT');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The browser gets the TTL, not the edge retention window.
    expect(busted.headers.get('cache-control')).toBe('public, max-age=600');
  });

  it('returns 404 for retired /blog routes (no longer proxied)', async () => {
    const { cacheStorage } = createMockCache();
    (globalThis as { caches: CacheStorage }).caches = cacheStorage;

    const env = createEnv();
    const response = await worker.fetch(
      new Request('https://rustatian.me/api/v1/github/blog/some-post.md'),
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'NOT_FOUND' },
    });
  });

  it('returns 404 for retired /readme route', async () => {
    const { cacheStorage } = createMockCache();
    (globalThis as { caches: CacheStorage }).caches = cacheStorage;

    const env = createEnv();
    const response = await worker.fetch(
      new Request('https://rustatian.me/api/v1/github/readme'),
      env,
    );

    expect(response.status).toBe(404);
  });

  it('maps upstream HTTP errors into normalized Worker API errors', async () => {
    const { cacheStorage } = createMockCache();
    (globalThis as { caches: CacheStorage }).caches = cacheStorage;

    fetchMock.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

    const env = createEnv();
    const response = await worker.fetch(
      new Request('https://rustatian.me/api/v1/github/user'),
      env,
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'UPSTREAM_ERROR',
        message: 'GitHub upstream responded with status 404',
        requestId: expect.any(String),
      },
    });
  });

  const apiErrors = [
    {
      name: 'unknown API route',
      request: () => new Request('https://rustatian.me/api/v1/github/nope'),
      status: 404,
      code: 'NOT_FOUND',
    },
    {
      name: 'unsupported method on the API',
      request: () => new Request('https://rustatian.me/api/v1/github/user', { method: 'POST' }),
      status: 405,
      code: 'METHOD_NOT_ALLOWED',
    },
    {
      name: 'GET on the csp-report sink',
      request: () => new Request('https://rustatian.me/api/v1/csp-report'),
      status: 405,
      code: 'METHOD_NOT_ALLOWED',
    },
    {
      name: 'GraphQL route without a token',
      request: () => new Request('https://rustatian.me/api/v1/github/contributions'),
      status: 502,
      code: 'UPSTREAM_ERROR',
    },
  ];

  it.each(apiErrors)(
    '$name: one request id in the body and the header',
    async ({ request, status, code }) => {
      const { cacheStorage } = createMockCache();
      (globalThis as { caches: CacheStorage }).caches = cacheStorage;

      const response = await worker.fetch(request(), createEnv());

      expect(response.status).toBe(status);
      expect(response.headers.get('content-type')).toBe('application/json; charset=UTF-8');
      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = (await response.json()) as { error: { code: string; requestId: string } };
      expect(body.error.code).toBe(code);
      expect(body.error.requestId).toBe(response.headers.get('x-request-id'));
    },
  );

  it('serves stale cache when upstream refresh fails', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000_000);

    const { cacheStorage } = createMockCache();
    (globalThis as { caches: CacheStorage }).caches = cacheStorage;

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(githubUserPayload()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const env = createEnv();
    const request = new Request('https://rustatian.me/api/v1/github/user', {
      headers: { 'cf-connecting-ip': '192.0.2.10' },
    });

    const firstResponse = await worker.fetch(request, env);
    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get('x-cache')).toBe('MISS');
    expect(await firstResponse.json()).toMatchObject({ login: 'rustatian' });

    // Jump past the 600s user TTL to force a refresh, which fails.
    nowSpy.mockReturnValue(1_000_000 + 601_000);
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    const staleResponse = await worker.fetch(request, env);
    expect(staleResponse.status).toBe(200);
    expect(staleResponse.headers.get('x-cache')).toBe('STALE');
    expect(staleResponse.headers.get('cache-control')).toBe('public, max-age=600');
    expect(await staleResponse.json()).toMatchObject({ login: 'rustatian' });

    nowSpy.mockRestore();
  });

  const staleWindow = [
    {
      name: 'inside the stale window a failed refresh serves the stale copy',
      elapsedMs: 86_400_000 + 604_800_000 - 1000,
      status: 200,
      cacheStatus: 'STALE',
    },
    {
      name: 'past the stale window a failed refresh surfaces as 502',
      elapsedMs: 86_400_000 + 604_800_000 + 1000,
      status: 502,
      cacheStatus: null,
    },
  ];

  it.each(staleWindow)('$name', async ({ elapsedMs, status, cacheStatus }) => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { cacheStorage } = createMockCache();
    (globalThis as { caches: CacheStorage }).caches = cacheStorage;

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(graphqlCalendarPayload()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const env = createEnv(undefined, { GITHUB_TOKEN: 'test-token' });
    const req = () => new Request('https://rustatian.me/api/v1/github/contributions');

    expect((await worker.fetch(req(), env)).headers.get('x-cache')).toBe('MISS');

    nowSpy.mockReturnValue(1_000_000 + elapsedMs);
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    const response = await worker.fetch(req(), env);
    expect(response.status).toBe(status);
    expect(response.headers.get('x-cache')).toBe(cacheStatus);

    errorSpy.mockRestore();
    nowSpy.mockRestore();
  });

  it('reports schema drift as an unexpected response, not as an upstream status', async () => {
    const { cacheStorage } = createMockCache();
    (globalThis as { caches: CacheStorage }).caches = cacheStorage;

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ login: 'rustatian' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await worker.fetch(
      new Request('https://rustatian.me/api/v1/github/user'),
      createEnv(),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'UPSTREAM_ERROR',
        message: 'GitHub upstream returned an unexpected response',
        requestId: expect.any(String),
      },
    });
    errorSpy.mockRestore();
  });

  it('logs non-upstream-HTTP fetch failures (network, timeout) with no stale cache', async () => {
    const { cacheStorage } = createMockCache();
    (globalThis as { caches: CacheStorage }).caches = cacheStorage;

    fetchMock.mockRejectedValueOnce(new TypeError('network down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const env = createEnv();
    const response = await worker.fetch(
      new Request('https://rustatian.me/api/v1/github/user'),
      env,
    );

    expect(response.status).toBe(502);
    expect(errorSpy).toHaveBeenCalled();
    // Search all logged calls — don't assume the upstream-fetch-failure is first,
    // and don't throw a cryptic SyntaxError if some call logs a non-JSON arg.
    const loggedPayloads = errorSpy.mock.calls
      .map(call => {
        try {
          return JSON.parse(call[0] as string) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((p): p is Record<string, unknown> => p !== null);
    expect(loggedPayloads).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'upstream-fetch-failure' })]),
    );
    errorSpy.mockRestore();
  });

  it('proxies /contributions by POSTing GraphQL to GitHub and trims the response', async () => {
    const { cacheStorage } = createMockCache();
    (globalThis as { caches: CacheStorage }).caches = cacheStorage;

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            user: {
              contributionsCollection: {
                contributionCalendar: {
                  totalContributions: 42,
                  weeks: [
                    {
                      contributionDays: [
                        {
                          date: '2026-04-12',
                          contributionCount: 0,
                          contributionLevel: 'NONE',
                        },
                        {
                          date: '2026-04-13',
                          contributionCount: 5,
                          contributionLevel: 'THIRD_QUARTILE',
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const env = createEnv(undefined, { GITHUB_TOKEN: 'test-token' });
    const response = await worker.fetch(
      new Request('https://rustatian.me/api/v1/github/contributions'),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-cache')).toBe('MISS');

    const body = (await response.json()) as {
      totalContributions: number;
      days: Array<{ date: string; count: number; level: number }>;
    };
    expect(body.totalContributions).toBe(42);
    expect(body.days).toEqual([
      { date: '2026-04-12', count: 0, level: 0 },
      { date: '2026-04-13', count: 5, level: 3 },
    ]);

    // Verify the upstream call was a POST to /graphql with the Bearer token.
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.github.com/graphql');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-token');
    expect(init.headers['Content-Type']).toBe('application/json');
    const parsedBody = JSON.parse(init.body) as { query: string; variables: { login: string } };
    expect(parsedBody.variables).toEqual({ login: 'rustatian' });
    expect(parsedBody.query).toContain('contributionCalendar');
  });

  it('serves /contributions from edge cache on the second request', async () => {
    const { cacheStorage } = createMockCache();
    (globalThis as { caches: CacheStorage }).caches = cacheStorage;

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            user: {
              contributionsCollection: {
                contributionCalendar: {
                  totalContributions: 1,
                  weeks: [
                    {
                      contributionDays: [
                        {
                          date: '2026-04-13',
                          contributionCount: 1,
                          contributionLevel: 'FIRST_QUARTILE',
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const env = createEnv(undefined, { GITHUB_TOKEN: 'test-token' });
    const req = () => new Request('https://rustatian.me/api/v1/github/contributions');

    const first = await worker.fetch(req(), env);
    expect(first.headers.get('x-cache')).toBe('MISS');

    const second = await worker.fetch(req(), env);
    expect(second.headers.get('x-cache')).toBe('HIT');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns 502 for /contributions when GITHUB_TOKEN is missing', async () => {
    const { cacheStorage } = createMockCache();
    (globalThis as { caches: CacheStorage }).caches = cacheStorage;

    const env = createEnv();
    const response = await worker.fetch(
      new Request('https://rustatian.me/api/v1/github/contributions'),
      env,
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'UPSTREAM_ERROR',
        message: expect.stringContaining('authentication token'),
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 502 with a synthesized message when GraphQL returns errors[]', async () => {
    const { cacheStorage } = createMockCache();
    (globalThis as { caches: CacheStorage }).caches = cacheStorage;

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ errors: [{ message: 'Bad credentials' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const env = createEnv(undefined, { GITHUB_TOKEN: 'test-token' });
    const response = await worker.fetch(
      new Request('https://rustatian.me/api/v1/github/contributions'),
      env,
    );

    expect(response.status).toBe(502);
    // GitHub's GraphQL error text enumerates the scopes the site's own token
    // holds, so the client-facing message is synthesized, not relayed.
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'UPSTREAM_ERROR',
        message: 'GitHub GraphQL request failed',
        requestId: expect.any(String),
      },
    });

    // Error message and GraphQL payload must be logged (observability for
    // schema drift / bad-token issues that would otherwise be invisible).
    const loggedPayloads = errorSpy.mock.calls
      .map(call => {
        try {
          return JSON.parse(call[0] as string) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((p): p is Record<string, unknown> => p !== null);
    expect(loggedPayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'upstream-graphql-error',
          servedStale: false,
          graphqlErrors: expect.arrayContaining([
            expect.objectContaining({ message: 'Bad credentials' }),
          ]),
        }),
      ]),
    );
    errorSpy.mockRestore();
  });

  it('logs transform failures even when serving stale cache', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000_000);

    const { cacheStorage } = createMockCache();
    (globalThis as { caches: CacheStorage }).caches = cacheStorage;

    // First fetch: valid GraphQL response → cached.
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            user: {
              contributionsCollection: {
                contributionCalendar: {
                  totalContributions: 1,
                  weeks: [
                    {
                      contributionDays: [
                        {
                          date: '2026-04-15',
                          contributionCount: 1,
                          contributionLevel: 'FIRST_QUARTILE',
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const env = createEnv(undefined, { GITHUB_TOKEN: 'test-token' });
    const firstResp = await worker.fetch(
      new Request('https://rustatian.me/api/v1/github/contributions'),
      env,
    );
    expect(firstResp.headers.get('x-cache')).toBe('MISS');

    // Jump past the 24h TTL and return a malformed response on the refresh.
    nowSpy.mockReturnValue(1_000_000 + 86_400 * 1000 + 1);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ unexpected: 'shape' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const staleResp = await worker.fetch(
      new Request('https://rustatian.me/api/v1/github/contributions'),
      env,
    );
    expect(staleResp.status).toBe(200);
    expect(staleResp.headers.get('x-cache')).toBe('STALE');

    // Must have logged the transform failure even though we served stale.
    const loggedPayloads = errorSpy.mock.calls
      .map(call => {
        try {
          return JSON.parse(call[0] as string) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((p): p is Record<string, unknown> => p !== null);
    expect(loggedPayloads).toEqual(
      expect.arrayContaining([expect.objectContaining({ servedStale: true })]),
    );

    errorSpy.mockRestore();
    nowSpy.mockRestore();
  });

  it('returns 404 for retired /pinned and /repos routes', async () => {
    const { cacheStorage } = createMockCache();
    (globalThis as { caches: CacheStorage }).caches = cacheStorage;

    const env = createEnv();
    const pinned = await worker.fetch(
      new Request('https://rustatian.me/api/v1/github/pinned'),
      env,
    );
    expect(pinned.status).toBe(404);

    const repos = await worker.fetch(new Request('https://rustatian.me/api/v1/github/repos'), env);
    expect(repos.status).toBe(404);
  });
});

describe('worker HTML shell fallback and headers', () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    worker = await loadWorker();
  });

  it('returns HTML and security headers for root path even with wildcard accept', async () => {
    const env = createEnv(async (request: Request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === '/') {
        return new Response('<!doctype html><html><body>Home</body></html>', {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=UTF-8',
          },
        });
      }

      return new Response('Not Found', { status: 404 });
    });

    const response = await worker.fetch(
      new Request('https://rustatian.me/', { headers: { Accept: '*/*' } }),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBeTruthy();
    expectBaseSecurityHeaders(response);
    expect(await response.text()).toContain('Home');
  });

  it('serves the prerendered 404 shell with a 404 status for retired routes', async () => {
    const env = createEnv(shellEnv('/blog'));

    const response = await worker.fetch(
      new Request('https://rustatian.me/blog', { headers: { Accept: '*/*' } }),
      env,
    );

    // Previously returned 200 with the home document, which made every retired
    // and junk URL look like a live duplicate of `/` to crawlers.
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('content-security-policy')).toBeTruthy();
    expectBaseSecurityHeaders(response);
    expect(await response.text()).toContain('Not found');
  });

  it('serves the prerendered 404 shell for unknown non-asset routes', async () => {
    const env = createEnv(shellEnv('/does-not-exist'));

    const response = await worker.fetch(
      new Request('https://rustatian.me/does-not-exist', { headers: { Accept: '*/*' } }),
      env,
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('Not found');
  });

  it('passes redirects through instead of treating them as a miss', async () => {
    // The asset server 3xx's extensionless directory paths (/about -> /about/).
    // Treating that as a miss served the home document at /about — the exact URL
    // the site's own nav links to.
    const env = createEnv(async (request: Request) => {
      if (new URL(request.url).pathname === '/about') {
        return new Response(null, { status: 308, headers: { location: '/about/' } });
      }
      return new Response('Not Found', { status: 404 });
    });

    const response = await worker.fetch(new Request('https://rustatian.me/about'), env);

    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('/about/');
  });

  it('passes 304 through instead of treating it as a miss', async () => {
    // robots.txt / sitemap.xml match no static-asset prefix or extension, so a
    // revalidation 304 used to fall through and answer with the HTML shell.
    const env = createEnv(async (request: Request) => {
      if (new URL(request.url).pathname === '/robots.txt') {
        return new Response(null, { status: 304 });
      }
      return new Response('Not Found', { status: 404 });
    });

    const response = await worker.fetch(
      new Request('https://rustatian.me/robots.txt', {
        headers: { 'if-none-match': '"abc123"' },
      }),
      env,
    );

    expect(response.status).toBe(304);
  });
});

describe('worker rate limiting', () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T12:00:00Z'));
    worker = await loadWorker();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 429 after exceeding burst capacity on the same IP', async () => {
    const { cacheStorage } = createMockCache();
    (globalThis as { caches: CacheStorage }).caches = cacheStorage;

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ login: 'rustatian' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const env = createEnv();
    const makeRequest = () =>
      new Request('https://rustatian.me/api/v1/github/user', {
        headers: { 'cf-connecting-ip': '203.0.113.5' },
      });

    const successes: number[] = [];
    const failures: Response[] = [];

    for (let i = 0; i < 15; i += 1) {
      const response = await worker.fetch(makeRequest(), env);
      if (response.status === 429) {
        failures.push(response);
      } else {
        successes.push(i);
      }
    }

    expect(successes.length).toBe(10);
    expect(failures.length).toBe(5);
    expect(failures[0]!.headers.get('retry-after')).toBe('1');
    await expect(failures[0]!.json()).resolves.toMatchObject({
      error: { code: 'RATE_LIMITED' },
    });
  });

  it('tracks different IPs independently', async () => {
    const { cacheStorage } = createMockCache();
    (globalThis as { caches: CacheStorage }).caches = cacheStorage;

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ login: 'rustatian' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const env = createEnv();
    const buildRequest = (ip: string) =>
      new Request('https://rustatian.me/api/v1/github/user', {
        headers: { 'cf-connecting-ip': ip },
      });

    for (let i = 0; i < 15; i += 1) {
      await worker.fetch(buildRequest('198.51.100.1'), env);
    }
    const freshIpResponse = await worker.fetch(buildRequest('198.51.100.2'), env);
    expect(freshIpResponse.status).not.toBe(429);
  });
});

describe('worker CSP', () => {
  const htmlEnv = () =>
    createEnv(async (request: Request) => {
      if (new URL(request.url).pathname === '/') {
        return new Response('<!doctype html><html><body>Home</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=UTF-8', etag: '"shell-v1"' },
        });
      }
      return new Response('Not Found', { status: 404 });
    });

  const fetchHome = async () =>
    worker.fetch(
      new Request('https://rustatian.me/', { headers: { Accept: 'text/html' } }),
      htmlEnv(),
    );

  beforeEach(async () => {
    fetchMock.mockReset();
    worker = await loadWorker();
  });

  it('leaves HTML cacheable now that nothing rewrites it per-request', async () => {
    const response = await fetchHome();

    // The nonce placeholder used to force no-store on every navigation, costing
    // a full document fetch per page view and disqualifying bfcache.
    expect(response.headers.get('cache-control')).not.toBe('no-store');
    expect(response.headers.get('etag')).toBe('"shell-v1"');
  });

  it('allows the inline theme bootstrap by hash, not by nonce', async () => {
    const enforced = (await fetchHome()).headers.get('content-security-policy');

    expect(enforced).toContain("script-src 'self' 'sha256-");
    expect(enforced).not.toContain("'nonce-");
    expect(enforced).not.toContain("'unsafe-inline'");
    expect(enforced).not.toContain("'unsafe-eval'");
  });

  it('pins the hash of the inline theme bootstrap in index.html', async () => {
    // CSP matches an inline script by the base64 SHA-256 of its text, so an
    // edit to the script that does not update THEME_BOOTSTRAP_HASH blocks it.
    // https://www.w3.org/TR/CSP3/#match-element-to-source-list
    const html = readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
    const script = html.match(/<script>(.*?)<\/script>/s)?.[1] ?? '';
    expect(script).not.toBe('');
    const digest = createHash('sha256').update(script).digest('base64');

    const enforced = (await fetchHome()).headers.get('content-security-policy');
    expect(enforced).toContain(`'sha256-${digest}'`);
  });

  it('does not allow images from arbitrary https origins', async () => {
    const enforced = (await fetchHome()).headers.get('content-security-policy');

    // A blanket `https:` was the widest remaining exfiltration channel; the site
    // renders no images at all.
    expect(enforced).toContain("img-src 'self' data:");
    expect(enforced).not.toMatch(/img-src[^;]*\shttps:/);
  });

  it('keeps the report-only policy in lockstep with the enforced one', async () => {
    const response = await fetchHome();
    const reportOnly = response.headers.get('content-security-policy-report-only');
    const enforced = response.headers.get('content-security-policy');

    expect(reportOnly).not.toBeNull();
    expect(reportOnly).toContain('require-trusted-types-for');
    expect(reportOnly).toContain('upgrade-insecure-requests');
    expect(reportOnly).toContain('report-uri /api/v1/csp-report');

    // Every directive the enforced policy sets must also appear report-only,
    // or the report-only channel is testing a different policy than it claims.
    for (const directive of enforced!.split('; ')) {
      expect(reportOnly).toContain(directive);
    }
  });
});

describe('worker CSP report endpoint', () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    worker = await loadWorker();
  });

  it('accepts POST to /api/v1/csp-report and returns 204', async () => {
    const env = createEnv();
    const response = await worker.fetch(
      new Request('https://rustatian.me/api/v1/csp-report', {
        method: 'POST',
        headers: {
          'content-type': 'application/csp-report',
          'cf-connecting-ip': '203.0.113.20',
        },
        body: JSON.stringify({ 'csp-report': { 'violated-directive': 'style-src' } }),
      }),
      env,
    );

    expect(response.status).toBe(204);
  });

  it('applies rate limiting to csp-report POSTs per client IP', async () => {
    const env = createEnv();
    const makeRequest = () =>
      new Request('https://rustatian.me/api/v1/csp-report', {
        method: 'POST',
        headers: {
          'content-type': 'application/csp-report',
          'cf-connecting-ip': '203.0.113.22',
        },
        body: JSON.stringify({ 'csp-report': { 'violated-directive': 'style-src' } }),
      });

    const statuses: number[] = [];
    for (let i = 0; i < 15; i += 1) {
      const response = await worker.fetch(makeRequest(), env);
      statuses.push(response.status);
    }

    expect(statuses.some(s => s === 204)).toBe(true);
    expect(statuses.some(s => s === 429)).toBe(true);
  });
});
