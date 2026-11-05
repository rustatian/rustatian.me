import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getUser } from '../githubRequests';

const mockFetch = vi.fn();
global.fetch = mockFetch as typeof fetch;

const validUserData = {
  login: 'testuser',
  id: 12345,
  node_id: 'MDQ6VXNlcjEyMzQ1',
  avatar_url: 'https://avatars.githubusercontent.com/u/12345',
  gravatar_id: null,
  url: 'https://api.github.com/users/testuser',
  html_url: 'https://github.com/testuser',
  followers_url: 'https://api.github.com/users/testuser/followers',
  following_url: 'https://api.github.com/users/testuser/following{/other_user}',
  gists_url: 'https://api.github.com/users/testuser/gists{/gist_id}',
  starred_url: 'https://api.github.com/users/testuser/starred{/owner}{/repo}',
  subscriptions_url: 'https://api.github.com/users/testuser/subscriptions',
  organizations_url: 'https://api.github.com/users/testuser/orgs',
  repos_url: 'https://api.github.com/users/testuser/repos',
  events_url: 'https://api.github.com/users/testuser/events{/privacy}',
  received_events_url: 'https://api.github.com/users/testuser/received_events',
  type: 'User',
  site_admin: false,
  name: 'Test User',
  company: 'Test Company',
  blog: 'https://testuser.dev',
  location: 'San Francisco',
  email: null,
  hireable: true,
  bio: 'A test user',
  twitter_username: 'testuser',
  public_repos: 42,
  public_gists: 10,
  followers: 100,
  following: 50,
  created_at: '2020-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
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

    it('passes through extra fields (loose schema)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ...validUserData, some_new_field: 'new value' }),
      });

      const user = await getUser();
      expect((user as Record<string, unknown>).some_new_field).toBe('new value');
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
