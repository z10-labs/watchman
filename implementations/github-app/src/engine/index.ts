import type { Finding, Severity, Verdict, VerdictStatus } from '../types';
import type { BrainDocument, PreflightOk } from '../preflight/index';
import type { DiffSummary } from './diff';
import { fingerprint } from './fingerprint';
import { buildPrompt, type EnginePrompt } from './prompt';
import type { RawVerdict } from './schema';

export interface GenerateResult {
  readonly verdict: RawVerdict;
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number };
  readonly costCents?: number;
}

/** The one call that reaches a model. Injected, so the engine tests offline. */
export type GenerateVerdict = (prompt: EnginePrompt) => Promise<GenerateResult>;

export interface EngineInput {
  readonly preflight: PreflightOk;
  readonly diff: DiffSummary;
  readonly pr: { readonly title: string; readonly number: number; readonly baseRef: string };
  readonly incremental: boolean;
  readonly carriedTitles: readonly string[];
}

export interface EngineOutput {
  readonly verdict: Verdict;
  readonly costCents: number;
}

/**
 * Severity in, verdict out — mechanically.
 *
 * One block flips the whole review; warnings alone are soft; anything else is
 * clean. Written down here rather than asked of the model, so the taxonomy
 * cannot drift review to review.
 */
export function statusFrom(findings: readonly { severity: Severity }[]): VerdictStatus {
  if (findings.some((finding) => finding.severity === 'block')) return 'strategic_blocker';
  if (findings.some((finding) => finding.severity === 'warn')) return 'soft_warnings';
  return 'clean';
}

const summarise = (documents: readonly BrainDocument[]): string[] =>
  documents.map((doc) => doc.path);

export function createEngine(generate: GenerateVerdict) {
  return async function review(input: EngineInput): Promise<EngineOutput> {
    const prompt = buildPrompt({
      rubric: input.preflight.rubric,
      documents: input.preflight.documents,
      decisions: input.preflight.decisions,
      diff: input.diff,
      pr: input.pr,
      incremental: input.incremental,
      carriedTitles: input.carriedTitles,
    });

    const result = await generate(prompt);

    const findings: Finding[] = result.verdict.findings.map((raw) => ({
      fingerprint: fingerprint(raw.title, raw.source, raw.module ?? ''),
      severity: raw.severity,
      title: raw.title,
      body: raw.body,
      suggestedAction: raw.suggested_action,
      source: raw.source,
    }));

    return {
      costCents: result.costCents ?? 0,
      verdict: {
        status: statusFrom(findings),
        findings,
        bottomLine: result.verdict.bottom_line,
        receipt: {
          documentsRead: summarise(input.preflight.documents),
          decisionCount: input.preflight.decisions.length,
          rubricSha: input.preflight.receipt.rubricSha,
        },
        stats: {
          diffLines: input.diff.lines,
          ...(result.costCents !== undefined ? { costCents: result.costCents } : {}),
        },
      },
    };
  };
}

export type Engine = ReturnType<typeof createEngine>;
