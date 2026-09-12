import { serve } from 'inngest/next';
import { inngest } from '../../../jobs/client';
import { reviewPullRequest } from '../../../jobs/function';

export const runtime = 'nodejs';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [reviewPullRequest],
});
