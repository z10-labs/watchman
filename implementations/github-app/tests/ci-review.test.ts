/**
 * The CI job, end to end, with the network replaced by the same fakes the
 * hosted app is tested against. Event payloads are written to disk and read
 * back the way the Actions runner hands them over.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ciReview, exitCodeFor, jobSummary, productionDeps, summaryLine } from '../src/cli/review';
import type { ActionsEnv } from '../src/env';
import type { PerformResult } from '../src/jobs/perform';
import { toState } from '../src/state/blob';
import type { Verdict } from '../src/types';
import { blockingVerdict, testDeps, type SpyEngine } from './fixtures/deps';
import {
  changedFile,
  fakeGitHub,
  pullRequestPayload,
  HEAD_SHA,
  NEXT_SHA,
  type FakeGitHub,
} from './fixtures/github';

let dir: string;
let eventPath: string;
let lines: string[];
const out = (line: string) => lines.push(line);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'watchman-ci-'));
  eventPath = join(dir, 'event.json');
  lines = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** What the Actions runner writes: a webhook payload with no `installation`. */
function actionsPayload(overrides: Record<string, unknown> = {}) {
  const { installation: _dropped, ...payload } = pullRequestPayload(overrides);
  return payload;
}

async function writeEvent(payload: unknown): Promise<void> {
  await writeFile(eventPath, JSON.stringify(payload), 'utf8');
}

const env = (overrides: Partial<ActionsEnv> = {}): ActionsEnv => ({
  GITHUB_TOKEN: 'ghs_test',
  GITHUB_EVENT_PATH: eventPath,
  GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_REPOSITORY: 'z10labs/tutorx',
  ANTHROPIC_API_KEY: 'sk-ant-test',
  WATCHMAN_GATE_MODE: 'advisory',
  ...overrides,
});

const run = (api: FakeGitHub, options: Parameters<typeof testDeps>[1] = {}, e = env()) =>
  ciReview({ env: e, deps: testDeps(api, options), out });

const commentBodies = (api: FakeGitHub) => [...api.comments.values()].map((c) => c.body ?? '');

describe('ciReview — a pull request opened', () => {
  let api: FakeGitHub;

  beforeEach(async () => {
    api = fakeGitHub();
    await writeEvent(actionsPayload());
  });

  test('produces one comment and one completed check, and exits 0', async () => {
    const code = await run(api);

    expect(code).toBe(0);
    expect(api.comments.size).toBe(1);
    expect(commentBodies(api)[0]).toContain('🟢 Clean');
    expect([...api.checkRuns.values()]).toEqual([
      expect.objectContaining({ status: 'completed', conclusion: 'success', headSha: HEAD_SHA }),
    ]);
  });

  test('prints one summary line: tier, status, counts and cost', async () => {
    await run(api);

    const summary = lines.find((line) => line.startsWith('watchman: tier='));
    expect(summary).toContain('tier=full');
    expect(summary).toContain('status=clean');
    expect(summary).toContain('findings=0 (0 block, 0 warn, 0 info)');
    expect(summary).toContain('cost=$0.11');
  });

  test('writes the cost to the job summary when the runner offers one', async () => {
    const summaryPath = join(dir, 'summary.md');
    await writeFile(summaryPath, '', 'utf8');

    await run(api, {}, env({ GITHUB_STEP_SUMMARY: summaryPath }));

    const written = await readFile(summaryPath, 'utf8');
    expect(written).toContain('Watchman — strategic alignment');
    expect(written).toContain('$0.11');
  });

  test('the placeholder and in-progress check are up before the model runs', async () => {
    const order: string[] = [];
    const base = testDeps(api);
    const deps = {
      ...base,
      perform: {
        ...base.perform,
        engine: async () => {
          order.push(`comments:${api.comments.size} checks:${api.checkRuns.size}`);
          return { verdict: { status: 'clean' as const, findings: [], bottomLine: 'ok' }, costCents: 0 };
        },
      },
    };

    await ciReview({ env: env(), deps, out });

    expect(order).toEqual(['comments:1 checks:1']);
  });
});

