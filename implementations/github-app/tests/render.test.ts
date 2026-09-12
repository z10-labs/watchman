import { describe, expect, test } from 'vitest';
import { conclusionFor } from '../src/github/checks';
import { renderComment } from '../src/render/comment';
import type { Finding, Verdict, VerdictStatus } from '../src/types';

const AT = new Date('2026-09-03T14:06:00Z');

const base = {
  owner: 'z10labs',
  repo: 'tutorx',
  prNumber: 241,
  headSha: 'a3f9c11bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  updatedAt: AT,
};

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  fingerprint: 'fp1',
  severity: 'block',
  title: 'Tenant row read on the RLS-bypass handle',
  body: 'getTenantPlan() resolves through the service-role client.',
  suggestedAction: 'fix in this PR',
  source: 'DEC-014, src/billing/plan.ts:42',
  ...overrides,
});

const verdict = (overrides: Partial<Verdict> = {}): Verdict => ({
  status: 'strategic_blocker',
  findings: [finding()],
  bottomLine: 'Not until the tenant read moves back onto the request-scoped client.',
  receipt: {
    documentsRead: ['positioning.md', 'architecture/overview.md'],
    decisionCount: 14,
    rubricSha: '9f2c1a4b',
  },
  ...overrides,
});

describe('renderComment', () => {
  test('shows a reviewing state before the engine has run', () => {
    const body = renderComment({ ...base, state: { kind: 'reviewing' } });

    expect(body).toContain('🟡 Reviewing');
    expect(body).toContain('`a3f9c11`');
    expect(body).toContain('14:06');
  });

  test('counts findings by severity in the summary row', () => {
    const body = renderComment({
      ...base,
      state: {
        kind: 'verdict',
        verdict: verdict({
          findings: [finding(), finding({ severity: 'warn' }), finding({ severity: 'warn' })],
        }),
      },
    });

    expect(body).toContain('1 block · 2 warn');
  });

  test('renders every finding with its action and its source', () => {
    const body = renderComment({ ...base, state: { kind: 'verdict', verdict: verdict() } });

    expect(body).toContain('Tenant row read on the RLS-bypass handle');
    expect(body).toContain('*Suggested action:* fix in this PR');
    expect(body).toContain('*Source:* DEC-014, src/billing/plan.ts:42');
  });

  test('prints the receipt — what it read, and which rubric', () => {
    const body = renderComment({ ...base, state: { kind: 'verdict', verdict: verdict() } });

    expect(body).toContain('positioning.md · architecture/overview.md');
    expect(body).toContain('14 decision files');
    expect(body).toContain('rubric sha `9f2c1a4b`');
  });

  test('says nothing was read when nothing was read', () => {
    const body = renderComment({
      ...base,
      state: {
        kind: 'verdict',
        verdict: verdict({
          status: 'unconfigured',
          findings: [],
          receipt: { documentsRead: [], decisionCount: 0, rubricSha: 'none' },
        }),
      },
    });

    expect(body).toContain('⛔ Not configured');
    expect(body).toContain('read: no documents');
  });

  test('surfaces a failed review instead of going quiet', () => {
    const body = renderComment({
      ...base,
      state: { kind: 'error', message: 'model request timed out' },
    });

    expect(body).toContain('⛔ Review failed');
    expect(body).toContain('model request timed out');
    expect(body).toContain('/watchman review');
  });

  test('prints what the review cost, so the trade stays visible', () => {
    const body = renderComment({
      ...base,
      state: {
        kind: 'verdict',
        verdict: verdict({ stats: { diffLines: 318, durationMs: 71_000, costCents: 11 } }),
      },
    });

    expect(body).toContain('318 lines reviewed');
    expect(body).toContain('71s');
    expect(body).toContain('$0.11');
  });

  test('omits the stats line entirely when there is nothing to report', () => {
    const body = renderComment({ ...base, state: { kind: 'verdict', verdict: verdict() } });

    expect(body).not.toContain('lines reviewed');
  });

  test.each<[VerdictStatus, string]>([
    ['clean', '🟢 Clean'],
    ['soft_warnings', '🟠 Soft warnings'],
    ['strategic_blocker', '🔴 Strategic blocker'],
    ['bounded', '🟠 Too large to review'],
    ['skipped', '⚪ No strategic surface'],
  ])('renders %s as %s', (status, cell) => {
    const body = renderComment({
      ...base,
      state: { kind: 'verdict', verdict: verdict({ status, findings: [] }) },
    });

    expect(body).toContain(cell);
  });
});

describe('conclusionFor', () => {
  test('a clean or skipped review passes the check', () => {
    expect(conclusionFor(verdict({ status: 'clean' }), 'advisory')).toBe('success');
    expect(conclusionFor(verdict({ status: 'skipped' }), 'advisory')).toBe('success');
  });

  test('a blocker is neutral while the gate is advisory', () => {
    expect(conclusionFor(verdict({ status: 'strategic_blocker' }), 'advisory')).toBe('neutral');
  });

  test('the same blocker gates the merge once the team turns it on', () => {
    expect(conclusionFor(verdict({ status: 'strategic_blocker' }), 'required')).toBe(
      'action_required',
    );
  });

  test('a broken installation fails the check in either mode', () => {
    expect(conclusionFor(verdict({ status: 'unconfigured' }), 'advisory')).toBe('failure');
    expect(conclusionFor(verdict({ status: 'unconfigured' }), 'required')).toBe('failure');
  });
});
