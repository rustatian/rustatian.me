import type { z } from 'zod';

const REQUEST_TIMEOUT_MS = 10_000;

const TIMEOUT_MESSAGE = 'Request timed out — check your connection';

// `AbortSignal.timeout()` rejects with a DOMException-flavored TimeoutError.
const isAbort = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');

// Browser `fetch` surfaces network-level failures (DNS, offline, CORS
// preflight, connection reset) as TypeError.
const errorFromFetchFailure = (error: unknown): Error => {
  if (isAbort(error)) return new Error(TIMEOUT_MESSAGE);
  if (error instanceof TypeError) return new Error('Network unreachable — check your connection');
  return new Error(error instanceof Error ? error.message : String(error));
};

export const fetchJson = async <T>(url: string, schema: z.ZodType<T>): Promise<T> => {
  const init: RequestInit = {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw errorFromFetchFailure(error);
  }

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    // The timeout signal also covers the body stream, so an expiry that lands
    // mid-read rejects here rather than at the fetch() call above.
    if (isAbort(error)) throw new Error(TIMEOUT_MESSAGE);
    console.warn('Malformed JSON in API response', error);
    throw new Error('Received a malformed response from the server');
  }

  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    // Zod stringifies every issue into `message`, which is kilobytes of JSON and
    // reaches the UI verbatim. Keep the detail in the console.
    console.warn('API response schema mismatch', { issues: parsed.error.issues, data });
    throw new Error('Received an unexpected response from the server');
  }

  return parsed.data;
};
