import { NotFoundError, type GitHubApi, type IssueComment } from './api';
import type { Store } from '../store/index';

/**
 * An HTML comment GitHub renders as nothing and we can find again.
 *
 * Versioned on purpose: a future renderer has to recognise the comment this
 * version left behind, or every repo gets a second sticky comment on upgrade.
 */
export const STICKY_MARKER = '<!-- watchman:verdict:v1 -->';

/** Markers from earlier renderers we still adopt rather than orphan. */
const KNOWN_MARKERS = [STICKY_MARKER] as const;

function isOurs(body: string | null, appId: number | null, ourAppId: number | null): boolean {
  if (!body || !KNOWN_MARKERS.some((marker) => body.startsWith(marker))) return false;
  // Another bot quoting our comment must not be able to steal the slot.
  if (ourAppId === null) return true;
  return appId === ourAppId;
}

/**
 * Find our comment without writing to it.
 *
 * The verdict we last left carries this pull request's history in its body, so
 * reading it back is how findings keep their identity and their age.
 */
export async function findSticky(
  api: GitHubApi,
  store: Store,
  input: { prKey: string; prNumber: number; appId?: number | null },
): Promise<IssueComment | null> {
  const ourAppId = input.appId ?? null;
  const comments = await api.listIssueComments(input.prNumber);
  const known = await store.getStickyCommentId(input.prKey);

  const mine = comments.find(
    (comment) => comment.id === known || isOurs(comment.body, comment.appId, ourAppId),
  );

  return mine ?? null;
}

export interface UpsertResult {
  readonly commentId: number;
  readonly created: boolean;
}

/**
 * Put the verdict in the one slot this PR gets, wherever that slot currently is.
 *
 * Three paths, in cost order: the id we stored, a scan of the thread, a fresh
 * comment. The 404 fall-through matters more than it looks — a human deleting
 * the verdict must not silence the reviewer on exactly that PR.
 */
export async function upsertSticky(
  api: GitHubApi,
  store: Store,
  input: { prKey: string; prNumber: number; body: string; appId?: number | null },
): Promise<UpsertResult> {
  const body = `${STICKY_MARKER}\n${input.body}`;
  const ourAppId = input.appId ?? null;

  const known = await store.getStickyCommentId(input.prKey);
  if (known !== null) {
    try {
      await api.updateIssueComment(known, body);
      return { commentId: known, created: false };
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      // Deleted by a human. Fall through and find or make another one.
    }
  }

  const comments = await api.listIssueComments(input.prNumber);
  const existing = comments.find((c) => isOurs(c.body, c.appId, ourAppId));

  if (existing) {
    await store.setStickyCommentId(input.prKey, existing.id);
    await api.updateIssueComment(existing.id, body);
    return { commentId: existing.id, created: false };
  }

  const created = await api.createIssueComment(input.prNumber, body);
  await store.setStickyCommentId(input.prKey, created.id);
  return { commentId: created.id, created: true };
}
