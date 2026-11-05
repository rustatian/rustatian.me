import { UserContract } from '../api/contracts';
import { UpstreamRequestError } from './errors';

// Projects GitHub's user payload through the wire contract, which keeps the
// four fields the UI reads and drops the rest.
//
// Required, not cosmetic: the upstream request carries the site's own token, and
// GitHub answers `GET /users/{login}` with its owner-only `private-user` schema
// whenever the caller is authenticated as that same user. A verbatim body
// publishes private-repo counts, disk usage, collaborator count, billing plan
// and 2FA status to every anonymous visitor, and the account's private email
// if the token ever gains `user` scope.
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

  const result = UserContract.safeParse(parsedJson);
  if (!result.success) {
    throw new UpstreamRequestError(200, 'schema', result.error.issues);
  }

  return JSON.stringify(result.data);
};
