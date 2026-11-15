import { z } from 'zod';

// The shapes of the GitHub data files that ghdata/main.go writes. ghdata projects each
// GitHub answer to these fields: its requests carry the site's token, and GitHub answers
// them with owner-only fields that must not reach a visitor. The client parses each file
// with its contract.

export const UserContract = z.object({
  login: z.string(),
  public_repos: z.number(),
  followers: z.number(),
  following: z.number(),
});
export type GitHubUser = z.infer<typeof UserContract>;

const ContribDaySchema = z.object({
  date: z.string(),
  count: z.number().int().nonnegative(),
  level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
});
export type ContribDay = z.infer<typeof ContribDaySchema>;
export type Level = ContribDay['level'];

export const ContributionsContract = z.object({
  totalContributions: z.number().int().nonnegative(),
  days: z.array(ContribDaySchema),
});
export type Contributions = z.infer<typeof ContributionsContract>;
