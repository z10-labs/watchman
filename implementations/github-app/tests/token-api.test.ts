/**
 * The token-backed client, driven through a fake transport.
 *
 * Octokit accepts a `fetch` replacement, so every assertion here goes through
 * the real request pipeline — URL building, auth header, error construction —
 * and stops one layer short of the network.
 */
import { describe, expect, test } from 'vitest';
import { NotFoundError, type GitHubApi } from '../src/github/api';
import { tokenApi } from '../src/github/token-api';
import { CHECK_NAME } from '../src/webhook/router';
import { fakeGitHub } from './fixtures/github';

interface Route {
  readonly method: string;
  readonly path: RegExp;
  readonly status: number;
  readonly body?: unknown;
}

interface Seen {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

function transport(routes: readonly Route[]) {
  const seen: Seen[] = [];

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = Object.fromEntries(
      Object.entries((init?.headers as Record<string, string> | undefined) ?? {}).map(
        ([key, value]) => [key.toLowerCase(), String(value)],
      ),
    );
    seen.push({ method, url, headers, body: init?.body ? JSON.parse(String(init.body)) : null });

    const route = routes.find((r) => r.method === method && r.path.test(new URL(url).pathname));
    const status = route?.status ?? 500;
    const body = route?.body ?? { message: status === 404 ? 'Not Found' : 'boom' };

    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  };

  return { fetch, seen };
}

const api = (routes: readonly Route[]) => {
  const t = transport(routes);
  return { api: tokenApi('ghs_test', 'z10labs', 'tutorx', { fetch: t.fetch }), seen: t.seen };
};

describe('tokenApi — the 404 mapping the sticky upsert depends on', () => {
  test('a deleted comment surfaces as NotFoundError, not a raw request error', async () => {
    const { api: client } = api([{ method: 'PATCH', path: /\/issues\/comments\/1001$/, status: 404 }]);

    await expect(client.updateIssueComment(1001, 'body')).rejects.toBeInstanceOf(NotFoundError);
  });

  test('a deleted check run surfaces the same way', async () => {
    const { api: client } = api([{ method: 'PATCH', path: /\/check-runs\/77$/, status: 404 }]);

    await expect(
      client.updateCheckRun(77, { headSha: 'abc', status: 'completed', title: 't', summary: 's' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test('a missing file reads as null and a missing directory as empty', async () => {
    const { api: client } = api([{ method: 'GET', path: /\/contents\//, status: 404 }]);

    expect(await client.getFile('.watchman.yml', 'main')).toBeNull();
    expect(await client.listDir('docs/decisions', 'main')).toEqual([]);
  });

  test('other failures are not disguised as not-found', async () => {
    const { api: client } = api([{ method: 'PATCH', path: /\/issues\/comments\//, status: 403 }]);

    const error = await client.updateIssueComment(1, 'x').catch((e: unknown) => e);

    expect(error).not.toBeInstanceOf(NotFoundError);
    expect((error as { status?: number }).status).toBe(403);
  });
});

describe('tokenApi — the happy path', () => {
  test('authenticates every request with the token it was given', async () => {
    const { api: client, seen } = api([
      { method: 'GET', path: /\/repos\/z10labs\/tutorx$/, status: 200, body: { default_branch: 'main' } },
    ]);

    expect(await client.getDefaultBranch()).toBe('main');
    expect(seen[0]?.headers.authorization).toBe('token ghs_test');
  });

  test('talks to the API host the runner names, for GitHub Enterprise', async () => {
    const t = transport([{ method: 'GET', path: /\/repos\//, status: 200, body: { default_branch: 'x' } }]);
    const client = tokenApi('t', 'o', 'r', { fetch: t.fetch, baseUrl: 'https://ghe.example.com/api/v3' });

    await client.getDefaultBranch();

    expect(t.seen[0]?.url).toBe('https://ghe.example.com/api/v3/repos/o/r');
  });

  test('decodes file content and keeps the ref it was asked for', async () => {
    const { api: client, seen } = api([
      {
        method: 'GET',
        path: /\/contents\/\.watchman\.yml$/,
        status: 200,
        body: { type: 'file', content: Buffer.from('version: 1\n').toString('base64') },
      },
    ]);

    expect(await client.getFile('.watchman.yml', 'main')).toBe('version: 1\n');
    expect(seen[0]?.url).toContain('ref=main');
  });

  test('maps a pull request to the fields the pipeline reads', async () => {
    const { api: client } = api([
      {
        method: 'GET',
        path: /\/pulls\/241$/,
        status: 200,
        body: { head: { sha: 'a3f9c11' }, base: { ref: 'main' }, title: 'feat', draft: false },
      },
    ]);

    expect(await client.getPullRequest(241)).toEqual({
      headSha: 'a3f9c11',
      baseRef: 'main',
      title: 'feat',
      draft: false,
    });
  });

  test('creates the check run under the name the router answers re-requests on', async () => {
    const { api: client, seen } = api([
      { method: 'POST', path: /\/check-runs$/, status: 201, body: { id: 9 } },
    ]);

    const created = await client.createCheckRun({
      headSha: 'abc',
      status: 'in_progress',
      title: 'Reviewing',
      summary: 's',
    });

    expect(created.id).toBe(9);
    expect((seen[0]?.body as { name: string }).name).toBe(CHECK_NAME);
  });

  test('a comment with no app behind it reports appId null', async () => {
    const { api: client } = api([
      {
        method: 'GET',
        path: /\/issues\/241\/comments$/,
        status: 200,
        body: [{ id: 1, body: 'hi' }, { id: 2, body: null, performed_via_github_app: { id: 15368 } }],
      },
    ]);

    expect(await client.listIssueComments(241)).toEqual([
      { id: 1, body: 'hi', appId: null },
      { id: 2, body: null, appId: 15368 },
    ]);
  });
});

describe('tokenApi — the interface is the contract', () => {
  /** Compile-time complete: adding a method to GitHubApi breaks this object. */
  const CONTRACT: Record<Exclude<keyof GitHubApi, 'owner' | 'repo'>, true> = {
    getPullRequest: true,
    getDefaultBranch: true,
    getFile: true,
    listDir: true,
    listChangedFiles: true,
    compareCommits: true,
    listIssueComments: true,
    createIssueComment: true,
    updateIssueComment: true,
    createCheckRun: true,
    updateCheckRun: true,
  };

  test('implements every method the fake does, scoped to one repository', () => {
    const real = tokenApi('ghs_test', 'z10labs', 'tutorx');
    const fake = fakeGitHub();

    for (const method of Object.keys(CONTRACT) as (keyof typeof CONTRACT)[]) {
      expect(typeof real[method]).toBe('function');
      expect(typeof fake[method]).toBe('function');
    }
    expect(real.owner).toBe('z10labs');
    expect(real.repo).toBe('tutorx');
  });
});
