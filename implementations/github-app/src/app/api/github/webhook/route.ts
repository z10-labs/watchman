import { inngest, eventId, REVIEW_REQUESTED } from '../../../../jobs/client';
import { env } from '../../../../runtime';
import { routeEvent } from '../../../../webhook/router';
import { verifySignature } from '../../../../webhook/verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The only public entry point.
 *
 * Everything here runs on a ten-second budget — GitHub abandons the delivery
 * after that — so this handler verifies, routes, enqueues, and gets out. The
 * review itself happens on the other side of the queue, where it can take
 * minutes and be retried.
 */
export async function POST(request: Request): Promise<Response> {
  // Raw text, before any parse. A re-serialised body will never match the HMAC.
  const raw = await request.text();
  const signature = request.headers.get('x-hub-signature-256');

  const ok = await verifySignature(raw, signature, env().GITHUB_WEBHOOK_SECRET);
  if (!ok) return new Response('bad signature', { status: 401 });

  const eventName = request.headers.get('x-github-event');
  const delivery = request.headers.get('x-github-delivery') ?? 'unknown';

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response('malformed payload', { status: 400 });
  }

  const decision = routeEvent(eventName, payload as Record<string, unknown>);
  if (!decision.act) {
    // 204 with the reason in a header: skipped deliveries are the thing you end
    // up debugging, and GitHub's delivery log is where you look.
    return new Response(null, {
      status: 204,
      headers: { 'x-watchman-skipped': decision.reason },
    });
  }

  await inngest.send({
    name: REVIEW_REQUESTED,
    id: eventId(decision.event),
    data: decision.event,
  });

  return new Response(JSON.stringify({ queued: decision.event.prKey, delivery }), {
    status: 202,
    headers: { 'content-type': 'application/json' },
  });
}
