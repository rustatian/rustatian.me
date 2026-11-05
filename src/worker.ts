/// <reference types="@cloudflare/workers-types" />

import { CACHE_TTL_SECONDS, MAX_STALE_SECONDS } from './api/cachePolicy';
import type { ErrorEnvelope } from './api/contracts';
import { API_BASE_PATH, CSP_REPORT_PATH, routes } from './api/routes';
import { PROFILE_NAME } from './constants';
import { TokenBucket } from './utils/rateLimiter';
import { CONTRIBUTIONS_QUERY, transformContributions } from './worker/contributions';
import { GraphQLResponseError, UpstreamRequestError } from './worker/errors';
import { transformUser } from './worker/user';

const RATE_LIMIT_BURST = 10;
const RATE_LIMIT_SUSTAINED_PER_MINUTE = 100;

const RATE_LIMIT_BUCKET = new TokenBucket({
  capacity: RATE_LIMIT_BURST,
  refillPerSecond: RATE_LIMIT_SUSTAINED_PER_MINUTE / 60,
});

const getClientIp = (request: Request): string => {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp;
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? 'unknown';
  return 'unknown';
};

interface Env {
  ASSETS: Fetcher;
  GITHUB_TOKEN?: string;
}

type WorkerErrorCode = 'RATE_LIMITED' | 'METHOD_NOT_ALLOWED' | 'UPSTREAM_ERROR' | 'NOT_FOUND';

interface UpstreamRouteBase {
  upstreamUrl: string;
  ttlSeconds: number;
  // Past `expiresAt + maxStaleSeconds` a failed refresh surfaces a 502. This
  // bounds how old a served body can be.
  maxStaleSeconds: number;
  // Stable `https://cache.internal/...` URL so every client shares one entry.
  // A key derived from the request URL gives each query string its own entry
  // and its own upstream call against the token's hourly quota. The Workers
  // Cache API wants a full URL.
  cacheKey: string;
  // Every upstream request is authenticated, so a verbatim body can disclose
  // fields GitHub only returns to the account owner. The returned string is
  // cached verbatim. Must throw `UpstreamRequestError` or `GraphQLResponseError`
  // on parse, schema or application failures.
  transform: (rawBody: string) => string;
}

// Discriminated union on `kind` so the simple proxy case and the authenticated
// GraphQL case cannot be conflated.
type UpstreamRoute =
  | (UpstreamRouteBase & { kind: 'simple-get' })
  | (UpstreamRouteBase & { kind: 'graphql-post'; body: string });

const GITHUB_API_HOST = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 8000;
const CACHE_NAME = 'github-proxy-cache';
const JSON_CONTENT_TYPE = 'application/json; charset=UTF-8';
const CACHE_EXPIRES_HEADER = 'x-edge-expires-at';
const REQUEST_ID_HEADER = 'x-request-id';
const CACHE_STATUS_HEADER = 'x-cache';
const STATIC_ASSET_PREFIXES = ['/assets/'];
const STATIC_ASSET_EXTENSIONS = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|json)$/i;

// sha256 of the inline theme bootstrap in index.html. Keep in lockstep with that
// script — any edit to it, whitespace included, invalidates this hash and the
// theme resolution silently stops running.
const THEME_BOOTSTRAP_HASH = "'sha256-fGMRTOjIFy+TF/hMznDeG+wzFsBWvQM3rLgMZyfW4aA='";

// Shared by the enforced and report-only policies so the two can't drift; a
// report-only policy that doesn't mirror the enforced one tests nothing.
const CSP_SHARED_DIRECTIVES = [
  "default-src 'self'",
  `script-src 'self' ${THEME_BOOTSTRAP_HASH}`,
  // No images are rendered anywhere on the site; the favicon is same-origin.
  // A blanket `https:` here would be the widest remaining exfiltration channel.
  "img-src 'self' data:",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
];

// Nothing emits inline styles — the shipped HTML carries no `style` attributes
// and no `<style>` tags — so the enforced policy no longer needs 'unsafe-inline'.
const CSP_STYLE_SRC = "style-src 'self' https://fonts.googleapis.com";

const buildCspPolicy = (): string => [...CSP_SHARED_DIRECTIVES, CSP_STYLE_SRC].join('; ');

const buildCspReportOnlyPolicy = (): string =>
  [
    ...CSP_SHARED_DIRECTIVES,
    CSP_STYLE_SRC,
    'upgrade-insecure-requests',
    "require-trusted-types-for 'script'",
    `report-uri ${CSP_REPORT_PATH}`,
  ].join('; ');

