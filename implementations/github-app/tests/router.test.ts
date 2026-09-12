import { describe, expect, test } from 'vitest';
import { routeEvent, CHECK_NAME } from '../src/webhook/router';
import { pullRequestPayload } from './fixtures/github';

const reason = (result: ReturnType<typeof routeEvent>) =>
  result.act ? '' : result.reason;

describe('routeEvent — pull_request', () => {
  test('queues a job when a pull request is opened', () => {
    const result = routeEvent('pull_request', pullRequestPayload());

    expect(result.act).toBe(true);
    if (!result.act) return;
    expect(result.event).toMatchObject({
      installationId: 7,
      owner: 'z10labs',
      repo: 'tutorx',
      prNumber: 241,
      trigger: 'opened',
      prKey: 'z10labs/tutorx#241',
      forced: false,
      headSha: 'a3f9c11bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      baseRef: 'main',
    });
  });

  test.each(['reopened', 'ready_for_review', 'synchronize'])('acts on %s', (action) => {
    expect(routeEvent('pull_request', pullRequestPayload({ action })).act).toBe(true);
  });

  test.each(['closed', 'labeled', 'assigned', 'edited'])('ignores %s', (action) => {
    const result = routeEvent('pull_request', pullRequestPayload({ action }));
    expect(result.act).toBe(false);
    expect(reason(result)).toContain('not reviewable');
  });

  test('skips drafts — a draft is not yet claiming to belong', () => {
    const payload = pullRequestPayload();
    payload.pull_request.draft = true;

    const result = routeEvent('pull_request', payload);
    expect(result.act).toBe(false);
    expect(reason(result)).toContain('draft');
  });

  test('skips auto-fix titles so the bot cannot review its own loop', () => {
    const payload = pullRequestPayload();
    payload.pull_request.title = '[auto-fix] lint';

    expect(routeEvent('pull_request', payload).act).toBe(false);
  });

  test.each([
    { login: 'github-actions[bot]', type: 'Bot' },
    { login: 'watchman[bot]', type: 'Bot' },
  ])('skips deliveries sent by $login', (sender) => {
    const result = routeEvent('pull_request', pullRequestPayload({ sender }));
    expect(result.act).toBe(false);
    expect(reason(result)).toContain('bot');
  });

  test('refuses a payload missing the head commit', () => {
    const payload = pullRequestPayload();
    payload.pull_request.head = { sha: undefined } as unknown as { sha: string };

    const result = routeEvent('pull_request', payload);
    expect(result.act).toBe(false);
    expect(reason(result)).toContain('incomplete');
  });

  test('refuses a payload with no installation', () => {
    const result = routeEvent('pull_request', pullRequestPayload({ installation: undefined }));
    expect(result.act).toBe(false);
    expect(reason(result)).toContain('installation');
  });
});

describe('routeEvent — under a token credential (GitHub Actions)', () => {
  const token = { credential: 'token' } as const;

  test('accepts the payload the Actions runner writes, which names no installation', () => {
    const result = routeEvent('pull_request', pullRequestPayload({ installation: undefined }), token);

    expect(result.act).toBe(true);
    if (!result.act) return;
    expect(result.event.installationId).toBeNull();
    expect(result.event.prKey).toBe('z10labs/tutorx#241');
  });

  test('applies exactly the same rules otherwise', () => {
    const draft = pullRequestPayload({ installation: undefined });
    draft.pull_request.draft = true;
    expect(routeEvent('pull_request', draft, token).act).toBe(false);

    const bot = pullRequestPayload({ installation: undefined, sender: { login: 'x[bot]', type: 'Bot' } });
    expect(routeEvent('pull_request', bot, token).act).toBe(false);

    const closed = pullRequestPayload({ installation: undefined, action: 'closed' });
    expect(routeEvent('pull_request', closed, token).act).toBe(false);
  });

  test('still refuses a payload with no repository', () => {
    const result = routeEvent('pull_request', pullRequestPayload({ repository: undefined }), token);
    expect(result.act).toBe(false);
    expect(reason(result)).toContain('repository');
  });

  test('keeps an installation id when the payload does carry one', () => {
    const result = routeEvent('pull_request', pullRequestPayload(), token);
    expect(result.act && result.event.installationId).toBe(7);
  });
});

