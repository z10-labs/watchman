import {
  NotFoundError,
  type ChangedFile,
  type CheckRunInput,
  type GitHubApi,
  type IssueComment,
} from '../../src/github/api';

export const HEAD_SHA = 'a3f9c11bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
export const NEXT_SHA = 'b7d20ffccccccccccccccccccccccccccccccccc';

/** A rubric that clears preflight: long enough, no placeholders, refusals declared. */
export const GOOD_RUBRIC = [
  '# Senior Watchman — rubric',
  '',
  'You review changes for strategic alignment with the product we said we were building.',
  'You judge the change against the vision, the architecture, and the decisions ledger,',
  'and you answer exactly one question: does this change still belong to that product?',
  '',
  '## Review scope',
  '',
  'Vision drift, architectural fit, decision conformance, scope, decision discipline,',
  'and cross-task impact. Each finding must carry a suggested action and a citable source.',
  '',
  '## Out of scope',
  '',
  'Code style, formatting, naming, syntax errors, type errors, unit-test coverage of edge',
  'cases, performance micro-optimisation. CI already produces those findings for free and',
  'deterministically. If you find yourself asking for one more test, you are doing the',
  'wrong job.',
].join('\n');

export const GOOD_CONFIG = [
  'version: 1',
  'brain:',
  '  path: docs/',
  '  required_reading:',
  '    - positioning.md',
  '    - architecture/overview.md',
  '  decisions: decisions/',
  'rubric: .watchman/rubric.md',
  'gate:',
  '  mode: advisory',
  '  max_diff_lines: 500',
  '  skip_paths:',
  '    - "**/*.snap"',
  '    - pnpm-lock.yaml',
].join('\n');

export function defaultFiles(): Map<string, string> {
  return new Map([
    ['.watchman.yml', GOOD_CONFIG],
    ['.watchman/rubric.md', GOOD_RUBRIC],
    ['docs/positioning.md', '# Positioning\n\nWho the product is for, and who pays.'],
    ['docs/architecture/overview.md', '# Architecture\n\nTenancy, auth, storage.'],
    ['docs/decisions/dec-001-tenancy.md', '# DEC-001\n\nTenant reads use the scoped client.'],
  ]);
}

export function changedFile(overrides: Partial<ChangedFile> = {}): ChangedFile {
  return {
    filename: 'src/billing/plan.ts',
    status: 'modified',
    additions: 20,
    deletions: 4,
    patch: '@@ -1 +1 @@\n-const a = 1;\n+const a = 2;',
    ...overrides,
  };
}

export interface RecordedCall {
  readonly kind: string;
  readonly args: unknown;
}

export interface FakeGitHub extends GitHubApi {
  readonly calls: RecordedCall[];
  readonly comments: Map<number, IssueComment>;
  readonly checkRuns: Map<number, CheckRunInput>;
  readonly files: Map<string, string>;
  changed: ChangedFile[];
  compared: ChangedFile[] | null;
  deleteComment(id: number): void;
  seedComment(body: string, appId: number | null): number;
  setHead(sha: string): void;
}

export function fakeGitHub(
  options: { appId?: number; headSha?: string; baseRef?: string } = {},
): FakeGitHub {
  const calls: RecordedCall[] = [];
  const comments = new Map<number, IssueComment>();
  const checkRuns = new Map<number, CheckRunInput>();
  const files = defaultFiles();
  const ourAppId = options.appId ?? 42;

  let head = options.headSha ?? HEAD_SHA;
  let nextId = 1000;

  const record = (kind: string, args: unknown) => calls.push({ kind, args });

  const api: FakeGitHub = {
    owner: 'z10labs',
    repo: 'tutorx',
    calls,
    comments,
    checkRuns,
    files,
    changed: [changedFile()],
    compared: null,

    deleteComment(id) {
      comments.delete(id);
    },

    seedComment(body, appId) {
      const id = (nextId += 1);
      comments.set(id, { id, body, appId });
      return id;
    },

    setHead(sha) {
      head = sha;
    },

    async getPullRequest(prNumber) {
      record('getPullRequest', { prNumber });
      return {
        headSha: head,
        baseRef: options.baseRef ?? 'main',
        title: 'feat: billing lifecycle',
        draft: false,
      };
    },

    async getDefaultBranch() {
      record('getDefaultBranch', {});
      return 'main';
    },

    async getFile(path) {
      record('getFile', { path });
      return files.get(path) ?? null;
    },

    async listDir(dir) {
      record('listDir', { dir });
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      return [...files.keys()].filter(
        (path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'),
      );
    },

    async listChangedFiles(prNumber) {
      record('listChangedFiles', { prNumber });
      return api.changed;
    },

    async compareCommits(base, headRef) {
      record('compareCommits', { base, head: headRef });
      return api.compared ?? api.changed;
    },

    async listIssueComments(prNumber) {
      record('listIssueComments', { prNumber });
      return [...comments.values()];
    },

    async createIssueComment(prNumber, body) {
      const id = (nextId += 1);
      comments.set(id, { id, body, appId: ourAppId });
      record('createIssueComment', { prNumber, id });
      return { id };
    },

    async updateIssueComment(commentId, body) {
      const existing = comments.get(commentId);
      if (!existing) throw new NotFoundError(`comment ${commentId} is gone`);
      comments.set(commentId, { ...existing, body });
      record('updateIssueComment', { commentId });
    },

    async createCheckRun(input) {
      const id = (nextId += 1);
      checkRuns.set(id, input);
      record('createCheckRun', { id, status: input.status });
      return { id };
    },

    async updateCheckRun(checkRunId, input) {
      if (!checkRuns.has(checkRunId)) throw new NotFoundError(`check run ${checkRunId} is gone`);
      checkRuns.set(checkRunId, input);
      record('updateCheckRun', {
        checkRunId,
        status: input.status,
        conclusion: input.conclusion,
      });
    },
  };

  return api;
}

export function pullRequestPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: 'opened',
    installation: { id: 7 },
    repository: { name: 'tutorx', owner: { login: 'z10labs' } },
    sender: { login: 'dzithendo', type: 'User' },
    pull_request: {
      number: 241,
      draft: false,
      title: 'feat: billing lifecycle',
      head: { sha: HEAD_SHA },
      base: { ref: 'main' },
    },
    ...overrides,
  };
}