const applySecurityHeaders = (headers: Headers, includeCSP = false): void => {
  if (includeCSP) {
    headers.set('content-security-policy', buildCspPolicy());
    headers.set('content-security-policy-report-only', buildCspReportOnlyPolicy());
  } else {
    headers.delete('content-security-policy');
    headers.delete('content-security-policy-report-only');
  }
  headers.set('x-frame-options', 'DENY');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('permissions-policy', 'geolocation=(), microphone=(), camera=()');
  headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains; preload');
  headers.set('cross-origin-opener-policy', 'same-origin');
  headers.set('cross-origin-resource-policy', 'same-origin');
};

const buildApiErrorResponse = (
  status: number,
  code: WorkerErrorCode,
  message: string,
  requestId: string,
  extraHeaders: Record<string, string> = {},
): Response => {
  const headers = new Headers({
    'content-type': JSON_CONTENT_TYPE,
    'cache-control': 'no-store',
    [REQUEST_ID_HEADER]: requestId,
    ...extraHeaders,
  });
  applySecurityHeaders(headers, false);

  const envelope: ErrorEnvelope = { error: { code, message, requestId } };
  return new Response(JSON.stringify(envelope), { status, headers });
};

const buildRateLimitResponse = (requestId: string): Response =>
  buildApiErrorResponse(429, 'RATE_LIMITED', 'Too many requests — please slow down', requestId, {
    'retry-after': '1',
  });

