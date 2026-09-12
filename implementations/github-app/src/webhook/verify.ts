import { verify } from '@octokit/webhooks-methods';

/**
 * Verify a webhook delivery against the raw request body.
 *
 * Two things matter here and both are easy to get wrong:
 *  1. The body must be the *raw* text. Re-serialising parsed JSON changes key
 *     order and whitespace, and the HMAC will never match.
 *  2. The comparison must be timing-safe — `@octokit/webhooks-methods` uses
 *     `crypto.timingSafeEqual` internally, which is why we delegate rather than
 *     hand-rolling a `===`.
 *
 * Returns false rather than throwing: a malformed signature header is an
 * unauthenticated request, not an exception.
 */
export async function verifySignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!signature || !signature.startsWith('sha256=')) return false;
  if (!secret) return false;

  try {
    return await verify(secret, rawBody, signature);
  } catch {
    return false;
  }
}
