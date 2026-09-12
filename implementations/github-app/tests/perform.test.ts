import { beforeEach, describe, expect, test } from 'vitest';
import { performReview } from '../src/jobs/perform';
import { createEngine } from '../src/engine/index';
import { toState, type ReviewState } from '../src/state/blob';
import type { ReviewRequest } from '../src/types';
import { blockingVerdict, cleanVerdict, fakeGenerate, type SpyEngine } from './fixtures/deps';
import { changedFile, fakeGitHub, HEAD_SHA, NEXT_SHA, type FakeGitHub } from './fixtures/github';

const request = (overrides: Partial<ReviewRequest> = {}): ReviewRequest => ({
  installationId: 7,
  owner: 'z10labs',
  repo: 'tutorx',
  prNumber: 241,
  headSha: HEAD_SHA,
  baseRef: 'main',
  trigger: 'opened',
  prKey: 'z10labs/tutorx#241',
  forced: false,
  ...overrides,
});

const deps = (spy?: SpyEngine, verdict = cleanVerdict) => ({
  engine: createEngine(fakeGenerate(verdict, spy)),
  fallbackGateMode: 'advisory' as const,
});

const previousVerdict = (sha = HEAD_SHA): ReviewState =>
  toState(sha, { status: 'soft_warnings', findings: [], bottomLine: 'Watch the pagination.' }, 7);

describe('performReview', () => {
  let api: FakeGitHub;

  beforeEach(() => {
    api = fakeGitHub();
  });

  test('reviews a well-configured repository', async () => {
    const result = await performReview(request(), api, null, deps());

    expect(result.tier).toBe('full');
    expect(result.verdict.status).toBe('clean');
    expect(result.gateMode).toBe('advisory');
  });

  test('reads config from the default branch, never the pull request head', async () => {
    await performReview(request(), api, null, deps());

    const reads = api.calls.filter((call) => call.kind === 'getFile');
    expect(reads.length).toBeGreaterThan(0);
    expect(api.calls.map((call) => call.kind)).toContain('getDefaultBranch');
  });

  test('refuses instead of reviewing when the rubric is broken', async () => {
    api.files.set('.watchman/rubric.md', '# see README');
    const spy: SpyEngine = { prompts: [], calls: 0 };

    const result = await performReview(request(), api, null, deps(spy));

    expect(result.verdict.status).toBe('unconfigured');
    // The expensive call must not happen at all.
    expect(spy.calls).toBe(0);
  });

  test('refuses when a required document has moved', async () => {
    api.files.delete('docs/architecture/overview.md');

    const result = await performReview(request(), api, null, deps());

    expect(result.verdict.status).toBe('unconfigured');
    expect(result.verdict.findings[0]?.body).toContain('docs/architecture/overview.md');
  });

  test('a megadiff is bounded rather than waved through', async () => {
    api.changed = [changedFile({ additions: 400, deletions: 200 })];
    const spy: SpyEngine = { prompts: [], calls: 0 };

    const result = await performReview(request(), api, null, deps(spy));

    expect(result.tier).toBe('bounded');
    expect(result.verdict.status).toBe('bounded');
    expect(spy.calls).toBe(0);
  });

  test('skip_paths keep a lockfile from bounding a small change', async () => {
    api.changed = [
      changedFile({ filename: 'src/a.ts', additions: 10, deletions: 0 }),
      changedFile({ filename: 'pnpm-lock.yaml', additions: 4000, deletions: 3000 }),
    ];

    const result = await performReview(request(), api, null, deps());

    expect(result.tier).toBe('full');
  });

  test('a push touching only docs costs nothing and keeps the last verdict', async () => {
    api.changed = [changedFile({ filename: 'README.md' })];
    api.compared = [changedFile({ filename: 'README.md' })];
    const spy: SpyEngine = { prompts: [], calls: 0 };

    const result = await performReview(
      request({ trigger: 'synchronize', headSha: NEXT_SHA }),
      api,
      previousVerdict(),
      deps(spy),
    );

    expect(result.tier).toBe('refresh');
    expect(spy.calls).toBe(0);
    expect(result.verdict.bottomLine).toBe('Watch the pagination.');
    expect(result.verdict.status).toBe('soft_warnings');
  });

  test('a push touching schema is reviewed incrementally, on the delta', async () => {
    api.changed = [changedFile({ filename: 'src/a.ts' }), changedFile({ filename: 'src/b.ts' })];
    api.compared = [changedFile({ filename: 'db/migrations/002.sql' })];
    const spy: SpyEngine = { prompts: [], calls: 0 };

    const result = await performReview(
      request({ trigger: 'synchronize', headSha: NEXT_SHA }),
      api,
      previousVerdict(),
      deps(spy),
    );

    expect(result.tier).toBe('incremental');
    expect(spy.calls).toBe(1);
    // Only the delta went to the model, not the whole branch.
    expect(spy.prompts[0]?.variable).toContain('db/migrations/002.sql');
    expect(spy.prompts[0]?.variable).not.toContain('src/b.ts');
  });

  test('a forced review skips triage entirely', async () => {
    api.changed = [changedFile({ filename: 'README.md' })];
    const spy: SpyEngine = { prompts: [], calls: 0 };

    const result = await performReview(
      request({ trigger: 'command', forced: true }),
      api,
      previousVerdict(),
      deps(spy),
    );

    expect(result.tier).toBe('full');
    expect(spy.calls).toBe(1);
  });

  test('the gate mode comes from the repository, not from our defaults', async () => {
    api.files.set('.watchman.yml', api.files.get('.watchman.yml')!.replace('advisory', 'required'));

    const result = await performReview(request(), api, null, deps());

    expect(result.gateMode).toBe('required');
  });

  test('what the review cost is recorded on the state, cumulatively', async () => {
    const result = await performReview(request(), api, previousVerdict(), deps(undefined));

    expect(result.state.spentCents).toBe(7 + 11);
  });

  test('open findings are handed back to the next review by title', async () => {
    const first = await performReview(request(), api, null, deps(undefined, blockingVerdict));

    api.compared = [changedFile({ filename: 'src/auth/session.ts' })];
    const spy: SpyEngine = { prompts: [], calls: 0 };
    await performReview(
      request({ trigger: 'synchronize', headSha: NEXT_SHA }),
      api,
      first.state,
      deps(spy, blockingVerdict),
    );

    expect(spy.prompts[0]?.variable).toContain('Still open from your last verdict');
    expect(spy.prompts[0]?.variable).toContain('Tenant row read on the RLS-bypass handle');
  });
});
