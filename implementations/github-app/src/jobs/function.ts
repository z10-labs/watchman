import { NonRetriableError } from 'inngest';
import { inngest, REVIEW_REQUESTED } from './client';
import { beginReview, publishError, publishVerdict } from './review';
import { performReview } from './perform';
import { deps } from '../runtime';
import type { RoutedEvent } from '../types';

/**
 * One review per pull request at a time, and the newest commit wins.
 *
 * `concurrency` keeps two runs off the same sticky comment; `cancelOn` kills a
 * superseded run rather than racing it to the slot; `debounce` collapses a
 * five-commit push into one review instead of five.
 */
export const reviewPullRequest = inngest.createFunction(
  {
    id: 'review-pull-request',
    triggers: [{ event: REVIEW_REQUESTED }],
    concurrency: { key: 'event.data.prKey', limit: 1 },
    debounce: { key: 'event.data.prKey', period: '60s' },
    cancelOn: [
      {
        event: REVIEW_REQUESTED,
        if: 'async.data.prKey == event.data.prKey && async.data.headSha != event.data.headSha',
      },
    ],
    retries: 2,
  },
  async ({ event, step }) => {
    const routed = event.data as RoutedEvent;
    const d = deps();

    const begun = await step.run('claim-the-slot', () => beginReview(routed, d));

    try {
      const result = await step.run('review', async () => {
        const api = await d.apiFor(begun.request);
        return performReview(begun.request, api, begun.previous, d.perform);
      });

      const published = await step.run('publish', () =>
        publishVerdict(begun.request, result, d),
      );

      // Not an error: a newer commit arrived and owns the slot now.
      return {
        prKey: begun.request.prKey,
        tier: result.tier,
        status: result.verdict.status,
        published,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await step.run('publish-failure', () =>
        publishError(begun.request, message, d, begun.previous),
      );
      throw new NonRetriableError(message);
    }
  },
);
