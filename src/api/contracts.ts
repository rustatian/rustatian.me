import { z } from 'zod';

// The shapes that cross the worker-to-browser seam. The worker projects each
// upstream payload through its contract and the client parses the response
// with the same contract. `z.object` strips unknown keys, so the projection
// holds on both sides: upstream requests carry the site's token, and GitHub
// answers them with owner-only fields that must not reach a visitor.

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

// The worker's error envelope. The client shows `message`; `code` and
// `requestId` serve debugging with curl.
export const ErrorEnvelopeContract = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeContract>;
