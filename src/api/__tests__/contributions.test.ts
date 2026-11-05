import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getContributions } from '../contributions';

const mockFetch = vi.fn();
global.fetch = mockFetch as typeof fetch;

const validResponse = {
  totalContributions: 1234,
  days: [
    { date: '2025-05-01', count: 0, level: 0 },
    { date: '2025-05-02', count: 3, level: 2 },
    { date: '2025-05-03', count: 12, level: 4 },
  ],
};

describe('getContributions', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches and validates contributions data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(validResponse),
    });

    const result = await getContributions();
    expect(result.totalContributions).toBe(1234);
    expect(result.days).toHaveLength(3);
    expect(result.days[0]).toEqual({ date: '2025-05-01', count: 0, level: 0 });
  });

  it('rejects a response missing totalContributions', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ days: [] }),
    });
    await expect(getContributions()).rejects.toThrow();
  });

  it('rejects a response with an invalid level value', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          totalContributions: 1,
          days: [{ date: '2025-05-01', count: 1, level: 5 }], // 5 is outside 0..4
        }),
    });
    await expect(getContributions()).rejects.toThrow();
  });

  it('rejects a response with a negative count', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          totalContributions: 1,
          days: [{ date: '2025-05-01', count: -1, level: 0 }],
        }),
    });
    await expect(getContributions()).rejects.toThrow();
  });

  it('hits the expected endpoint path', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(validResponse),
    });
    await getContributions();
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/github/contributions',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });
});
