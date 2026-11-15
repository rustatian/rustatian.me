// ghdata/main.go writes the GitHub data files at these paths.
const API_BASE_PATH = '/api/v1/github';

export const routes = {
  githubUser: `${API_BASE_PATH}/user`,
  githubContributions: `${API_BASE_PATH}/contributions`,
} as const;
