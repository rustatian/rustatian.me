import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getUser } from '../githubRequests';

const mockFetch = vi.fn();
global.fetch = mockFetch as typeof fetch;

// The wire shape: the worker projects the upstream payload down to these four.
const validUserData = {
  login: 'testuser',
  public_repos: 42,
  followers: 100,
  following: 50,
};

describe('githubRequests', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getUser', () => {
    it('fetches and validates user data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(validUserData),
      });

      const user = await getUser();
      expect(user.login).toBe('testuser');
      expect(user.public_repos).toBe(42);
    });

    it('throws on missing required fields', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ login: 'test' }),
      });

      await expect(getUser()).rejects.toThrow();
    });
  });
});
