/**
 * The contract between the parts of the spine.
 *
 * `Verdict` is deliberately the full M2 shape even though M0 only ever emits a
 * stub: the renderer and the check-run mapping are written against the real
 * schema now, so the engine can be dropped in later without touching either.
 */

export type Severity = 'info' | 'warn' | 'block';

export type VerdictStatus =
  | 'clean'
  | 'soft_warnings'
  | 'strategic_blocker'
  | 'bounded' // diff too large to review in one pass
  | 'skipped' // no strategic surface touched
  | 'unconfigured'; // preflight refused

export interface Finding {
  /** Stable across pushes: sha256(normalised title + source + module). */
  readonly fingerprint: string;
  readonly severity: Severity;
  readonly title: string;
  readonly body: string;
  readonly suggestedAction: string;
  readonly source: string;
  /** Head SHA this finding was first raised against. */
  readonly firstSeenSha?: string;
}

export interface PreflightReceipt {
  readonly documentsRead: readonly string[];
  readonly decisionCount: number;
  /** First 8 chars of the rubric hash. Printed on every verdict. */
  readonly rubricSha: string;
}

export interface Verdict {
  readonly status: VerdictStatus;
  readonly findings: readonly Finding[];
  readonly bottomLine: string;
  readonly receipt?: PreflightReceipt;
  readonly stats?: {
    readonly diffLines?: number;
    readonly durationMs?: number;
    readonly costCents?: number;
  };
}

export type Trigger =
  | 'opened'
  | 'ready_for_review'
  | 'reopened'
  | 'synchronize'
  | 'command'
  | 'rerequested';

/**
 * What the router hands the queue.
 *
 * `headSha` / `baseRef` are optional because not every event carries them: an
 * `issue_comment` slash command knows only the PR number, so the job resolves
 * the rest from the API before it can do anything useful.
 */
export interface RoutedEvent {
  /**
   * The GitHub App installation the delivery came through — or null when the
   * job already holds its own token (a GitHub Actions run) and no installation
   * exists to look up.
   */
  readonly installationId: number | null;
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
  readonly trigger: Trigger;
  /** Concurrency + cancellation key. `owner/repo#123`. */
  readonly prKey: string;
  /** True for `/watchman review` — bypasses dedupe and any triage gate. */
  readonly forced: boolean;
  readonly headSha?: string;
  readonly baseRef?: string;
}

/** A routed event with the commit resolved. Everything downstream works from this. */
export interface ReviewRequest extends RoutedEvent {
  readonly headSha: string;
  readonly baseRef: string;
}

export type RouteResult =
  | { readonly act: true; readonly event: RoutedEvent }
  | { readonly act: false; readonly reason: string };