describe('routeEvent — slash commands', () => {
  const commentPayload = (body: string) => ({
    action: 'created',
    installation: { id: 7 },
    repository: { name: 'tutorx', owner: { login: 'z10labs' } },
    sender: { login: 'dzithendo', type: 'User' },
    issue: { number: 241, pull_request: { url: 'https://api.github.com/...' } },
    comment: { body },
  });

  test('forces a review on /watchman review', () => {
    const result = routeEvent('issue_comment', commentPayload('/watchman review'));

    expect(result.act).toBe(true);
    if (!result.act) return;
    expect(result.event.trigger).toBe('command');
    expect(result.event.forced).toBe(true);
    // The payload carries no commit — the job resolves it.
    expect(result.event.headSha).toBeUndefined();
  });

  test('tolerates surrounding whitespace', () => {
    expect(routeEvent('issue_comment', commentPayload('  /watchman review  ')).act).toBe(true);
  });

  test('ignores ordinary comments', () => {
    const result = routeEvent('issue_comment', commentPayload('looks good to me'));
    expect(result.act).toBe(false);
    expect(reason(result)).toContain('not a watchman command');
  });

  test('ignores unsupported subcommands rather than guessing', () => {
    const result = routeEvent('issue_comment', commentPayload('/watchman deploy'));
    expect(result.act).toBe(false);
    expect(reason(result)).toContain('unsupported command');
  });

  test('ignores comment edits and deletions', () => {
    const payload = { ...commentPayload('/watchman review'), action: 'edited' };

    expect(routeEvent('issue_comment', payload).act).toBe(false);
  });

  test('ignores a bare /watchman with no subcommand', () => {
    const result = routeEvent('issue_comment', commentPayload('/watchman'));
    expect(result.act).toBe(false);
    expect(reason(result)).toContain('unsupported command');
  });

  test('ignores comments on issues that are not pull requests', () => {
    const payload = commentPayload('/watchman review');
    delete (payload.issue as Record<string, unknown>).pull_request;

    expect(routeEvent('issue_comment', payload).act).toBe(false);
  });
});

describe('routeEvent — check_run', () => {
  const checkPayload = (name: string) => ({
    action: 'rerequested',
    installation: { id: 7 },
    repository: { name: 'tutorx', owner: { login: 'z10labs' } },
    sender: { login: 'dzithendo', type: 'User' },
    check_run: {
      name,
      head_sha: 'a3f9c11bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      pull_requests: [{ number: 241, base: { ref: 'main' } }],
    },
  });

  test('re-runs our own check when a human asks', () => {
    const result = routeEvent('check_run', checkPayload(CHECK_NAME));

    expect(result.act).toBe(true);
    if (!result.act) return;
    expect(result.event.forced).toBe(true);
    expect(result.event.trigger).toBe('rerequested');
  });

  test('ignores other checks being re-requested', () => {
    const result = routeEvent('check_run', checkPayload('ci/lint'));
    expect(result.act).toBe(false);
    expect(reason(result)).toContain('not ours');
  });

  test('ignores a check run with no pull request behind it', () => {
    const payload = checkPayload(CHECK_NAME);
    payload.check_run.pull_requests = [];

    const result = routeEvent('check_run', payload);
    expect(result.act).toBe(false);
    expect(reason(result)).toContain('no associated pull request');
  });

  test('ignores check_run events other than rerequested', () => {
    const payload = { ...checkPayload(CHECK_NAME), action: 'completed' };

    expect(routeEvent('check_run', payload).act).toBe(false);
  });
});

test('ignores events we do not handle', () => {
  expect(routeEvent('push', pullRequestPayload()).act).toBe(false);
  expect(routeEvent(null, pullRequestPayload()).act).toBe(false);
});
