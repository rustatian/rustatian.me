import { z } from 'zod';

// Exceeds the worker's own 8s upstream budget so the proxy leg gets to fail
// first and return a real error, rather than the UI aborting a live request.
const REQUEST_TIMEOUT_MS = 10_000;

// The worker envelope carries more fields. Callers show only the message.
const ErrorEnvelopeSchema = z.object({
  error: z.object({ message: z.string() }),
});

const TIMEOUT_MESSAGE = 'Request timed out — check your connection';

// `AbortSignal.timeout()` rejects with a DOMException-flavored TimeoutError.
const isAbort = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');

const errorFromResponse = async (response: Response): Promise<Error> => {
  const fallbackMessage = `GitHub API error: ${response.status}`;

  try {
    const payload: unknown = await response.json();
    const parsed = ErrorEnvelopeSchema.safeParse(payload);
    if (parsed.success) return new Error(parsed.data.error.message);
    console.warn('Worker error envelope mismatch', { issues: parsed.error.issues, payload });
  } catch (error) {
    console.warn('Failed to parse the worker error body', error);
  }
  return new Error(fallbackMessage);
};

// Feature-detect so SSR / older test envs don't crash on missing
// `AbortSignal.timeout`. Modern browsers and Node 22+ support it natively.
const createTimeoutSignal = (): AbortSignal | undefined => {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  }
  return undefined;
};

// Browser `fetch` surfaces network-level failures (DNS, offline, CORS
// preflight, connection reset) as TypeError.
const errorFromFetchFailure = (error: unknown): Error => {
  if (isAbort(error)) return new Error(TIMEOUT_MESSAGE);
  if (error instanceof TypeError) return new Error('Network unreachable — check your connection');
  return new Error(error instanceof Error ? error.message : String(error));
};

export const fetchJson = async <T>(url: string, schema: z.ZodType<T>): Promise<T> => {
  const init: RequestInit = { headers: { Accept: 'application/json' } };
  const signal = createTimeoutSignal();
  if (signal) init.signal = signal;

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw errorFromFetchFailure(error);
  }

  if (!response.ok) {
    throw await errorFromResponse(response);
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
