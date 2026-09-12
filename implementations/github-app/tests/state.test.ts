import { describe, expect, test } from 'vitest';
import { carryForward, readState, renderState, toState } from '../src/state/blob';
import type { Finding } from '../src/types';

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  fingerprint: 'abc123def456',
  severity: 'block',
  title: 'Tenant row read on the RLS-bypass handle',
  body: 'A paragraph.',
  suggestedAction: 'fix in this PR',
  source: 'DEC-001',
  ...overrides,
});

const state = () =>
  toState('a3f9c11', { status: 'strategic_blocker', findings: [finding()], bottomLine: 'No.' }, 11);

describe('the state blob', () => {
  test('round-trips through a comment body', () => {
    const body = `### Watchman\n\nsome markdown\n\n${renderState(state())}`;

    const read = readState(body);

    expect(read?.lastReviewedSha).toBe('a3f9c11');
    expect(read?.status).toBe('strategic_blocker');
    expect(read?.findings[0]?.title).toBe('Tenant row read on the RLS-bypass handle');
    expect(read?.spentCents).toBe(11);
  });

  test('is invisible in rendered markdown', () => {
    const rendered = renderState(state());

    expect(rendered.startsWith('<!--')).toBe(true);
    expect(rendered.endsWith('-->')).toBe(true);
  });

  test('carries enough to re-render a verdict without a database', () => {
    const read = readState(renderState(state()));

    expect(read?.findings[0]?.body).toBe('A paragraph.');
    expect(read?.findings[0]?.suggestedAction).toBe('fix in this PR');
    expect(read?.bottomLine).toBe('No.');
  });

  test('a comment with no blob simply has no history', () => {
    expect(readState('### Watchman\n\nno state here')).toBeNull();
    expect(readState(null)).toBeNull();
    expect(readState('')).toBeNull();
  });

  test('a mangled blob degrades to no history rather than breaking the review', () => {
    expect(readState('<!-- watchman:state:v1 {not json} -->')).toBeNull();
    expect(readState('<!-- watchman:state:v1 {"lastReviewedSha":')).toBeNull();
  });

  test('missing fields fall back rather than throwing', () => {
    const read = readState('<!-- watchman:state:v1 {"status":"clean"} -->');

    expect(read?.lastReviewedSha).toBe('');
    expect(read?.findings).toEqual([]);
    expect(read?.spentCents).toBe(0);
  });

  test('stays small enough for a comment body', () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      finding({ fingerprint: `fp${index}`, body: 'x'.repeat(400) }),
    );

    const rendered = renderState(
      toState('a3f9c11', { status: 'soft_warnings', findings: many, bottomLine: 'hm' }, 0),
    );

    // GitHub caps a comment body at 65,536 characters.
    expect(rendered.length).toBeLessThan(30_000);
  });
});

describe('carryForward', () => {
  test('a finding raised again keeps the commit it was first seen on', () => {
    const previous = readState(renderState(state()));

    const aged = carryForward([finding()], previous, 'b7d20ff');

    expect(aged[0]?.firstSeenSha).toBe('a3f9c11');
  });

  test('a genuinely new finding is dated to this commit', () => {
    const previous = readState(renderState(state()));

    const aged = carryForward([finding({ fingerprint: 'newfinding01' })], previous, 'b7d20ff');

    expect(aged[0]?.firstSeenSha).toBe('b7d20ff');
  });

  test('with no history, everything is new', () => {
    const aged = carryForward([finding()], null, 'b7d20ff');

    expect(aged[0]?.firstSeenSha).toBe('b7d20ff');
  });

  test('a resolved finding does not come back from the state', () => {
    const previous = readState(renderState(state()));

    expect(carryForward([], previous, 'b7d20ff')).toEqual([]);
  });
});

describe('spend', () => {
  test('accumulates rather than overwriting', () => {
    const first = toState('a3f9c11', { status: 'clean', findings: [], bottomLine: '' }, 11);
    const second = toState(
      'b7d20ff',
      { status: 'clean', findings: [], bottomLine: '' },
      first.spentCents + 9,
    );

    expect(second.spentCents).toBe(20);
  });
});
