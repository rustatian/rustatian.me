// Single source for the cache windows the worker and the client both depend on.
// These were previously restated in each place with a comment claiming they
// matched; the user pair had already drifted (worker 600s vs client 300s), so
// the client refetched on a cadence the edge cache just absorbed.
export const CACHE_TTL_SECONDS = {
  user: 60 * 10,
  contributions: 60 * 60 * 24,
} as const;

// How long a stale entry may still be served when the upstream refresh fails.
export const MAX_STALE_SECONDS = {
  user: 60 * 60 * 24 * 7,
  contributions: 60 * 60 * 24 * 7,
} as const;
