import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { doctor } from '../src/cli/doctor';
import { fileDocSource } from '../src/github/doc-source';
import { preflight } from '../src/preflight/index';
import { defaultFiles } from './fixtures/github';

let root: string;
let written: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'watchman-'));
  written = '';

  for (const [path, content] of defaultFiles()) {
    const full = join(root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    written += String(chunk);
    return true;
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('watchman doctor', () => {
  test('reports a healthy repository and exits zero', async () => {
    const code = await doctor(root);

    expect(code).toBe(0);
    expect(written).toContain('READY');
    expect(written).toContain('docs/positioning.md');
    expect(written).toContain('decisions     1');
  });

  test('refuses, loudly, when the rubric has been broken', async () => {
    await writeFile(join(root, '.watchman/rubric.md'), '# see the README', 'utf8');

    const code = await doctor(root);

    expect(code).toBe(1);
    expect(written).toContain('REFUSED');
    expect(written).toContain('No verdict would be produced');
  });

  test('names a document that has moved', async () => {
    await rm(join(root, 'docs/architecture/overview.md'));

    const code = await doctor(root);

    expect(code).toBe(1);
    expect(written).toContain('docs/architecture/overview.md');
  });

  test('points out an empty decisions ledger without failing', async () => {
    await rm(join(root, 'docs/decisions/dec-001-tenancy.md'));

    const code = await doctor(root);

    expect(code).toBe(0);
    expect(written).toContain('ledger is empty');
  });

  test('runs the same preflight the hosted reviewer runs', async () => {
    // The point of the CLI is that it cannot drift from production behaviour.
    const direct = await preflight(fileDocSource(root));

    expect(direct.ok).toBe(true);
    expect(await doctor(root)).toBe(0);
  });
});

describe('fileDocSource', () => {
  test('will not read outside the repository, whatever the config says', async () => {
    const source = fileDocSource(root);

    expect(await source.read('../../../etc/passwd')).toBeNull();
    expect(await source.list('../..')).toEqual([]);
  });

  test('returns null for a missing file rather than throwing', async () => {
    expect(await fileDocSource(root).read('nope.md')).toBeNull();
  });
});
