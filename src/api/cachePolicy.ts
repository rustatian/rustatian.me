// How long the client treats the GitHub data as fresh.
export const CACHE_TTL_SECONDS = {
  user: 60 * 10,
  contributions: 60 * 60 * 24,
} as const;
