import type { RouteResult, RoutedEvent, Trigger } from '../types';

/** The check run we own. Also the name we answer `rerequested` on. */
export const CHECK_NAME = 'watchman/strategic-alignment';

/** Titles we never review — the loop-breaker carried over from the v1 workflow. */
const IGNORED_TITLE_PREFIXES = ['[auto-fix]'] as const;

const REVIEWABLE_PR_ACTIONS: Record<string, Trigger> = {
  opened: 'opened',
  reopened: 'reopened',
  ready_for_review: 'ready_for_review',
  synchronize: 'synchronize',
};

const COMMAND_PREFIX = '/watchman';

/** Minimal structural shapes — we read a handful of fields, not the whole payload. */
interface AnyPayload {
  action?: string;
  installation?: { id?: number };
  repository?: { name?: string; owner?: { login?: string } };
  sender?: { login?: string; type?: string };
  pull_request?: {
    number?: number;
    draft?: boolean;
    title?: string;
    head?: { sha?: string };
    base?: { ref?: string };
  };
  issue?: { number?: number; pull_request?: unknown };
  comment?: { body?: string };
  check_run?: {
    name?: string;
    head_sha?: string;
    pull_requests?: { number?: number; base?: { ref?: string } }[];
  };
}

/**
 * How the job that follows will authenticate.
 *
 * A GitHub App delivery names its installation and the job exchanges that for a
 * token, so the payload must carry one. A GitHub Actions run already holds the
 * workflow's token and its payloads never mention an installation — requiring
 * one there would skip every event. The routing rules are otherwise identical,
 * which is the point of asking the caller rather than forking the router.
 */
export type Credential = 'installation' | 'token';

export interface RouteContext {
  readonly credential: Credential;
}

const WEBHOOK: RouteContext = { credential: 'installation' };

const skip = (reason: string): RouteResult => ({ act: false, reason });

function isBot(payload: AnyPayload): boolean {
  const login = payload.sender?.login ?? '';
  return payload.sender?.type === 'Bot' || login.endsWith('[bot]');
}

interface RepoParts {
  readonly owner: string;
  readonly repo: string;
  readonly installationId: number | null;
}

function base(payload: AnyPayload, context: RouteContext): RepoParts | RouteResult {
  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  if (!owner || !repo) return skip('payload missing repository');

  const installationId = payload.installation?.id ?? null;
  if (context.credential === 'installation' && installationId === null) {
    return skip('payload missing installation');
  }

  return { owner, repo, installationId };
}

const isSkip = (value: RepoParts | RouteResult): value is RouteResult => 'act' in value;

function build(
  parts: RepoParts,
  prNumber: number,
  trigger: Trigger,
  forced: boolean,
  headSha?: string,
  baseRef?: string,
): RouteResult {
  const event: RoutedEvent = {
    ...parts,
    prNumber,
    trigger,
    forced,
    prKey: `${parts.owner}/${parts.repo}#${prNumber}`,
    ...(headSha ? { headSha } : {}),
    ...(baseRef ? { baseRef } : {}),
  };
  return { act: true, event };
}

/**
 * Decide whether a delivery is worth a job, and turn it into one.
 *
 * Pure by design: every routing rule is testable without a network, a queue, or
 * a GitHub App. If a PR is being skipped in production, the reason string here
 * is the whole explanation.
 */
export function routeEvent(
  eventName: string | null,
  payload: AnyPayload,
  context: RouteContext = WEBHOOK,
): RouteResult {
  if (!eventName) return skip('no event name');

  const parts = base(payload, context);
  if (isSkip(parts)) return parts;

  if (isBot(payload)) return skip(`sender is a bot: ${payload.sender?.login}`);

  switch (eventName) {
    case 'pull_request': {
      const action = payload.action ?? '';
      const trigger = REVIEWABLE_PR_ACTIONS[action];
      if (!trigger) return skip(`pull_request.${action} is not reviewable`);

      const pr = payload.pull_request;
      const prNumber = pr?.number;
      const headSha = pr?.head?.sha;
      const baseRef = pr?.base?.ref;
      if (!prNumber || !headSha || !baseRef) return skip('pull_request payload incomplete');

      // A draft is not yet claiming to belong to the product. `ready_for_review`
      // is the moment it starts claiming, and that event still carries draft:false.
      if (pr?.draft === true) return skip('pull request is a draft');

      const title = pr?.title ?? '';
      if (IGNORED_TITLE_PREFIXES.some((prefix) => title.startsWith(prefix))) {
        return skip(`title prefix is ignored: ${title}`);
      }

      return build(parts, prNumber, trigger, false, headSha, baseRef);
    }

    case 'issue_comment': {
      if (payload.action !== 'created') return skip(`issue_comment.${payload.action} ignored`);
      if (!payload.issue?.pull_request) return skip('comment is on an issue, not a PR');

      const body = (payload.comment?.body ?? '').trim();
      if (!body.startsWith(COMMAND_PREFIX)) return skip('comment is not a watchman command');

      const command = body.slice(COMMAND_PREFIX.length).trim().split(/\s+/)[0] ?? '';
      if (command !== 'review') return skip(`unsupported command: ${command || '(none)'}`);

      const prNumber = payload.issue?.number;
      if (!prNumber) return skip('issue_comment payload incomplete');

      // No head SHA on this payload — the job resolves it from the API.
      return build(parts, prNumber, 'command', true);
    }

    case 'check_run': {
      if (payload.action !== 'rerequested') return skip(`check_run.${payload.action} ignored`);
      if (payload.check_run?.name !== CHECK_NAME) return skip('check run is not ours');

      const pr = payload.check_run?.pull_requests?.[0];
      const prNumber = pr?.number;
      if (!prNumber) return skip('check run has no associated pull request');

      return build(
        parts,
        prNumber,
        'rerequested',
        true,
        payload.check_run?.head_sha,
        pr?.base?.ref,
      );
    }

    default:
      return skip(`event ${eventName} is not handled`);
  }
}
