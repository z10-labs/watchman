import type { Finding, Verdict } from '../types';
import { fingerprint } from '../engine/fingerprint';

/**
 * Turn a preflight failure into the artifact the pull request sees.
 *
 * Rendered through the same path as a real verdict, so a broken installation is
 * as visible as a strategic blocker — and never mistakable for a passing review.
 */
export function refusalVerdict(problems: readonly string[]): Verdict {
  const findings: Finding[] = problems.map((problem, index) => ({
    fingerprint: fingerprint(`preflight-${index}`, problem),
    severity: 'block',
    title: 'Watchman is not configured',
    body: problem,
    suggestedAction: 'Fix the configuration and re-run with `/watchman review`.',
    source: '.watchman.yml',
  }));

  return {
    status: 'unconfigured',
    findings,
    bottomLine:
      'No review happened. The Watchman refuses to emit a verdict it cannot support — ' +
      'a confident review with nothing behind it is worse than no review.',
    receipt: { documentsRead: [], decisionCount: 0, rubricSha: 'none' },
  };
}
