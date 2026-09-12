import { App, type Octokit } from 'octokit';
import {
  NotFoundError,
  type ChangedFile,
  type CheckRunInput,
  type GitHubApi,
  type IssueComment,
  type PullRequestRef,
} from './api';
import { CHECK_NAME } from '../webhook/router';

/**
 * The real client.
 *
 * `App.getInstallationOctokit` owns the credential dance we would otherwise
 * hand-roll: an RS256 app JWT, exchanged for a 1-hour installation token, cached
 * and refreshed per installation.
 */
export function createApp(appId: string, privateKey: string): App {
  return new App({ appId, privateKey });
}

export async function installationApi(
  app: App,
  installationId: number,
  owner: string,
  repo: string,
): Promise<GitHubApi> {
  return octokitApi(await app.getInstallationOctokit(installationId), owner, repo);
}

/**
 * `GitHubApi` over any authenticated Octokit.
 *
 * The hosted app and the CI job differ only in where the credential comes from
 * — an installation token or the workflow's `GITHUB_TOKEN`. Everything after
 * authentication, including the 404 → `NotFoundError` mapping the sticky upsert
 * relies on, is one implementation so the two deployments cannot drift.
 */
export function octokitApi(octokit: Octokit, owner: string, repo: string): GitHubApi {
  const notFound = (error: unknown): never => {
    if (typeof error === 'object' && error !== null && (error as { status?: number }).status === 404) {
      throw new NotFoundError();
    }
    throw error;
  };

  return {
    owner,
    repo,

    async getPullRequest(prNumber: number): Promise<PullRequestRef> {
      const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
      return {
        headSha: data.head.sha,
        baseRef: data.base.ref,
        title: data.title,
        draft: data.draft ?? false,
      };
    },

    async getDefaultBranch(): Promise<string> {
      const { data } = await octokit.rest.repos.get({ owner, repo });
      return data.default_branch;
    },

    async getFile(path: string, ref: string): Promise<string | null> {
      try {
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref });
        if (Array.isArray(data) || data.type !== 'file') return null;
        return Buffer.from(data.content, 'base64').toString('utf8');
      } catch (error) {
        if ((error as { status?: number }).status === 404) return null;
        throw error;
      }
    },

    async listDir(path: string, ref: string): Promise<string[]> {
      try {
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref });
        if (!Array.isArray(data)) return [];
        return data.filter((entry) => entry.type === 'file').map((entry) => entry.path);
      } catch (error) {
        if ((error as { status?: number }).status === 404) return [];
        throw error;
      }
    },

    async listChangedFiles(prNumber: number): Promise<ChangedFile[]> {
      const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      });
      return files.map((file) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        ...(file.patch ? { patch: file.patch } : {}),
      }));
    },

    async compareCommits(base: string, head: string): Promise<ChangedFile[]> {
      const { data } = await octokit.rest.repos.compareCommitsWithBasehead({
        owner,
        repo,
        basehead: `${base}...${head}`,
      });
      return (data.files ?? []).map((file) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        ...(file.patch ? { patch: file.patch } : {}),
      }));
    },

    async listIssueComments(prNumber: number): Promise<IssueComment[]> {
      const comments = await octokit.paginate(octokit.rest.issues.listComments, {
        owner,
        repo,
        issue_number: prNumber,
        per_page: 100,
      });
      return comments.map((c) => ({
        id: c.id,
        body: c.body ?? null,
        appId: c.performed_via_github_app?.id ?? null,
      }));
    },

    async createIssueComment(prNumber: number, body: string) {
      const { data } = await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body,
      });
      return { id: data.id };
    },

    async updateIssueComment(commentId: number, body: string) {
      try {
        await octokit.rest.issues.updateComment({ owner, repo, comment_id: commentId, body });
      } catch (error) {
        notFound(error);
      }
    },

    async createCheckRun(input: CheckRunInput) {
      const { data } = await octokit.rest.checks.create({
        owner,
        repo,
        name: CHECK_NAME,
        head_sha: input.headSha,
        status: input.status,
        ...(input.conclusion ? { conclusion: input.conclusion } : {}),
        output: { title: input.title, summary: input.summary },
      });
      return { id: data.id };
    },

    async updateCheckRun(checkRunId: number, input: CheckRunInput) {
      try {
        await octokit.rest.checks.update({
          owner,
          repo,
          check_run_id: checkRunId,
          status: input.status,
          ...(input.conclusion ? { conclusion: input.conclusion } : {}),
          output: { title: input.title, summary: input.summary },
        });
      } catch (error) {
        notFound(error);
      }
    },
  };
}
