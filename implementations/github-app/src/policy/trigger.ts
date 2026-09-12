import type { DiffSummary } from '../engine/diff';
import type { Trigger } from '../types';

/**
 * What this push is worth.
 *
 * `full` and `incremental` cost a judgement call from an expensive model.
 * `refresh` and `skip` cost nothing. The whole economic argument for this
 * product lives in the ratio between them, and that ratio is decided here.
 */
export type Tier = 'full' | 'incremental' | 'refresh' | 'bounded' | 'skip';

export interface PolicyInput {
  readonly trigger: Trigger;
  readonly forced: boolean;
  readonly diff: DiffSummary;
  readonly maxDiffLines: number;
  /** From the sticky comment's state blob; empty when this PR is new to us. */
  readonly lastReviewedSha?: string;
  /** Undefined when triage did not run — it only runs for pushes. */
  readonly surfaceMoved?: boolean;
}

export interface Decision {
  readonly tier: Tier;
  readonly reason: string;
}

/** Events where the change is being *proposed*, not merely edited. */
const ALWAYS_FULL: readonly Trigger[] = ['opened', 'ready_for_review', 'reopened'];

/** True when this event needs triage before we know what it costs. */
export function needsTriage(trigger: Trigger, forced: boolean): boolean {
  return trigger === 'synchronize' && !forced;
}

export function decideTier(input: PolicyInput): Decision {
  if (input.diff.files.length === 0) {
    return { tier: 'skip', reason: 'nothing left to review after skip_paths' };
  }

  // Principle 6: a "Clean" verdict on a megadiff is worse than no verdict, so
  // we decline to produce one rather than producing a worse one.
  if (input.diff.lines > input.maxDiffLines) {
    return {
      tier: 'bounded',
      reason: `${input.diff.lines} lines changed, over the ${input.maxDiffLines} limit`,
    };
  }

  if (input.forced) {
    return { tier: 'full', reason: 'a human asked for this review explicitly' };
  }

  if (ALWAYS_FULL.includes(input.trigger)) {
    return { tier: 'full', reason: `pull request ${input.trigger}` };
  }

  if (input.trigger === 'synchronize') {
    if (input.surfaceMoved === false) {
      return { tier: 'refresh', reason: 'push touched no strategic surface' };
    }
    if (!input.lastReviewedSha) {
      return { tier: 'full', reason: 'no previous verdict to build on' };
    }
    return { tier: 'incremental', reason: 'reviewing the delta since the last verdict' };
  }

  return { tier: 'full', reason: `trigger ${input.trigger}` };
}
