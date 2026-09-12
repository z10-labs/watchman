import { Inngest } from 'inngest';
import type { RoutedEvent } from '../types';

export const REVIEW_REQUESTED = 'watchman/review.requested';

export interface ReviewRequestedEvent {
  readonly name: typeof REVIEW_REQUESTED;
  readonly data: RoutedEvent;
  readonly id?: string;
}

export const inngest = new Inngest({ id: 'watchman' });

/**
 * Idempotency key for a delivery.
 *
 * GitHub delivers at least once, so a replay must re-render rather than
 * re-review. Forced runs (`/watchman review`, a re-requested check) deliberately
 * carry a unique key — the human asking again means they want the work redone.
 */
export function eventId(event: RoutedEvent, nonce: () => string = () => Date.now().toString(36)): string {
  if (event.forced) return `${event.prKey}@${event.trigger}:${nonce()}`;
  return `${event.prKey}@${event.headSha ?? 'unknown'}`;
}
