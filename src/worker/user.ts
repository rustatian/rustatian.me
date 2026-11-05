import { z } from 'zod';
import { UpstreamRequestError } from './errors';

const GitHubUserResponseSchema = z.looseObject({
  login: z.string(),
  public_repos: z.number(),
  followers: z.number(),
  following: z.number(),
});

// Projects GitHub's user payload down to the four fields the UI reads.
//
// Required, not cosmetic: the upstream request carries the site's own token, and
// GitHub answers `GET /users/{login}` with its owner-only `private-user` schema
// whenever the caller is authenticated as that same user. Returning the body
// verbatim therefore published private-repo counts, disk usage, collaborator
// count, billing plan and 2FA status to every anonymous visitor — and would
// publish the account's private email if the token ever gained `user` scope.
//
// Mirrors `transformContributions`: throws `UpstreamRequestError` on schema
// drift so the worker's catch block can surface it distinctly.
export const transformUser = (rawBody: string): string => {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    throw new UpstreamRequestError(200, 'parse');
  }

  const result = GitHubUserResponseSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new UpstreamRequestError(200, 'schema', result.error.issues);
  }

  const { login, public_repos, followers, following } = result.data;
  return JSON.stringify({ login, public_repos, followers, following });
};
