import { createHash } from 'node:crypto';
import { loadConfig } from '../config/load';
import type { WatchmanConfig } from '../config/schema';
import { joinPath, type DocSource } from '../github/content';
import type { PreflightReceipt } from '../types';

/** A rubric shorter than this is a stub, a README, or an accident. */
export const MIN_RUBRIC_CHARS = 400;

/** `<PRODUCT>`, `<BRAIN_PATH>` — an adoption scaffold that was never filled in. */
const PLACEHOLDER = /<[A-Z][A-Z_]{2,}>/;

export interface BrainDocument {
  readonly path: string;
  readonly content: string;
}

export interface PreflightOk {
  readonly ok: true;
  readonly config: WatchmanConfig;
  readonly rubric: string;
  readonly documents: readonly BrainDocument[];
  readonly decisions: readonly BrainDocument[];
  readonly receipt: PreflightReceipt;
}

export interface PreflightFailed {
  readonly ok: false;
  readonly problems: readonly string[];
}

export type PreflightResult = PreflightOk | PreflightFailed;

export const rubricSha = (rubric: string): string =>
  createHash('sha256').update(rubric).digest('hex').slice(0, 8);

/**
 * Everything the reviewer needs, or an explicit refusal.
 *
 * This exists because of the single most expensive incident in the project's
 * history: a rubric file committed with the wrong contents, which produced
 * confident, well-formatted verdicts with no rubric behind them for four days.
 * There is no degraded mode here. Either every document resolves, or no review
 * happens and the pull request is told why.
 */
export async function preflight(source: DocSource): Promise<PreflightResult> {
  const configResult = await loadConfig(source);
  if (!configResult.ok) return { ok: false, problems: configResult.problems };

  const { config } = configResult;
  const problems: string[] = [];

  const rubric = await source.read(config.rubric);
  if (rubric === null) {
    problems.push(
      `Rubric not found at \`${config.rubric}\`. The reviewer has no instructions.`,
    );
  } else {
    if (rubric.trim().length < MIN_RUBRIC_CHARS) {
      problems.push(
        `Rubric at \`${config.rubric}\` is ${rubric.trim().length} characters — ` +
          `below the ${MIN_RUBRIC_CHARS} minimum. An empty or stub rubric fails silently.`,
      );
    }
    const placeholder = PLACEHOLDER.exec(rubric);
    if (placeholder) {
      problems.push(
        `Rubric still contains the adoption placeholder \`${placeholder[0]}\`. ` +
          `Fill it in — a half-filled rubric produces a confident verdict about nothing.`,
      );
    }
    if (!/out of scope/i.test(rubric)) {
      problems.push(
        `Rubric has no "out of scope" section. A reviewer is defined by its refusals; ` +
          `without one it will spend its budget on style notes CI already catches.`,
      );
    }
  }

  const documents: BrainDocument[] = [];
  for (const relative of config.brain.required_reading) {
    const path = joinPath(config.brain.path, relative);
    const content = await source.read(path);
    if (content === null) {
      problems.push(`Required reading not found: \`${path}\`.`);
      continue;
    }
    documents.push({ path, content });
  }

  const decisions: BrainDocument[] = [];
  const decisionsDir = joinPath(config.brain.path, config.brain.decisions);
  for (const path of await source.list(decisionsDir)) {
    const content = await source.read(path);
    if (content !== null) decisions.push({ path, content });
  }

  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    config,
    rubric: rubric as string,
    documents,
    decisions,
    receipt: {
      documentsRead: documents.map((doc) => doc.path),
      decisionCount: decisions.length,
      rubricSha: rubricSha(rubric as string),
    },
  };
}
