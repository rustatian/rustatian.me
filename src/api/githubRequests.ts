import { z } from 'zod';
import { fetchJson } from './fetchJson';
import { routes } from './routes';

// Only the fields the UI actually reads. The earlier 30-field schema coupled
// the client to every upstream GitHub user bump — a new nullable field or a
// renamed `gravatar_id` would fire an error toast for data no user sees.
// `looseObject` lets upstream additions pass through; required keys guard
// the small set we genuinely depend on.
const GitHubUserSchema = z.looseObject({
  login: z.string(),
  public_repos: z.number(),
  followers: z.number(),
  following: z.number(),
});
export type GitHubUser = z.infer<typeof GitHubUserSchema>;

export const getUser = async (): Promise<GitHubUser> =>
  fetchJson(routes.githubUser, GitHubUserSchema);
