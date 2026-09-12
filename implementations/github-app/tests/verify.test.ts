import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { verifySignature } from '../src/webhook/verify';

const SECRET = 'a-webhook-secret';
const sign = (body: string, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('verifySignature', () => {
  const body = JSON.stringify({ action: 'opened', number: 241 });

  test('accepts a delivery signed with the shared secret', async () => {
    await expect(verifySignature(body, sign(body), SECRET)).resolves.toBe(true);
  });

  test('rejects a body that changed after signing', async () => {
    const signature = sign(body);
    const tampered = body.replace('opened', 'closed');

    await expect(verifySignature(tampered, signature, SECRET)).resolves.toBe(false);
  });

  test('rejects a signature made with a different secret', async () => {
    await expect(verifySignature(body, sign(body, 'not-the-secret'), SECRET)).resolves.toBe(false);
  });

  test('rejects a re-serialised body — key order and whitespace change the HMAC', async () => {
    const signature = sign(body);
    const reserialised = JSON.stringify(JSON.parse(body), null, 2);

    await expect(verifySignature(reserialised, signature, SECRET)).resolves.toBe(false);
  });

  test.each([
    ['missing', null],
    ['empty', ''],
    ['unprefixed', 'deadbeef'],
    ['sha1', 'sha1=deadbeef'],
    ['truncated', 'sha256=dead'],
  ])('rejects a %s signature header', async (_label, signature) => {
    await expect(verifySignature(body, signature, SECRET)).resolves.toBe(false);
  });

  test('fails closed on a signature that is not hex at all', async () => {
    await expect(verifySignature(body, `sha256=${'z'.repeat(64)}`, SECRET)).resolves.toBe(false);
  });

  test('fails closed when no secret is configured', async () => {
    await expect(verifySignature(body, sign(body, ''), '')).resolves.toBe(false);
  });
});
