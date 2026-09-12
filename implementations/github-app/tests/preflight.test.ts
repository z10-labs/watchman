import { beforeEach, describe, expect, test } from 'vitest';
import { loadConfig } from '../src/config/load';
import type { DocSource } from '../src/github/content';
import { MIN_RUBRIC_CHARS, preflight } from '../src/preflight/index';
import { refusalVerdict } from '../src/preflight/refusal';
import { conclusionFor } from '../src/github/checks';
import { defaultFiles, GOOD_CONFIG, GOOD_RUBRIC } from './fixtures/github';

function docSource(files: Map<string, string>): DocSource {
  return {
    describe: 'test-repo@main',
    async read(path) {
      return files.get(path) ?? null;
    },
    async list(dir) {
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      return [...files.keys()].filter(
        (path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'),
      );
    },
  };
}

const problemsOf = (result: { ok: boolean; problems?: readonly string[] }) =>
  (result.problems ?? []).join('\n');

describe('loadConfig', () => {
  let files: Map<string, string>;

  beforeEach(() => {
    files = defaultFiles();
  });

  test('reads a valid config', async () => {
    const result = await loadConfig(docSource(files));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.brain.required_reading).toEqual([
      'positioning.md',
      'architecture/overview.md',
    ]);
    expect(result.config.gate.max_diff_lines).toBe(500);
  });

  test('accepts the .yaml spelling too', async () => {
    files.delete('.watchman.yml');
    files.set('.watchman.yaml', GOOD_CONFIG);

    expect((await loadConfig(docSource(files))).ok).toBe(true);
  });

  test('refuses a repository with no config rather than assuming defaults', async () => {
    files.delete('.watchman.yml');

    const result = await loadConfig(docSource(files));
    expect(result.ok).toBe(false);
    expect(problemsOf(result)).toContain('No `.watchman.yml`');
  });

  test('reports malformed YAML with the parser message', async () => {
    files.set('.watchman.yml', 'version: 1\nbrain: [unclosed');

    const result = await loadConfig(docSource(files));
    expect(result.ok).toBe(false);
    expect(problemsOf(result)).toContain('not valid YAML');
  });

  test('names the field when the config is the wrong shape', async () => {
    files.set('.watchman.yml', 'version: 1\nrubric: r.md\nbrain:\n  required_reading: []');

    const result = await loadConfig(docSource(files));
    expect(result.ok).toBe(false);
    expect(problemsOf(result)).toContain('brain.required_reading');
  });
});

describe('preflight', () => {
  let files: Map<string, string>;

  beforeEach(() => {
    files = defaultFiles();
  });

  test('passes a properly configured repository and reports what it read', async () => {
    const result = await preflight(docSource(files));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.documentsRead).toEqual([
      'docs/positioning.md',
      'docs/architecture/overview.md',
    ]);
    expect(result.receipt.decisionCount).toBe(1);
    expect(result.receipt.rubricSha).toHaveLength(8);
  });

  test('the rubric hash changes when the rubric does', async () => {
    const before = await preflight(docSource(files));
    files.set('.watchman/rubric.md', `${GOOD_RUBRIC}\n\nOne more rule.`);
    const after = await preflight(docSource(files));

    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    expect(after.receipt.rubricSha).not.toBe(before.receipt.rubricSha);
  });

  test('refuses when the rubric file is missing', async () => {
    files.delete('.watchman/rubric.md');

    const result = await preflight(docSource(files));
    expect(result.ok).toBe(false);
    expect(problemsOf(result)).toContain('no instructions');
  });

  test('refuses a rubric too short to be real — the four-day failure', async () => {
    files.set('.watchman/rubric.md', '# Watchman\n\nSee the README.');

    const result = await preflight(docSource(files));
    expect(result.ok).toBe(false);
    expect(problemsOf(result)).toContain(String(MIN_RUBRIC_CHARS));
  });

  test('refuses a rubric with the adoption placeholders still in it', async () => {
    files.set('.watchman/rubric.md', GOOD_RUBRIC.replace('the product', '<PRODUCT>'));

    const result = await preflight(docSource(files));
    expect(result.ok).toBe(false);
    expect(problemsOf(result)).toContain('<PRODUCT>');
  });

  test('refuses a rubric with no out-of-scope section', async () => {
    const noRefusals = GOOD_RUBRIC.replace('## Out of scope', '## More things to check');

    files.set('.watchman/rubric.md', noRefusals);

    const result = await preflight(docSource(files));
    expect(result.ok).toBe(false);
    expect(problemsOf(result)).toContain('defined by its refusals');
  });

  test('refuses when required reading has moved — prompt rot, caught', async () => {
    files.delete('docs/architecture/overview.md');

    const result = await preflight(docSource(files));
    expect(result.ok).toBe(false);
    expect(problemsOf(result)).toContain('docs/architecture/overview.md');
  });

  test('reports every problem at once rather than one per push', async () => {
    files.delete('docs/positioning.md');
    files.delete('docs/architecture/overview.md');
    files.set('.watchman/rubric.md', 'too short');

    const result = await preflight(docSource(files));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.length).toBeGreaterThanOrEqual(3);
  });

  test('an empty decisions ledger is reported, not fatal', async () => {
    files.delete('docs/decisions/dec-001-tenancy.md');

    const result = await preflight(docSource(files));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.decisionCount).toBe(0);
  });
});

describe('refusalVerdict', () => {
  test('is never mistakable for a passing review', () => {
    const verdict = refusalVerdict(['Rubric not found at `.watchman/rubric.md`.']);

    expect(verdict.status).toBe('unconfigured');
    expect(verdict.findings[0]?.severity).toBe('block');
    expect(verdict.bottomLine).toContain('No review happened');
  });

  test('fails the check run in advisory mode too — a broken install is not a judgement', () => {
    const verdict = refusalVerdict(['nope']);

    expect(conclusionFor(verdict, 'advisory')).toBe('failure');
    expect(conclusionFor(verdict, 'required')).toBe('failure');
  });
});
