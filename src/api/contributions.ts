import { type Contributions, ContributionsContract } from './contracts';
import { fetchJson } from './fetchJson';
import { routes } from './routes';

export const getContributions = async (): Promise<Contributions> =>
  fetchJson(routes.githubContributions, ContributionsContract);