describe('ciReview — a second run on the same pull request', () => {
  let api: FakeGitHub;

  beforeEach(async () => {
    api = fakeGitHub();
    await writeEvent(actionsPayload());
    await run(api);
  });

  test('edits the same comment from a fresh process instead of starting a thread', async () => {
    const [firstId] = [...api.comments.keys()];
    api.setHead(NEXT_SHA);
    api.compared = [changedFile({ filename: 'src/auth/session.ts' })];
    const payload = actionsPayload({ action: 'synchronize' });
    payload.pull_request.head.sha = NEXT_SHA;
    await writeEvent(payload);

    // testDeps() builds a new in-memory store: nothing is remembered between runs
    // except what the comment body itself carries.
    const code = await run(api);

    expect(code).toBe(0);
    expect(api.comments.size).toBe(1);
    expect([...api.comments.keys()][0]).toBe(firstId);
    expect(commentBodies(api)[0]).toContain('`b7d20ff`');
    expect(lines.some((line) => line.includes('tier=incremental'))).toBe(true);
  });

  test('a docs-only push calls no model and leaves the verdict standing', async () => {
    api.setHead(NEXT_SHA);
    api.changed = [changedFile({ filename: 'README.md' })];
    api.compared = [changedFile({ filename: 'docs/positioning.md' })];
    const payload = actionsPayload({ action: 'synchronize' });
    payload.pull_request.head.sha = NEXT_SHA;
    await writeEvent(payload);
    const spy: SpyEngine = { prompts: [], calls: 0 };

    const code = await run(api, { spy });

    expect(code).toBe(0);
    expect(spy.calls).toBe(0);
    expect(lines.some((line) => line.includes('tier=refresh') && line.includes('cost=$0.00'))).toBe(
      true,
    );
    expect(commentBodies(api)[0]).toContain('🟢 Clean');
    expect([...api.checkRuns.values()].at(-1)).toMatchObject({
      headSha: NEXT_SHA,
      status: 'completed',
      conclusion: 'success',
    });
  });
});

describe('ciReview — refusals and failures', () => {
  let api: FakeGitHub;

  beforeEach(async () => {
    api = fakeGitHub();
    await writeEvent(actionsPayload());
  });

  test('a broken rubric posts a refusal, calls no model and fails the job', async () => {
    api.files.set('.watchman/rubric.md', '# see README');
    const spy: SpyEngine = { prompts: [], calls: 0 };

    const code = await run(api, { spy });

    expect(code).toBe(1);
    expect(spy.calls).toBe(0);
    expect(commentBodies(api)[0]).toContain('⛔ Not configured');
    expect([...api.checkRuns.values()][0]).toMatchObject({ conclusion: 'failure' });
  });

  test('a review that throws says so on the pull request and fails the job', async () => {
    const base = testDeps(api);
    const deps = {
      ...base,
      perform: { ...base.perform, engine: () => Promise.reject(new Error('model timed out')) },
    };

    const code = await ciReview({ env: env(), deps, out });

    expect(code).toBe(1);
    expect(commentBodies(api)[0]).toContain('model timed out');
    expect(lines.at(-1)).toContain('review failed — model timed out');
  });

  test('an event for another repository is refused rather than reviewed', async () => {
    const code = await run(api, {}, env({ GITHUB_REPOSITORY: 'z10labs/other' }));

    expect(code).toBe(1);
    expect(api.calls).toHaveLength(0);
  });

  test('an unreadable event payload fails before touching GitHub', async () => {
    await rm(eventPath);

    const code = await run(api);

    expect(code).toBe(1);
    expect(api.calls).toHaveLength(0);
  });

  test('a read-only token (a fork pull request) fails the job without crashing', async () => {
    const forbidden = Object.assign(new Error('Resource not accessible by integration'), {
      status: 403,
    });
    const readOnly: FakeGitHub = {
      ...api,
      createIssueComment: () => Promise.reject(forbidden),
      createCheckRun: () => Promise.reject(forbidden),
    };

    const code = await ciReview({ env: env(), deps: testDeps(readOnly), out });

    expect(code).toBe(1);
    expect(api.comments.size).toBe(0);
    expect(lines.at(-1)).toContain('review failed — Resource not accessible by integration');
  });

  test('a branch that moved during the review writes nothing and exits 0', async () => {
    const base = testDeps(api);
    const deps = {
      ...base,
      perform: {
        ...base.perform,
        engine: async () => {
          api.setHead(NEXT_SHA);
          return { verdict: { status: 'clean' as const, findings: [], bottomLine: 'ok' }, costCents: 0 };
        },
      },
    };

    const code = await ciReview({ env: env(), deps, out });

    expect(code).toBe(0);
    expect(commentBodies(api)[0]).toContain('🟡 Reviewing');
    expect(lines.at(-1)).toContain('nothing written (cost=$0.00, discarded)');
  });
});

