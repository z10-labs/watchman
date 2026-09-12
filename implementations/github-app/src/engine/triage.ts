import type { DiffSummary } from './diff';
import { matchesPath } from './diff';

/**
 * Paths where a change can plausibly move the product, not just the code.
 *
 * Kept deliberately generous. A false positive costs one review; a false
 * negative means a schema change or an auth path shipped unreviewed, which is
 * exactly the category this whole product exists to catch.
 */
const STRATEGIC_SURFACE: readonly string[] = [
  '**/migrations/**',
  '**/migration/**',
  '**/*.sql',
  '**/schema*.*',
  '**/prisma/**',
  '**/drizzle/**',
  '**/auth/**',
  '**/*auth*.*',
  '**/rbac/**',
  '**/permissions*.*',
  '**/middleware.*',
  '**/*billing*/**',
  '**/*payment*/**',
  '**/*pricing*/**',
  '**/*tenant*.*',
  '**/api/**',
  '**/routes/**',
  '**/app/**/route.*',
  'package.json',
  '**/package.json',
  '*.lock',
  '**/*.lock',
  'pnpm-lock.yaml',
  '**/Dockerfile*',
  '**/*.tf',
  '**/.env*',
  '**/*config*.*',
];

/** Changes that are, on their own, never a strategic question. */
const NEVER_STRATEGIC: readonly string[] = [
  '**/*.md',
  '**/*.mdx',
  '**/*.txt',
  '**/*.snap',
  '**/*.test.*',
  '**/*.spec.*',
  '**/__tests__/**',
  '**/__snapshots__/**',
  '**/*.css',
  '**/*.svg',
  '**/*.png',
  '**/*.jpg',
];

export interface TriageResult {
  readonly surfaceMoved: boolean;
  readonly reason: string;
  /** True when a model was consulted; false when the path rules were enough. */
  readonly usedModel: boolean;
}

/** Asks a cheap model the single triage question. Injected so tests stay free. */
export type TriageModel = (input: {
  paths: readonly string[];
  lines: number;
}) => Promise<boolean>;

const hits = (patterns: readonly string[], path: string): boolean =>
  patterns.some((pattern) => matchesPath(pattern, path));

/**
 * Does this push deserve a judgement, or only a new commit hash?
 *
 * Two stages, cheapest first. The path rules answer most pushes for free; only
 * what they cannot settle reaches a model, and even then it is the small one.
 * v1 sent every push straight to the expensive model and died of it.
 */
export async function triage(
  diff: DiffSummary,
  model?: TriageModel,
): Promise<TriageResult> {
  if (diff.files.length === 0) {
    return { surfaceMoved: false, reason: 'no files changed', usedModel: false };
  }

  const interesting = diff.paths.filter((path) => !hits(NEVER_STRATEGIC, path));

  if (interesting.length === 0) {
    return {
      surfaceMoved: false,
      reason: 'docs, tests and assets only',
      usedModel: false,
    };
  }

  const onSurface = interesting.filter((path) => hits(STRATEGIC_SURFACE, path));
  if (onSurface.length > 0) {
    return {
      surfaceMoved: true,
      reason: `touches ${onSurface[0]}`,
      usedModel: false,
    };
  }

  // A new file is a new surface by definition, whatever its path.
  const added = diff.files.filter((file) => file.status === 'added');
  if (added.length > 0 && !model) {
    return {
      surfaceMoved: true,
      reason: `${added.length} new file(s) with no prior review`,
      usedModel: false,
    };
  }

  if (!model) {
    return { surfaceMoved: false, reason: 'no known strategic surface', usedModel: false };
  }

  const moved = await model({ paths: interesting, lines: diff.lines });
  return {
    surfaceMoved: moved,
    reason: moved ? 'triage model says the surface moved' : 'triage model says it did not',
    usedModel: true,
  };
}
