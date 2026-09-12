/**
 * The only surface of GitHub the spine is allowed to touch.
 *
 * Everything is scoped to one repository so call sites never repeat owner/repo,
 * and the whole interface is small enough to fake in a test — which is how the
 * sticky-comment behaviour gets verified without a network or an installation.
 */

export interface IssueComment {
  readonly id: number;
  readonly body: string | null;
  /** id of the GitHub App that authored it, when one did. */
  readonly appId: number | null;
}

export type CheckStatus = 'queued' | 'in_progress' | 'completed';

export type CheckConclusion =
  | 'success'
  | 'neutral'
  | 'failure'
  | 'action_required'
  | 'cancelled';

export interface CheckRunInput {
  readonly headSha: string;
  readonly status: CheckStatus;
  readonly conclusion?: CheckConclusion;
  readonly title: string;
  readonly summary: string;
}

export interface PullRequestRef {
  readonly headSha: string;
  readonly baseRef: string;
  readonly title: string;
  readonly draft: boolean;
}

/** One file in a pull request's diff. */
export interface ChangedFile {
  readonly filename: string;
  readonly status: string;
  readonly additions: number;
  readonly deletions: number;
  /** Absent for binary files and very large diffs. */
  readonly patch?: string;
}

export interface GitHubApi {
  readonly owner: string;
  readonly repo: string;

  getPullRequest(prNumber: number): Promise<PullRequestRef>;
  getDefaultBranch(): Promise<string>;

  /** null when the path does not exist on that ref. */
  getFile(path: string, ref: string): Promise<string | null>;
  /** Repo-relative paths inside a directory; empty when it does not exist. */
  listDir(path: string, ref: string): Promise<string[]>;

  listChangedFiles(prNumber: number): Promise<ChangedFile[]>;
  /** Files changed between two commits — the delta since the last verdict. */
  compareCommits(base: string, head: string): Promise<ChangedFile[]>;

  listIssueComments(prNumber: number): Promise<IssueComment[]>;
  createIssueComment(prNumber: number, body: string): Promise<{ id: number }>;
  /** Rejects with a `NotFoundError` when the comment has been deleted. */
  updateIssueComment(commentId: number, body: string): Promise<void>;

  createCheckRun(input: CheckRunInput): Promise<{ id: number }>;
  updateCheckRun(checkRunId: number, input: CheckRunInput): Promise<void>;
}

export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message = 'not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}