const cloneResponseWithHeaders = (
  response: Response,
  extraHeaders: Record<string, string>,
): Response => {
  const headers = new Headers(response.headers);

  for (const [key, value] of Object.entries(extraHeaders)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

// The body streams straight through: nothing rewrites the HTML any more, so
// there is no reason to buffer it. Buffering was also what made HEAD requests
// (empty body) take a different header path than GET on the same URL.
const buildResponseWithSecurityHeaders = (
  response: Response,
  options?: {
    overrideStatus?: number;
    extraHeaders?: Record<string, string>;
  },
): Response => {
  const headers = new Headers(response.headers);

  if (options?.extraHeaders) {
    for (const [key, value] of Object.entries(options.extraHeaders)) {
      headers.set(key, value);
    }
  }

  const isHtml = headers.get('content-type')?.toLowerCase().includes('text/html') ?? false;
  applySecurityHeaders(headers, isHtml);

  const status = options?.overrideStatus ?? response.status;
  const init: ResponseInit = { status, headers };

  if (options?.overrideStatus === undefined) {
    init.statusText = response.statusText;
  }

  return new Response(response.body, init);
};

const buildTextErrorResponse = (status: number, message: string): Response => {
  const headers = new Headers({ 'content-type': 'text/plain; charset=UTF-8' });
  applySecurityHeaders(headers, false);

  return new Response(message, {
    status,
    headers,
  });
};

const isStaticAssetPath = (pathname: string): boolean => {
  return (
    STATIC_ASSET_PREFIXES.some(prefix => pathname.startsWith(prefix)) ||
    STATIC_ASSET_EXTENSIONS.test(pathname)
  );
};

const resolveGitHubRoute = (pathname: string): UpstreamRoute | null => {
  if (pathname === routes.githubUser) {
    return {
      kind: 'simple-get',
      upstreamUrl: new URL(`/users/${PROFILE_NAME}`, GITHUB_API_HOST).toString(),
      ttlSeconds: CACHE_TTL_SECONDS.user,
      maxStaleSeconds: MAX_STALE_SECONDS.user,
      cacheKey: 'https://cache.internal/rustatian-me/user-v1',
      transform: transformUser,
    };
  }

  if (pathname === routes.githubContributions) {
    return {
      kind: 'graphql-post',
      upstreamUrl: new URL('/graphql', GITHUB_API_HOST).toString(),
      // One refresh per day: the GitHub calendar rolls over at UTC midnight and
      // the grid is purely decorative between rollovers.
      ttlSeconds: CACHE_TTL_SECONDS.contributions,
      maxStaleSeconds: MAX_STALE_SECONDS.contributions,
      cacheKey: 'https://cache.internal/rustatian-me/contributions-v1',
      body: JSON.stringify({
        query: CONTRIBUTIONS_QUERY,
        variables: { login: PROFILE_NAME },
      }),
      transform: transformContributions,
    };
  }

  return null;
};

const upstreamErrorResponse = (error: unknown, requestId: string): Response => {
  // Body and GraphQL failures arrive with HTTP 200, so only an upstream HTTP
  // error names a status. GitHub's GraphQL error text enumerates the scopes
  // the site's own token holds, so the message is synthesized; the raw text
  // stays in the log.
  const message =
    error instanceof UpstreamRequestError
      ? error.reason === 'http'
        ? `GitHub upstream responded with status ${error.status}`
        : 'GitHub upstream returned an unexpected response'
      : error instanceof GraphQLResponseError
        ? 'GitHub GraphQL request failed'
        : 'Failed to fetch GitHub upstream resource';
  return buildApiErrorResponse(502, 'UPSTREAM_ERROR', message, requestId);
};

// Lookup, freshness, refresh, store and stale fallback for one route. The
// `x-edge-expires-at` stamp and `maxStaleSeconds` are written and read here only.
const serveCachedUpstream = async (
  route: UpstreamRoute,
  requestId: string,
  githubToken?: string,
): Promise<Response> => {
  const cache = await caches.open(CACHE_NAME);
  const cacheRequest = new Request(route.cacheKey, { method: 'GET' });
  const cached = await cache.match(cacheRequest);
  // The stored copy carries the edge retention window; browsers get the TTL.
  const clientCacheControl = `public, max-age=${route.ttlSeconds}`;
  let staleResponse: Response | null = null;

  if (cached) {
    const expiresAt = Number(cached.headers.get(CACHE_EXPIRES_HEADER) ?? '0');
    const now = Date.now();

    if (Number.isFinite(expiresAt) && expiresAt > now) {
      return cloneResponseWithHeaders(cached, {
        'cache-control': clientCacheControl,
        [CACHE_STATUS_HEADER]: 'HIT',
        [REQUEST_ID_HEADER]: requestId,
      });
    }

    if (now - expiresAt <= route.maxStaleSeconds * 1000) {
      staleResponse = cached;
    }
  }

  if (route.kind === 'graphql-post' && !githubToken) {
    // GraphQL always requires a token; fail fast rather than burning a
    // request we know GitHub will reject.
    return buildApiErrorResponse(
      502,
      'UPSTREAM_ERROR',
      'GitHub authentication token is not configured',
      requestId,
    );
  }

  const upstreamHeaders: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'rustatian.me/edge-proxy',
  };
  if (githubToken) {
    upstreamHeaders.Authorization = `Bearer ${githubToken}`;
  }

  const requestInit: RequestInit =
    route.kind === 'graphql-post'
      ? {
          method: 'POST',
          headers: { ...upstreamHeaders, 'Content-Type': 'application/json' },
          body: route.body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }
      : {
          method: 'GET',
          headers: upstreamHeaders,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        };

  try {
    const upstreamResponse = await fetch(route.upstreamUrl, requestInit);

    if (!upstreamResponse.ok) {
      throw new UpstreamRequestError(upstreamResponse.status);
    }

    const body = route.transform(await upstreamResponse.text());
    const headers = new Headers({
      'content-type': JSON_CONTENT_TYPE,
      'cache-control': clientCacheControl,
      [CACHE_EXPIRES_HEADER]: String(Date.now() + route.ttlSeconds * 1000),
      [CACHE_STATUS_HEADER]: 'MISS',
      [REQUEST_ID_HEADER]: requestId,
    });
    applySecurityHeaders(headers, false);

    // Cloudflare evicts on the *stored* cache-control, so the stored copy must
    // outlive the freshness deadline by the stale window.
    const cacheHeaders = new Headers(headers);
    cacheHeaders.set(
      'cache-control',
      `public, max-age=${route.ttlSeconds + route.maxStaleSeconds}`,
    );
    await cache.put(cacheRequest, new Response(body, { status: 200, headers: cacheHeaders }));
    return new Response(body, { status: 200, headers });
  } catch (error) {
    // Log every failure before deciding whether to serve stale. A warm edge
    // cache would otherwise mask schema drift or auth failures forever: the
    // stale path is silent at the HTTP level.
    const logPayload: Record<string, unknown> = {
      type:
        error instanceof GraphQLResponseError
          ? 'upstream-graphql-error'
          : error instanceof UpstreamRequestError
            ? 'upstream-http-error'
            : 'upstream-fetch-failure',
      requestId,
      route: route.upstreamUrl,
      servedStale: staleResponse !== null,
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    };
    if (error instanceof GraphQLResponseError) {
      logPayload.graphqlErrors = error.graphqlErrors;
    } else if (error instanceof UpstreamRequestError) {
      logPayload.upstreamStatus = error.status;
      logPayload.reason = error.reason;
      if (error.issues !== undefined) logPayload.issues = error.issues;
    }
    console.error(JSON.stringify(logPayload));

    if (staleResponse) {
      return cloneResponseWithHeaders(staleResponse, {
        'cache-control': clientCacheControl,
        [CACHE_STATUS_HEADER]: 'STALE',
        [REQUEST_ID_HEADER]: requestId,
      });
    }

    return upstreamErrorResponse(error, requestId);
  }
};

// Cap the body we log so a hostile UA can't flood logs with oversized reports.
const CSP_REPORT_MAX_CHARS = 2000;

const handleCspReportRequest = async (request: Request): Promise<Response> => {
  const requestId = crypto.randomUUID();

  if (request.method !== 'POST') {
    // RFC 9110 §15.5.6: a 405 MUST carry Allow.
    return buildApiErrorResponse(
      405,
      'METHOD_NOT_ALLOWED',
      'Only POST is supported for csp-report',
      requestId,
      { allow: 'POST' },
    );
  }

  if (!RATE_LIMIT_BUCKET.tryConsume(getClientIp(request))) {
    return buildRateLimitResponse(requestId);
  }

  try {
    const raw = (await request.text()).slice(0, CSP_REPORT_MAX_CHARS);
    let report: unknown;
    try {
      report = JSON.parse(raw);
    } catch {
      report = { rawPrefix: raw.slice(0, 200) };
    }
    console.warn(JSON.stringify({ type: 'csp-violation', requestId, report }));
  } catch (error) {
    console.warn(
      JSON.stringify({
        type: 'csp-report-drop',
        requestId,
        error:
          error instanceof Error ? { name: error.name, message: error.message } : String(error),
      }),
    );
  }

  const headers = new Headers({
    'cache-control': 'no-store',
    [REQUEST_ID_HEADER]: requestId,
  });
  applySecurityHeaders(headers, false);
  return new Response(null, { status: 204, headers });
};

const handleGitHubApiRequest = async (request: Request, env: Env): Promise<Response> => {
  const requestId = crypto.randomUUID();

  const clientIp = getClientIp(request);
  if (!RATE_LIMIT_BUCKET.tryConsume(clientIp)) {
    return buildRateLimitResponse(requestId);
  }

  if (request.method !== 'GET') {
    // RFC 9110 §15.5.6: a 405 MUST carry Allow.
    return buildApiErrorResponse(
      405,
      'METHOD_NOT_ALLOWED',
      'Only GET is supported for this endpoint',
      requestId,
      { allow: 'GET' },
    );
  }

  const route = resolveGitHubRoute(new URL(request.url).pathname);

  if (!route) {
    return buildApiErrorResponse(404, 'NOT_FOUND', 'Endpoint not found', requestId);
  }

  return serveCachedUpstream(route, requestId, env.GITHUB_TOKEN);
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === CSP_REPORT_PATH) {
      return handleCspReportRequest(request);
    }

    if (url.pathname.startsWith(API_BASE_PATH)) {
      return handleGitHubApiRequest(request, env);
    }

    if (isStaticAssetPath(url.pathname)) {
      const assetResponse = await env.ASSETS.fetch(request);
      return buildResponseWithSecurityHeaders(assetResponse);
    }

    if (request.method === 'GET') {
      try {
        const assetResponse = await env.ASSETS.fetch(request);

        // Only a genuine miss may fall through to the SPA shell. `.ok` would also
        // swallow the 3xx the asset server issues for extensionless directory
        // paths (/about -> /about/) and the 304 it issues on revalidation, both
        // of which must reach the client untouched.
        if (assetResponse.status !== 404) {
          return buildResponseWithSecurityHeaders(assetResponse);
        }

        // Genuine miss: serve the prerendered 404 shell with a real 404 status.
        // Returning the home page with a 200 made every unknown URL — and every
        // scanner probe — look like a live duplicate of `/` to crawlers.
        //
        // Fresh request rather than a clone: copying the caller's conditional
        // headers here lets If-None-Match 304 the shell fetch, which would then
        // read as a miss and produce a bare error page.
        const notFoundResponse = await env.ASSETS.fetch(new Request(new URL('/404/', url.origin)));

        if (notFoundResponse.ok) {
          return buildResponseWithSecurityHeaders(notFoundResponse, {
            overrideStatus: 404,
            extraHeaders: {
              'content-type': 'text/html; charset=UTF-8',
            },
          });
        }

        return buildTextErrorResponse(404, 'Not Found');
      } catch (error) {
        console.error('Navigation request error:', error);
        return buildTextErrorResponse(500, 'Internal Server Error');
      }
    }

    const response = await env.ASSETS.fetch(request);
    return buildResponseWithSecurityHeaders(response);
  },
};
