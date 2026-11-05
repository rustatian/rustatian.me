import { type GitHubUser, UserContract } from './contracts';
import { fetchJson } from './fetchJson';
import { routes } from './routes';

export const getUser = async (): Promise<GitHubUser> => fetchJson(routes.githubUser, UserContract);
