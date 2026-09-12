/**
 * The acceptance test.
 *
 * "One comment, edited in place, twice, and a check run that reaches a
 * conclusion." This is that, with the network replaced by a fake — the same code
 * paths, minus the installation.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { eventId } from '../src/jobs/client';
import { runReview, type ReviewDeps } from '../src/jobs/review';
import { STICKY_MARKER } from '../src/github/sticky';
import { readState } from '../src/state/blob';
import { routeEvent } from '../src/webhook/router';
import type { RoutedEvent } from '../src/types';
import { blockingVerdict, testDeps } from './fixtures/deps';
import { fakeGitHub, pullRequestPayload, NEXT_SHA, type FakeGitHub } from './fixtures/github';

const route = (event: string, payload: unknown): RoutedEvent => {
  const result = routeEvent(event, payload as Record<string, unknown>);
  if (!result.act) throw new Error(`expected a job, got: ${result.reason}`);
  return result.event;
};

const opened = () => route('pull_request', pullRequestPayload());

const pushed = (api: FakeGitHub, sha = NEXT_SHA) => {
  const payload = pullRequestPayload({ action: 'synchronize' });
  payload.pull_request.head.sha = sha;
  api.setHead(sha);
  return route('pull_request', payload);
};

describe('the spine', () => {
  let api: FakeGitHub;
  let deps: ReviewDeps;

  beforeEach(() => {
    api = fakeGitHub({ appId: 42 });
    deps = testDeps(api);
  });

  test('a pull request gets exactly one comment, edited from reviewing to verdict', async () => {
    await runReview(opened(), deps);

    expect(api.comments.size).toBe(1);

    const created = api.calls.filter((call) => call.kind === 'createIssueComment');
    expect(created).toHaveLength(1);
    expect(api.calls.map((call) => call.kind)).toContain('updateIssueComment');

    const [comment] = [...api.comments.values()];
    expect(comment?.body?.startsWith(STICKY_MARKER)).toBe(true);
    expect(comment?.body).toContain('🟢 Clean');
  });

  test('a second push edits the same comment instead of starting a thread', async () => {
    await runReview(opened(), deps);
    const firstId = [...api.comments.keys()][0];

    await runReview(pushed(api), deps);

    expect(api.comments.size).toBe(1);
    expect([...api.comments.keys()][0]).toBe(firstId);
    expect([...api.comments.values()][0]?.body).toContain('`b7d20ff`');
  });

  test('the check run opens in progress and closes with a conclusion', async () => {
    await runReview(opened(), deps);

    const transitions = api.calls
      .filter((call) => call.kind === 'createCheckRun' || call.kind === 'updateCheckRun')
      .map((call) => call.args as { status: string; conclusion?: string });

    expect(transitions[0]).toMatchObject({ status: 'in_progress' });
    expect(transitions.at(-1)).toMatchObject({ status: 'completed', conclusion: 'success' });
  });

  test('a blocking verdict stays advisory until a team turns the gate on', async () => {
    deps = testDeps(api, { verdict: blockingVerdict });

    await runReview(opened(), deps);

    const last = api.calls.filter((c) => c.kind === 'updateCheckRun').at(-1);
    expect(last?.args).toMatchObject({ conclusion: 'neutral' });
    expect([...api.comments.values()][0]?.body).toContain('🔴 Strategic blocker');
  });

  test('a new commit gets its own check run, not an edit of the old one', async () => {
    await runReview(opened(), deps);
    await runReview(pushed(api), deps);

    expect(api.checkRuns.size).toBe(2);
  });

  test('a slash command resolves the commit it was not given', async () => {
    const command = route('issue_comment', {
      action: 'created',
      installation: { id: 7 },
      repository: { name: 'tutorx', owner: { login: 'z10labs' } },
      sender: { login: 'dzithendo', type: 'User' },
      issue: { number: 241, pull_request: {} },
      comment: { body: '/watchman review' },
    });

    expect(command.headSha).toBeUndefined();

    const outcome = await runReview(command, deps);

    expect(api.calls.map((call) => call.kind)).toContain('getPullRequest');
    expect(outcome.request.headSha).toHaveLength(40);
    expect(outcome.request.baseRef).toBe('main');
  });

  test('a review that throws says so in the comment and fails the check', async () => {
    deps = {
      ...deps,
      perform: {
        ...deps.perform,
        engine: () => Promise.reject(new Error('model request timed out')),
      },
    };

    await expect(runReview(opened(), deps)).rejects.toThrow('model request timed out');

    expect(api.comments.size).toBe(1);
    expect([...api.comments.values()][0]?.body).toContain('model request timed out');
    expect([...api.checkRuns.values()][0]).toMatchObject({
      status: 'completed',
      conclusion: 'failure',
    });
  });

  test('the placeholder is up before the engine is called', async () => {
    const order: string[] = [];
    deps = {
      ...deps,
      perform: {
        ...deps.perform,
        engine: async () => {
          order.push(`comments:${api.comments.size}`);
          return {
            verdict: {
              status: 'clean' as const,
              findings: [],
              bottomLine: 'ship it',
            },
            costCents: 0,
          };
        },
      },
    };

    await runReview(opened(), deps);

    expect(order).toEqual(['comments:1']);
  });
});

describe('superseded runs', () => {
  let api: FakeGitHub;
  let deps: ReviewDeps;

  beforeEach(() => {
    api = fakeGitHub({ appId: 42 });
    deps = testDeps(api);
  });

  test('a verdict for a superseded commit is never written', async () => {
    // The push lands while the model is still thinking — exactly the window
    // Inngest's asynchronous cancellation cannot close.
    deps = {
      ...deps,
      perform: {
        ...deps.perform,
        engine: async () => {
          api.setHead(NEXT_SHA);
          return { verdict: { status: 'clean', findings: [], bottomLine: 'ship it' }, costCents: 0 };
        },
      },
    };

    const outcome = await runReview(opened(), deps);

    expect(outcome.published).toBe(false);
    expect([...api.comments.values()][0]?.body).toContain('🟡 Reviewing');
    expect([...api.checkRuns.values()][0]?.status).toBe('in_progress');
  });

  test('a failure on a superseded commit does not overwrite the newer verdict', async () => {
    deps = {
      ...deps,
      perform: {
        ...deps.perform,
        engine: async () => {
          api.setHead(NEXT_SHA);
          throw new Error('model request timed out');
        },
      },
    };

    await expect(runReview(opened(), deps)).rejects.toThrow();

    expect([...api.comments.values()][0]?.body).not.toContain('Review failed');
  });

  test('publishes normally when the branch has not moved', async () => {
    const outcome = await runReview(opened(), deps);

    expect(outcome.published).toBe(true);
  });
});

describe('history carried in the comment', () => {
  let api: FakeGitHub;

  beforeEach(() => {
    api = fakeGitHub({ appId: 42 });
  });

  test('the verdict body carries state the next review can read back', async () => {
    await runReview(opened(), testDeps(api, { verdict: blockingVerdict }));

    const state = readState([...api.comments.values()][0]?.body);

    expect(state?.lastReviewedSha).toHaveLength(40);
    expect(state?.status).toBe('strategic_blocker');
    expect(state?.findings).toHaveLength(2);
    expect(state?.spentCents).toBe(11);
  });

  test('an unresolved finding keeps its age across pushes', async () => {
    const deps = testDeps(api, { verdict: blockingVerdict });
    await runReview(opened(), deps);

    // Same objection on the next commit — same fingerprint, older origin.
    api.changed = [{ ...api.changed[0]!, filename: 'src/auth/session.ts' }];
    await runReview(pushed(api), deps);

    const body = [...api.comments.values()][0]?.body ?? '';
    expect(body).toContain('unresolved since `a3f9c11`');
  });

  test('spend accumulates across reviews of the same pull request', async () => {
    const deps = testDeps(api, { verdict: blockingVerdict, costCents: 11 });
    await runReview(opened(), deps);
    api.changed = [{ ...api.changed[0]!, filename: 'src/auth/session.ts' }];
    await runReview(pushed(api), deps);

    expect(readState([...api.comments.values()][0]?.body)?.spentCents).toBe(22);
  });
});

describe('eventId', () => {
  const routed = (overrides: Partial<RoutedEvent>): RoutedEvent => ({
    installationId: 7,
    owner: 'z10labs',
    repo: 'tutorx',
    prNumber: 241,
    trigger: 'opened',
    prKey: 'z10labs/tutorx#241',
    forced: false,
    headSha: 'a3f9c11',
    ...overrides,
  });

  test('a replayed delivery for the same commit collapses to one job', () => {
    expect(eventId(routed({}))).toBe(eventId(routed({})));
  });

  test('a new commit is a new job', () => {
    expect(eventId(routed({}))).not.toBe(eventId(routed({ headSha: 'b7d20ff' })));
  });

  test('asking again explicitly always runs again', () => {
    const nonce = vi.fn().mockReturnValueOnce('one').mockReturnValueOnce('two');
    const forced = routed({ forced: true, trigger: 'command' });

    expect(eventId(forced, nonce)).not.toBe(eventId(forced, nonce));
  });
});
