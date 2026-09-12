/**
 * `watchman review` — the CI deployment of the Watchman.
 *
 * One GitHub Actions job, reading the event the runner hands it and leaving one
 * verdict comment on the pull request, edited in place. It is the same engine
 * as the hosted app — same router, same preflight, same tiering, same renderer
 * — authenticated with the workflow's `GITHUB_TOKEN` instead of an App
 * installation. Nothing here reviews anything; it wires and reports.
 *
 * The first CI Watchman ran the expensive pass on every push against a rubric
 * that did not exist, cost ~$2.58 a pull request, and was deleted after four
 * days. This one prints what it cost on every run, because the number is the
 * point.
 */
import { appendFile, readFile } from 'node:fs/promises';
import { loadActionsEnv, type ActionsEnv } from '../env';
import { anthropicGenerate, anthropicTriage } from '../engine/anthropic';
import { createEngine } from '../engine/index';
import { tokenApi } from '../github/token-api';
import type { PerformResult } from '../jobs/perform';
import { runReview, type ReviewDeps } from '../jobs/review';
import type { GateMode } from '../render/comment';
import { createMemoryStore } from '../store/index';
import type { Verdict } from '../types';
import { routeEvent } from '../webhook/router';

export type Out = (line: string) => void;

const stdout: Out = (line) => process.stdout.write(`${line}\n`);

const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/**
 * Whether the job itself fails.
 *
 * Only two outcomes do: a broken installation, which is a fault and not a
 * judgement; and a strategic blocker once a team has turned the gate to
 * `required`. Under `advisory` a blocker exits 0 — the check run carries the
 * signal, and a red job nobody trusts yet would only teach people to ignore it.
 */
export function exitCodeFor(verdict: Verdict, gateMode: GateMode): number {
  if (verdict.status === 'unconfigured') return 1;
  if (verdict.status === 'strategic_blocker' && gateMode === 'required') return 1;
  return 0;
}

function countBy(verdict: Verdict) {
  const counts = { block: 0, warn: 0, info: 0 };
  for (const finding of verdict.findings) counts[finding.severity] += 1;
  return counts;
}

/** The one line a person reads in the job log. */
export function summaryLine(result: PerformResult): string {
  const { block, warn, info } = countBy(result.verdict);
  const thisRun = result.verdict.stats?.costCents ?? 0;
  return (
    `watchman: tier=${result.tier} status=${result.verdict.status} ` +
    `findings=${result.verdict.findings.length} (${block} block, ${warn} warn, ${info} info) ` +
    `cost=${dollars(thisRun)} pr_total=${dollars(result.state.spentCents)} — ${result.reason}`
  );
}

/** The same facts, as the markdown GitHub shows on the run's summary page. */
export function jobSummary(result: PerformResult): string {
  const { block, warn, info } = countBy(result.verdict);
  const thisRun = result.verdict.stats?.costCents ?? 0;
  return [
    '### Watchman — strategic alignment',
    '',
    '| Tier | Verdict | Findings | This run | Pull request total |',
    '| --- | --- | --- | --- | --- |',
    `| ${result.tier} | ${result.verdict.status} | ${block} block · ${warn} warn · ${info} info ` +
      `| ${dollars(thisRun)} | ${dollars(result.state.spentCents)} |`,
    '',
    result.reason,
    '',
  ].join('\n');
}

/**
 * Production wiring: the workflow's token, the real models, no database.
 *
 * `appId` is null because comments made with `GITHUB_TOKEN` are authored by
 * the Actions app, not by one we control; the sticky scan falls back to the
 * marker alone. Findings history still travels in the comment body.
 */
export function productionDeps(env: ActionsEnv): ReviewDeps {
  const [owner = '', repo = ''] = env.GITHUB_REPOSITORY.split('/');
  const api = tokenApi(env.GITHUB_TOKEN, owner, repo, {
    ...(env.GITHUB_API_URL ? { baseUrl: env.GITHUB_API_URL } : {}),
  });

  return {
    store: createMemoryStore(),
    gateMode: env.WATCHMAN_GATE_MODE,
    appId: null,
    apiFor: async () => api,
    now: () => new Date(),
    perform: {
      engine: createEngine(anthropicGenerate()),
      triageModel: anthropicTriage(),
      fallbackGateMode: env.WATCHMAN_GATE_MODE,
    },
  };
}

async function readEvent(path: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`watchman: ${path} does not contain an event object`);
  }
  return parsed as Record<string, unknown>;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export interface CiReviewInput {
  readonly env: ActionsEnv;
  readonly deps: ReviewDeps;
  readonly out?: Out;
}

/**
 * The job. Returns the process exit code rather than calling `process.exit`,
 * so tests can drive it end to end with a fake GitHub and a fake model.
 */
export async function ciReview({ env, deps, out = stdout }: CiReviewInput): Promise<number> {
  let payload: Record<string, unknown>;
  try {
    payload = await readEvent(env.GITHUB_EVENT_PATH);
  } catch (error) {
    out(`watchman: could not read the event payload — ${messageOf(error)}`);
    return 1;
  }

  // The same router as the webhook. A skipped event is a success: the job ran,
  // looked, and correctly decided this was not a review.
  const routed = routeEvent(env.GITHUB_EVENT_NAME, payload, { credential: 'token' });
  if (!routed.act) {
    out(`watchman: skipped — ${routed.reason}`);
    return 0;
  }

  const eventRepo = `${routed.event.owner}/${routed.event.repo}`;
  if (eventRepo !== env.GITHUB_REPOSITORY) {
    out(`watchman: event is for ${eventRepo} but this job runs in ${env.GITHUB_REPOSITORY}; refusing`);
    return 1;
  }

  if (!env.ANTHROPIC_API_KEY) {
    out('watchman: ANTHROPIC_API_KEY is not set — only a zero-cost tier can succeed this run');
  }

  try {
    const outcome = await runReview(routed.event, deps);

    if (!outcome.published) {
      // Spend is real even when the verdict is discarded; say so.
      const spent = dollars(outcome.result.verdict.stats?.costCents ?? 0);
      out(
        `watchman: ${routed.event.prKey} moved past ${outcome.request.headSha.slice(0, 7)}; ` +
          `nothing written (cost=${spent}, discarded)`,
      );
      return 0;
    }

    out(summaryLine(outcome.result));
    if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, jobSummary(outcome.result));

    return exitCodeFor(outcome.result.verdict, outcome.result.gateMode);
  } catch (error) {
    // If the slot was claimed, runReview has already put the failure in the
    // comment and failed the check. If the very first write was refused — a fork
    // pull request's read-only token — this log line is the only record.
    out(`watchman: review failed — ${messageOf(error)}`);
    return 1;
  }
}

// Only run when invoked directly, so the function stays importable by tests.
if (process.argv[1]?.endsWith('review.ts') || process.argv[1]?.endsWith('review.js')) {
  const env = loadActionsEnv();
  const code = await ciReview({ env, deps: productionDeps(env) });
  process.exit(code);
}