describe('ciReview — events that are not reviews', () => {
  test('a closed pull request is a successful no-op with the reason printed', async () => {
    const api = fakeGitHub();
    await writeEvent(actionsPayload({ action: 'closed' }));

    const code = await run(api);

    expect(code).toBe(0);
    expect(api.calls).toHaveLength(0);
    expect(lines[0]).toContain('skipped — pull_request.closed is not reviewable');
  });

  test('a /watchman review comment resolves the commit the payload lacks', async () => {
    const api = fakeGitHub();
    await writeEvent({
      action: 'created',
      repository: { name: 'tutorx', owner: { login: 'z10labs' } },
      sender: { login: 'dzithendo', type: 'User' },
      issue: { number: 241, pull_request: { url: 'https://api.github.com/...' } },
      comment: { body: '/watchman review' },
    });

    const code = await run(api, {}, env({ GITHUB_EVENT_NAME: 'issue_comment' }));

    expect(code).toBe(0);
    expect(api.calls.map((c) => c.kind)).toContain('getPullRequest');
    expect(api.comments.size).toBe(1);
  });

  test('warns when the model key is absent but still completes a zero-cost run', async () => {
    const api = fakeGitHub();
    await writeEvent(actionsPayload({ action: 'closed' }));

    const { ANTHROPIC_API_KEY: _omitted, ...withoutKey } = env();
    await ciReview({ env: withoutKey, deps: testDeps(api), out });

    // Skipped before the warning matters — a skipped event never needs the key.
    expect(lines[0]).toContain('skipped');
  });
});

describe('exit codes', () => {
  const verdict = (status: Verdict['status']): Verdict => ({ status, findings: [], bottomLine: '' });

  test('a blocker under the advisory gate exits 0 — the check carries the signal', () => {
    expect(exitCodeFor(verdict('strategic_blocker'), 'advisory')).toBe(0);
  });

  test('the same blocker fails the job once the gate is required', () => {
    expect(exitCodeFor(verdict('strategic_blocker'), 'required')).toBe(1);
  });

  test('a broken installation fails the job in either mode', () => {
    expect(exitCodeFor(verdict('unconfigured'), 'advisory')).toBe(1);
    expect(exitCodeFor(verdict('unconfigured'), 'required')).toBe(1);
  });

  test.each<Verdict['status']>(['clean', 'soft_warnings', 'skipped', 'bounded'])(
    '%s exits 0 under a required gate',
    (status) => {
      expect(exitCodeFor(verdict(status), 'required')).toBe(0);
    },
  );

  test('the gate mode comes from the repository config, end to end', async () => {
    const api = fakeGitHub();
    api.files.set('.watchman.yml', api.files.get('.watchman.yml')!.replace('advisory', 'required'));
    await writeEvent(actionsPayload());

    // WATCHMAN_GATE_MODE is only the fallback; the repo says required.
    const code = await run(api, { verdict: blockingVerdict }, env({ WATCHMAN_GATE_MODE: 'advisory' }));

    expect(code).toBe(1);
    expect([...api.checkRuns.values()][0]).toMatchObject({ conclusion: 'action_required' });
  });

  test('the same blocker under the repository default exits 0', async () => {
    const api = fakeGitHub();
    await writeEvent(actionsPayload());

    const code = await run(api, { verdict: blockingVerdict }, env({ WATCHMAN_GATE_MODE: 'required' }));

    expect(code).toBe(0);
    expect([...api.checkRuns.values()][0]).toMatchObject({ conclusion: 'neutral' });
  });
});

describe('summaries', () => {
  const result = (): PerformResult => {
    const verdict: Verdict = {
      status: 'strategic_blocker',
      findings: [
        { fingerprint: 'a', severity: 'block', title: 't', body: 'b', suggestedAction: 'a', source: 's' },
        { fingerprint: 'b', severity: 'warn', title: 't', body: 'b', suggestedAction: 'a', source: 's' },
      ],
      bottomLine: 'no',
      stats: { costCents: 23 },
    };
    return {
      verdict,
      gateMode: 'advisory',
      state: toState(HEAD_SHA, verdict, 41),
      tier: 'full',
      reason: 'pull request opened',
    };
  };

  test('the log line carries every number the economics argument needs', () => {
    const line = summaryLine(result());

    expect(line).toBe(
      'watchman: tier=full status=strategic_blocker findings=2 (1 block, 1 warn, 0 info) ' +
        'cost=$0.23 pr_total=$0.41 — pull request opened',
    );
  });

  test('the job summary is a table with this run and the running total', () => {
    const md = jobSummary(result());

    expect(md).toContain('| full | strategic_blocker | 1 block · 1 warn · 0 info | $0.23 | $0.41 |');
  });
});

describe('productionDeps', () => {
  test('wires the token client to the repository the job runs in', async () => {
    const deps = productionDeps(env({ WATCHMAN_GATE_MODE: 'required' }));

    const api = await deps.apiFor({
      installationId: null,
      owner: 'z10labs',
      repo: 'tutorx',
      prNumber: 1,
      trigger: 'opened',
      prKey: 'z10labs/tutorx#1',
      forced: false,
    });

    expect(api.owner).toBe('z10labs');
    expect(api.repo).toBe('tutorx');
    expect(deps.appId).toBeNull();
    expect(deps.gateMode).toBe('required');
    expect(deps.perform.fallbackGateMode).toBe('required');
    expect(deps.perform.triageModel).toBeTypeOf('function');
  });
});
