import { Octokit } from 'octokit';
import type { GitHubApi } from './api';
import { octokitApi } from './octokit-api';

export interface TokenApiOptions {
  /** `GITHUB_API_URL` on a GitHub Enterprise runner. Defaults to api.github.com. */
  readonly baseUrl?: string;
  /** Transport override. Tests hand in a fake so the mapping is checked offline. */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * `GitHubApi` authenticated with a plain token — `GITHUB_TOKEN` in Actions.
 *
 * Same surface, same error handling as `installationApi`; only the credential
 * differs. The token is the workflow's, scoped by the `permissions` block of the
 * job that runs us, so what this client *can* do is decided in YAML a human
 * reviews, not in code the reviewer runs.
 */
export function tokenApi(
  token: string,
  owner: string,
  repo: string,
  options: TokenApiOptions = {},
): GitHubApi {
  const octokit = new Octokit({
    auth: token,
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(options.fetch ? { request: { fetch: options.fetch } } : {}),
  });
  return octokitApi(octokit, owner, repo);
}
