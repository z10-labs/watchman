import type { GitHubApi } from '../github/api';
import { conclusionFor, upsertCheckRun } from '../github/checks';
import { findSticky, upsertSticky } from '../github/sticky';
import { renderComment, shortSha, type GateMode } from '../render/comment';
import { readState, toState, type ReviewState } from '../state/blob';
import type { Store } from '../store/index';
import type { ReviewRequest, RoutedEvent, Verdict } from '../types';
import { performReview, type PerformDeps, type PerformResult } from './perform';

export interface ReviewDeps {
  readonly store: Store;
  /** Used until config is read, and when config cannot be read at all. */
  readonly gateMode: GateMode;
  /** Our GitHub App id, so the sticky scan cannot be hijacked by another bot. */
  readonly appId: number | null;
  readonly perform: PerformDeps;
  apiFor(event: RoutedEvent): Promise<GitHubApi>;
  now(): Date;
}

export interface BegunReview {
  readonly request: ReviewRequest;
  readonly commentId: number;
  readonly checkRunId: number;
  /** What the last verdict on this pull request left behind. */
  readonly previous: ReviewState | null;
}

/**
 * Has the branch moved under us?
 *
 * Inngest cancels a superseded run asynchronously, so a run can finish a step
 * and write after a newer commit has arrived but before cancellation lands.
 * The queue cannot close that window; re-reading the head immediately before we
 * write can. Costs one API call per publish and makes "newest commit wins" a
 * property of our code rather than of a scheduler's semantics.
 */
export async function isStale(request: ReviewRequest, api: GitHubApi): Promise<boolean> {
  const current = await api.getPullRequest(request.prNumber);
  return current.headSha !== request.headSha;
}

/**
 * Resolve the commit, recover history, then claim the slot.
 *
 * The placeholder goes up before any expensive work starts, so the author sees
 * the reviewer arrive rather than wondering whether it is installed at all.
 */
export async function beginReview(event: RoutedEvent, deps: ReviewDeps): Promise<BegunReview> {
  const api = await deps.apiFor(event);

  // An issue_comment command knows the PR number and nothing else.
  const needsLookup = !event.headSha || !event.baseRef;
  const resolved = needsLookup ? await api.getPullRequest(event.prNumber) : null;

  const request: ReviewRequest = {
    ...event,
    headSha: event.headSha ?? resolved?.headSha ?? '',
    baseRef: event.baseRef ?? resolved?.baseRef ?? '',
  };

  if (!request.headSha) {
    throw new Error(`watchman: could not resolve a head commit for ${event.prKey}`);
  }

  const existing = await findSticky(api, deps.store, {
    prKey: request.prKey,
    prNumber: request.prNumber,
    appId: deps.appId,
  });
  const previous = readState(existing?.body);

  const body = renderComment({
    owner: request.owner,
    repo: request.repo,
    prNumber: request.prNumber,
    headSha: request.headSha,
    state: { kind: 'reviewing' },
    updatedAt: deps.now(),
    ...(previous ? { carry: previous } : {}),
  });

  const [comment, checkRunId] = await Promise.all([
    upsertSticky(api, deps.store, {
      prKey: request.prKey,
      prNumber: request.prNumber,
      body,
      appId: deps.appId,
    }),
    upsertCheckRun(api, deps.store, {
      prKey: request.prKey,
      headSha: request.headSha,
      status: 'in_progress',
      title: 'Reviewing',
      summary: `Watchman is reviewing ${shortSha(request.headSha)}.`,
    }),
  ]);

  return { request, commentId: comment.commentId, checkRunId, previous };
}

/**
 * Render the verdict into the slot and close the check run.
 *
 * Returns false without writing anything when the branch has moved — a newer
 * run owns the slot now.
 */
export async function publishVerdict(
  request: ReviewRequest,
  result: PerformResult,
  deps: ReviewDeps,
): Promise<boolean> {
  const api = await deps.apiFor(request);
  if (await isStale(request, api)) return false;

  const body = renderComment({
    owner: request.owner,
    repo: request.repo,
    prNumber: request.prNumber,
    headSha: request.headSha,
    state: { kind: 'verdict', verdict: result.verdict },
    updatedAt: deps.now(),
    carry: result.state,
  });

  await upsertSticky(api, deps.store, {
    prKey: request.prKey,
    prNumber: request.prNumber,
    body,
    appId: deps.appId,
  });

  await upsertCheckRun(api, deps.store, {
    prKey: request.prKey,
    headSha: request.headSha,
    status: 'completed',
    conclusion: conclusionFor(result.verdict, result.gateMode),
    title: result.verdict.status.replace(/_/g, ' '),
    summary: result.verdict.bottomLine,
  });

  return true;
}

/**
 * Say so, in the slot, when the review itself fell over.
 *
 * The one outcome this service must never produce is silence that looks like
 * approval — unless the branch has moved, in which case a failure on the old
 * commit must not overwrite a newer run's verdict.
 */
export async function publishError(
  request: ReviewRequest,
  message: string,
  deps: ReviewDeps,
  previous: ReviewState | null = null,
): Promise<boolean> {
  const api = await deps.apiFor(request);
  if (await isStale(request, api)) return false;

  const body = renderComment({
    owner: request.owner,
    repo: request.repo,
    prNumber: request.prNumber,
    headSha: request.headSha,
    state: { kind: 'error', message },
    updatedAt: deps.now(),
    ...(previous ? { carry: previous } : {}),
  });

  await upsertSticky(api, deps.store, {
    prKey: request.prKey,
    prNumber: request.prNumber,
    body,
    appId: deps.appId,
  });

  await upsertCheckRun(api, deps.store, {
    prKey: request.prKey,
    headSha: request.headSha,
    status: 'completed',
    conclusion: 'failure',
    title: 'Review failed',
    summary: message,
  });

  return true;
}

export interface RunOutcome extends BegunReview {
  readonly published: boolean;
  readonly result: PerformResult;
}

/** The whole pipeline, in one call. The Inngest function wraps this in steps. */
export async function runReview(event: RoutedEvent, deps: ReviewDeps): Promise<RunOutcome> {
  const begun = await beginReview(event, deps);

  try {
    const api = await deps.apiFor(begun.request);
    const result = await performReview(begun.request, api, begun.previous, deps.perform);
    const published = await publishVerdict(begun.request, result, deps);
    return { ...begun, published, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await publishError(begun.request, message, deps, begun.previous);
    throw error;
  }
}

/** A verdict the service produced without asking a model anything. */
export function localVerdict(status: Verdict['status'], bottomLine: string): Verdict {
  return {
    status,
    findings: [],
    bottomLine,
    receipt: { documentsRead: [], decisionCount: 0, rubricSha: 'none' },
  };
}

export { toState };
