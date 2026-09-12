import type { Finding, VerdictStatus } from '../types';

/**
 * Review state, carried in the sticky comment itself.
 *
 * GitHub renders an HTML comment as nothing, so the slot we already own can hold
 * its own history. That buys the two things findings actually need — identity
 * across pushes, and an age — without a database, a connection string, or a
 * second thing that can be down. It also means state dies with the pull request
 * it describes, which is the correct lifetime for it.
 *
 * The limits are real: ~64KB per comment body, and a human deleting the comment
 * loses that PR's history. Both are degradations, not failures.
 */
export const STATE_MARKER = 'watchman:state:v1';

const OPEN = /<!--\s*watchman:state:v1\s+/;

export interface ReviewState {
  readonly lastReviewedSha: string;
  readonly status: VerdictStatus;
  /**
   * The full findings, not just their ids. A push that moves no strategic
   * surface should leave the verdict on screen intact rather than blanking it,
   * so the state has to hold enough to re-render.
   */
  readonly findings: readonly Finding[];
  /** Cumulative for this pull request, in cents. */
  readonly spentCents: number;
  readonly bottomLine: string;
}

export const emptyState = (): ReviewState => ({
  lastReviewedSha: '',
  status: 'skipped',
  findings: [],
  spentCents: 0,
  bottomLine: '',
});

/**
 * Read state back out of a comment body.
 *
 * Defensive on purpose: a person can edit the comment, and a mangled blob must
 * degrade to "no history" rather than break the review.
 */
export function readState(body: string | null | undefined): ReviewState | null {
  if (!body) return null;

  const start = body.search(OPEN);
  if (start === -1) return null;

  const from = body.indexOf('{', start);
  const to = body.indexOf('-->', from);
  if (from === -1 || to === -1) return null;

  try {
    const parsed = JSON.parse(body.slice(from, to).trim()) as Partial<ReviewState>;
    if (typeof parsed !== 'object' || parsed === null) return null;

    return {
      lastReviewedSha: typeof parsed.lastReviewedSha === 'string' ? parsed.lastReviewedSha : '',
      status: (parsed.status ?? 'skipped') as VerdictStatus,
      findings: Array.isArray(parsed.findings) ? (parsed.findings as Finding[]) : [],
      spentCents: typeof parsed.spentCents === 'number' ? parsed.spentCents : 0,
      bottomLine: typeof parsed.bottomLine === 'string' ? parsed.bottomLine : '',
    };
  } catch {
    return null;
  }
}

export function renderState(state: ReviewState): string {
  return `<!-- ${STATE_MARKER} ${JSON.stringify(state)} -->`;
}

/**
 * Give a finding the age it has actually had.
 *
 * A finding the author has not addressed across four pushes is a different
 * conversation from one raised a minute ago, and the reviewer should say so.
 */
export function carryForward(
  findings: readonly Finding[],
  previous: ReviewState | null,
  headSha: string,
): Finding[] {
  const seen = new Map(previous?.findings.map((f) => [f.fingerprint, f]) ?? []);

  return findings.map((finding) => {
    const before = seen.get(finding.fingerprint);
    return { ...finding, firstSeenSha: before?.firstSeenSha ?? headSha };
  });
}

export function toState(
  headSha: string,
  verdict: { status: VerdictStatus; findings: readonly Finding[]; bottomLine: string },
  spentCents: number,
): ReviewState {
  return {
    lastReviewedSha: headSha,
    status: verdict.status,
    findings: verdict.findings.map((finding) => ({
      ...finding,
      firstSeenSha: finding.firstSeenSha ?? headSha,
    })),
    spentCents,
    bottomLine: verdict.bottomLine,
  };
}
