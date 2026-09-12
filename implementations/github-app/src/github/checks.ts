import type { CheckConclusion, CheckRunInput, GitHubApi } from './api';
import type { Store } from '../store/index';
import type { Verdict } from '../types';
import type { GateMode } from '../render/comment';

/**
 * Severity in, gate out — and the mapping lives here, not in the model.
 *
 * `advisory` is the default because a reviewer nobody trusts yet must not be
 * able to block a merge. Flipping to `required` is the adoption decision, and
 * it is a config change, not a prompt change.
 */
export function conclusionFor(verdict: Verdict, mode: GateMode): CheckConclusion {
  switch (verdict.status) {
    case 'clean':
    case 'skipped':
      return 'success';
    case 'soft_warnings':
    case 'bounded':
      return 'neutral';
    case 'strategic_blocker':
      return mode === 'required' ? 'action_required' : 'neutral';
    case 'unconfigured':
      // Never advisory: this is a broken installation, not a judgement.
      return 'failure';
  }
}

export async function upsertCheckRun(
  api: GitHubApi,
  store: Store,
  input: { prKey: string } & CheckRunInput,
): Promise<number> {
  const { prKey, ...run } = input;
  const known = await store.getCheckRunId(prKey, run.headSha);

  if (known !== null) {
    await api.updateCheckRun(known, run);
    return known;
  }

  const created = await api.createCheckRun(run);
  await store.setCheckRunId(prKey, run.headSha, created.id);
  return created.id;
}
