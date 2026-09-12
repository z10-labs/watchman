import { describe, expect, test } from 'vitest';
import { matchesPath, summarise } from '../src/engine/diff';
import { triage } from '../src/engine/triage';
import { decideTier, needsTriage } from '../src/policy/trigger';
import type { Trigger } from '../src/types';
import { changedFile } from './fixtures/github';

const diffOf = (paths: string[], perFile = 10) =>
  summarise(paths.map((filename) => changedFile({ filename, additions: perFile, deletions: 0 })));

const base = {
  forced: false,
  maxDiffLines: 500,
  diff: diffOf(['src/billing/plan.ts']),
};

describe('matchesPath', () => {
  test.each([
    ['**/*.snap', 'src/__snapshots__/a.snap', true],
    ['**/*.snap', 'a.snap', true],
    ['pnpm-lock.yaml', 'pnpm-lock.yaml', true],
    ['pnpm-lock.yaml', 'apps/web/pnpm-lock.yaml', false],
    ['**/migrations/**', 'db/migrations/001.sql', true],
    ['src/*.ts', 'src/a.ts', true],
    ['src/*.ts', 'src/nested/a.ts', false],
  ])('%s vs %s', (pattern, path, expected) => {
    expect(matchesPath(pattern, path)).toBe(expected);
  });
});

describe('summarise', () => {
  test('drops skipped paths before anything counts them', () => {
    const files = [
      changedFile({ filename: 'src/a.ts', additions: 10, deletions: 0 }),
      changedFile({ filename: 'pnpm-lock.yaml', additions: 4000, deletions: 3000 }),
    ];

    const summary = summarise(files, ['pnpm-lock.yaml']);

    expect(summary.paths).toEqual(['src/a.ts']);
    // A lockfile must not push a small change over the megadiff limit.
    expect(summary.lines).toBe(10);
  });
});

describe('decideTier', () => {
  test('a newly opened pull request is always fully reviewed', () => {
    expect(decideTier({ ...base, trigger: 'opened' }).tier).toBe('full');
  });

  test.each<Trigger>(['opened', 'reopened', 'ready_for_review'])('%s is full', (trigger) => {
    expect(decideTier({ ...base, trigger }).tier).toBe('full');
  });

  test('a megadiff is bounded rather than given a cheap clean bill', () => {
    const decision = decideTier({
      ...base,
      trigger: 'opened',
      diff: diffOf(['a.ts', 'b.ts'], 400),
    });

    expect(decision.tier).toBe('bounded');
    expect(decision.reason).toContain('over the 500 limit');
  });

  test('an empty diff after skip_paths costs nothing', () => {
    expect(decideTier({ ...base, trigger: 'opened', diff: summarise([], []) }).tier).toBe('skip');
  });

  test('a push that moved no strategic surface only refreshes the commit', () => {
    const decision = decideTier({
      ...base,
      trigger: 'synchronize',
      surfaceMoved: false,
      lastReviewedSha: 'abc1234',
    });

    expect(decision.tier).toBe('refresh');
  });

  test('a push that did move surface is reviewed incrementally', () => {
    expect(
      decideTier({
        ...base,
        trigger: 'synchronize',
        surfaceMoved: true,
        lastReviewedSha: 'abc1234',
      }).tier,
    ).toBe('incremental');
  });

  test('a push with no previous verdict has nothing to increment from', () => {
    expect(decideTier({ ...base, trigger: 'synchronize', surfaceMoved: true }).tier).toBe('full');
  });

  test('an explicit human request always gets the full pass', () => {
    const decision = decideTier({
      ...base,
      trigger: 'synchronize',
      forced: true,
      surfaceMoved: false,
      lastReviewedSha: 'abc1234',
    });

    expect(decision.tier).toBe('full');
  });

  test('only unforced pushes need triage', () => {
    expect(needsTriage('synchronize', false)).toBe(true);
    expect(needsTriage('synchronize', true)).toBe(false);
    expect(needsTriage('opened', false)).toBe(false);
  });
});

describe('triage', () => {
  test('docs, tests and snapshots never reach a model', async () => {
    const result = await triage(
      diffOf(['README.md', 'src/a.test.ts', 'src/__snapshots__/a.snap']),
    );

    expect(result.surfaceMoved).toBe(false);
    expect(result.usedModel).toBe(false);
  });

  test.each([
    'db/migrations/003_add_plan.sql',
    'src/auth/session.ts',
    'src/app/api/billing/route.ts',
    'package.json',
    'infra/main.tf',
  ])('%s is strategic surface, decided for free', async (path) => {
    const result = await triage(diffOf([path]));

    expect(result.surfaceMoved).toBe(true);
    expect(result.usedModel).toBe(false);
  });

  test('a new file counts as surface even where the path rules say nothing', async () => {
    const summary = summarise([changedFile({ filename: 'src/lib/thing.ts', status: 'added' })]);

    const result = await triage(summary);

    expect(result.surfaceMoved).toBe(true);
    expect(result.usedModel).toBe(false);
  });

  test('an ordinary edit falls through to the cheap model', async () => {
    let asked = 0;
    const result = await triage(diffOf(['src/lib/format.ts']), async () => {
      asked += 1;
      return false;
    });

    expect(asked).toBe(1);
    expect(result.usedModel).toBe(true);
    expect(result.surfaceMoved).toBe(false);
  });

  test('the model can escalate an ordinary-looking edit', async () => {
    const result = await triage(diffOf(['src/lib/format.ts']), async () => true);

    expect(result.surfaceMoved).toBe(true);
  });

  test('with no model configured, unknown paths are not escalated', async () => {
    const result = await triage(diffOf(['src/lib/format.ts']));

    expect(result.surfaceMoved).toBe(false);
    expect(result.usedModel).toBe(false);
  });
});
