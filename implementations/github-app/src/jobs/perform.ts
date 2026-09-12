import type { GitHubApi } from '../github/api';
import { githubDocSource } from '../github/doc-source';
import { summarise } from '../engine/diff';
import { triage, type TriageModel } from '../engine/triage';
import type { Engine } from '../engine/index';
import { preflight } from '../preflight/index';
import { refusalVerdict } from '../preflight/refusal';
import { decideTier, needsTriage, type Tier } from '../policy/trigger';
import { carryForward, toState, type ReviewState } from '../state/blob';
import type { GateMode } from '../render/comment';
import type { ReviewRequest, Verdict } from '../types';

export interface PerformDeps {
  readonly engine: Engine;
  /** Optional: the path rules answer most pushes without it. */
  readonly triageModel?: TriageModel;
  /** Used only when config cannot be read — a refusal still needs a gate. */
  readonly fallbackGateMode: GateMode;
}

export interface PerformResult {
  readonly verdict: Verdict;
  readonly gateMode: GateMode;
  readonly state: ReviewState;
  readonly tier: Tier;
  readonly reason: string;
}

/**
 * One review, end to end.
 *
 * The order is the argument: refuse before reviewing, cost nothing before
 * spending, and decide the tier before calling anything expensive.
 */
export async function performReview(
  request: ReviewRequest,
  api: GitHubApi,
  previous: ReviewState | null,
  deps: PerformDeps,
): Promise<PerformResult> {
  // Config and rubric come from the default branch. Reading them from the head
  // would let a fork edit the standard it is about to be judged against.
  const defaultBranch = await api.getDefaultBranch();
  const checked = await preflight(githubDocSource(api, defaultBranch));

  if (!checked.ok) {
    const verdict = refusalVerdict(checked.problems);
    return {
      verdict,
      gateMode: deps.fallbackGateMode,
      state: toState(request.headSha, verdict, previous?.spentCents ?? 0),
      tier: 'skip',
      reason: 'preflight refused',
    };
  }

  const { config } = checked;
  const gateMode = config.gate.mode;
  const skip = config.gate.skip_paths;

  const full = summarise(await api.listChangedFiles(request.prNumber), skip);

  // On a push we already have a verdict for, the interesting diff is the delta.
  const canIncrement = request.trigger === 'synchronize' && Boolean(previous?.lastReviewedSha);
  const delta = canIncrement
    ? summarise(await api.compareCommits(previous!.lastReviewedSha, request.headSha), skip)
    : null;

  const candidate = delta ?? full;

  const triaged = needsTriage(request.trigger, request.forced)
    ? await triage(candidate, deps.triageModel)
    : undefined;

  const decision = decideTier({
    trigger: request.trigger,
    forced: request.forced,
    diff: candidate,
    maxDiffLines: config.gate.max_diff_lines,
    ...(previous?.lastReviewedSha ? { lastReviewedSha: previous.lastReviewedSha } : {}),
    ...(triaged ? { surfaceMoved: triaged.surfaceMoved } : {}),
  });

  const finish = (verdict: Verdict, spent = 0): PerformResult => ({
    verdict,
    gateMode,
    state: toState(request.headSha, verdict, (previous?.spentCents ?? 0) + spent),
    tier: decision.tier,
    reason: triaged ? `${decision.reason} — ${triaged.reason}` : decision.reason,
  });

  if (decision.tier === 'skip') {
    return finish({
      status: 'skipped',
      findings: [],
      bottomLine: `Nothing to review: ${decision.reason}.`,
      receipt: checked.receipt,
    });
  }

  if (decision.tier === 'refresh') {
    // The previous verdict still stands; only the commit it refers to changed.
    return finish({
      status: previous?.status ?? 'skipped',
      findings: previous?.findings ?? [],
      bottomLine:
        previous?.bottomLine ||
        'This push touched no strategic surface. The previous verdict stands.',
      receipt: checked.receipt,
    });
  }

  if (decision.tier === 'bounded') {
    return finish({
      status: 'bounded',
      findings: [],
      bottomLine:
        `${candidate.lines} lines changed, over the ${config.gate.max_diff_lines}-line limit. ` +
        'Split this into reviewable pieces, or re-run with `/watchman review` to accept a ' +
        'degraded pass — a clean verdict on a diff this size would not be worth having.',
      receipt: checked.receipt,
    });
  }

  const pr = await api.getPullRequest(request.prNumber);
  const carriedTitles = (previous?.findings ?? [])
    .filter((finding) => finding.severity !== 'info')
    .map((finding) => finding.title);

  const { verdict, costCents } = await deps.engine({
    preflight: checked,
    diff: candidate,
    pr: { title: pr.title, number: request.prNumber, baseRef: request.baseRef },
    incremental: decision.tier === 'incremental',
    carriedTitles,
  });

  const aged = carryForward(verdict.findings, previous, request.headSha);

  return finish({ ...verdict, findings: aged }, costCents);
}
