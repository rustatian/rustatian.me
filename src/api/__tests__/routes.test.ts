import { describe, expect, it } from 'vitest';
import { routes } from '../routes';

describe('routes', () => {
  it('points githubUser at the user data file', () => {
    expect(routes.githubUser).toBe('/api/v1/github/user');
  });

  it('points githubContributions at the contributions data file', () => {
    expect(routes.githubContributions).toBe('/api/v1/github/contributions');
  });
});
