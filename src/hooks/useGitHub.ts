import { useQuery } from '@tanstack/react-query';
import { CACHE_TTL_SECONDS } from '@/api/cachePolicy';
import { getContributions } from '@/api/contributions';
import { getUser } from '@/api/githubRequests';

// Retaining past the last observer is browser-only on purpose. React Query's
// server default is `Infinity`, which schedules no timer; any finite value
// passes its `isValidTimeout` check and schedules a bare `setTimeout` with no
// `unref`, which keeps Node's event loop alive and hangs the SSG prerender pass
// (the prerender does mount these queries). A previous attempt at this had to be
// reverted for exactly that reason.
const clientGcTime = (ms: number) => (typeof window === 'undefined' ? {} : { gcTime: ms });

export const useGitHubUser = () =>
  useQuery({
    queryKey: ['github-user'],
    queryFn: getUser,
    staleTime: CACHE_TTL_SECONDS.user * 1000,
    ...clientGcTime(CACHE_TTL_SECONDS.user * 1000),
  });

export const useGitHubContributions = () =>
  useQuery({
    queryKey: ['github-contributions'],
    queryFn: getContributions,
    staleTime: CACHE_TTL_SECONDS.contributions * 1000,
    // Without this the entry is garbage-collected 5 minutes after Home unmounts,
    // so navigating to /about and back refetches and re-renders the skeleton —
    // defeating the whole point of the long staleTime.
    ...clientGcTime(CACHE_TTL_SECONDS.contributions * 1000),
  });
