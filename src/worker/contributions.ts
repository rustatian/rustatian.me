import { z } from 'zod';
import type { Contributions } from '../api/contracts';
import { GraphQLResponseError, UpstreamRequestError } from './errors';

// GitHub's `contributionLevel` enum values mapped to our intensity scale.
// Keys are the exact GraphQL enum names — do not lowercase.
const LEVEL_MAP = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
} as const satisfies Record<string, 0 | 1 | 2 | 3 | 4>;

const ContributionLevelSchema = z.enum([
  'NONE',
  'FIRST_QUARTILE',
  'SECOND_QUARTILE',
  'THIRD_QUARTILE',
  'FOURTH_QUARTILE',
]);

// Application-level failure — GitHub returned HTTP 200 but the body contains
// a non-empty `errors` array (bad credentials, missing scope, rate limit).
// Matches regardless of whether `data` is present, since GraphQL allows both.
const GraphQLErrorResponseSchema = z.object({
  errors: z.array(z.object({ message: z.string() })).min(1),
});

// Success invariant — everything required for a valid calendar is present.
// Any deviation is schema drift (or the user genuinely not existing) and
// surfaces as a single 'schema' failure with the Zod issues for observability.
const GraphQLSuccessResponseSchema = z.object({
  data: z.object({
    user: z.object({
      contributionsCollection: z.object({
        contributionCalendar: z.object({
          totalContributions: z.number().int().nonnegative(),
          weeks: z.array(
            z.object({
              contributionDays: z.array(
                z.object({
                  date: z.string(),
                  contributionCount: z.number().int().nonnegative(),
                  contributionLevel: ContributionLevelSchema,
                }),
              ),
            }),
          ),
        }),
      }),
    }),
  }),
});

export const CONTRIBUTIONS_QUERY = `query ContribCal($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionCount
            contributionLevel
          }
        }
      }
    }
  }
}`;

// Flattens GraphQL weeks → chronological day array (oldest first, today last).
// `gridCellsFromDays` and `computeStreak` on the client rely on this ordering.
// Must throw one of `UpstreamRequestError` (malformed / schema drift) or
// `GraphQLResponseError` (application error surfaced in `errors[]`) so the
// worker's catch block can surface each distinctly.
export const transformContributions = (rawBody: string): string => {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    throw new UpstreamRequestError(200, 'parse');
  }

  // GraphQL allows data+errors simultaneously; surface application errors first.
  const errorResult = GraphQLErrorResponseSchema.safeParse(parsedJson);
  if (errorResult.success) {
    throw new GraphQLResponseError(errorResult.data.errors);
  }

  const result = GraphQLSuccessResponseSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new UpstreamRequestError(200, 'schema', result.error.issues);
  }

  const calendar = result.data.data.user.contributionsCollection.contributionCalendar;
  const body: Contributions = {
    totalContributions: calendar.totalContributions,
    days: calendar.weeks.flatMap(week =>
      week.contributionDays.map(day => ({
        date: day.date,
        count: day.contributionCount,
        level: LEVEL_MAP[day.contributionLevel],
      })),
    ),
  };
  return JSON.stringify(body);
};
