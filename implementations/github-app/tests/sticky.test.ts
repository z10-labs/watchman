import { beforeEach, describe, expect, test } from 'vitest';
import { STICKY_MARKER, upsertSticky } from '../src/github/sticky';
import { createMemoryStore, type Store } from '../src/store/index';
import { fakeGitHub, type FakeGitHub } from './fixtures/github';

const PR = { prKey: 'z10labs/tutorx#241', prNumber: 241, appId: 42 };

describe('upsertSticky', () => {
  let api: FakeGitHub;
  let store: Store;

  beforeEach(() => {
    api = fakeGitHub({ appId: 42 });
    store = createMemoryStore();
  });

  test('creates the comment the first time and reuses it after', async () => {
    const first = await upsertSticky(api, store, { ...PR, body: 'reviewing' });
    const second = await upsertSticky(api, store, { ...PR, body: 'verdict' });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.commentId).toBe(first.commentId);
    expect(api.comments.size).toBe(1);
    expect(api.comments.get(first.commentId)?.body).toContain('verdict');
  });

  test('prefixes the body with the marker so it can be found again', async () => {
    const { commentId } = await upsertSticky(api, store, { ...PR, body: 'hello' });

    expect(api.comments.get(commentId)?.body?.startsWith(STICKY_MARKER)).toBe(true);
  });

  test('takes the fast path once the id is known — no thread scan', async () => {
    await upsertSticky(api, store, { ...PR, body: 'one' });
    api.calls.length = 0;

    await upsertSticky(api, store, { ...PR, body: 'two' });

    expect(api.calls.map((c) => c.kind)).toEqual(['updateIssueComment']);
  });

  test('adopts an existing comment after a cold start rather than posting a second', async () => {
    const existing = api.seedComment(`${STICKY_MARKER}\nfrom a previous deploy`, 42);

    const result = await upsertSticky(api, createMemoryStore(), { ...PR, body: 'new verdict' });

    expect(result.created).toBe(false);
    expect(result.commentId).toBe(existing);
    expect(api.comments.size).toBe(1);
  });

  test('recreates the comment when a human deleted it', async () => {
    const first = await upsertSticky(api, store, { ...PR, body: 'one' });
    api.deleteComment(first.commentId);

    const second = await upsertSticky(api, store, { ...PR, body: 'two' });

    expect(second.created).toBe(true);
    expect(second.commentId).not.toBe(first.commentId);
  });

  test('will not hijack a marker-bearing comment written by someone else', async () => {
    api.seedComment(`${STICKY_MARKER}\nquoted by another bot`, 99);

    const result = await upsertSticky(api, store, { ...PR, body: 'ours' });

    expect(result.created).toBe(true);
    expect(api.comments.size).toBe(2);
  });

  test('ignores ordinary review comments in the thread', async () => {
    api.seedComment('looks good to me', null);
    api.seedComment('ship it', null);

    const result = await upsertSticky(api, store, { ...PR, body: 'ours' });

    expect(result.created).toBe(true);
    expect(api.comments.size).toBe(3);
  });
});
