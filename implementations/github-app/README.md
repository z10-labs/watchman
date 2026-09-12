# Watchman — GitHub App

A hosted implementation of the [Watchman](../../docs/concept.md): a service that reviews a pull
request for *strategic alignment* and leaves one verdict on it, edited in place.

**Status: M0–M4 built, not yet run against a live GitHub App.** 236 tests, typecheck and production
build all pass. Everything that can be verified without an installation and an API key has been;
the runbook for the rest is below.

The engine has **two deployment shapes** that share every module: a hosted webhook service, and a
[GitHub Actions job](#running-it-in-ci) authenticated with the workflow's own token. Same router,
same preflight, same tiering, same renderer; only where the credential comes from differs.

```bash
pnpm install
pnpm test        # 236 tests
pnpm typecheck
pnpm build
pnpm run doctor .   # runs the production preflight against a working copy
pnpm run review     # the CI entrypoint; reads its inputs from the Actions environment
```

## Why this shape

The first Watchman ran as a CI job and died in four days: ~10 min, ~37 turns, ~$2.58/PR, fired
unconditionally on every push ([research §4.4](../../docs/research.md)). Read that incident closely
and the fault is *triggering*, not hosting.

What hosting buys is the fix for the deeper failure: sub-agents that could not reach the reviewer
graded themselves ([failure-modes §3](../../docs/failure-modes.md)). This service reviews from a
process that never saw the author's reasoning and reads the source of truth from the default branch.
Context independence stops being a discipline someone maintains and becomes a property of the
architecture.

## What it does

```
GitHub ──signed──▶ webhook route ─▶ queue ─▶ preflight ─▶ triage → review ─▶ renderer ─▶ writer
   ▲                                                          │                            │
   └──────────── PATCH one comment · check run ───────────────┼────────────────────────────┘
                                                        Anthropic
```

1. **Verifies** the delivery against the raw body before parsing it.
2. **Routes** the event — opened / reopened / ready_for_review / synchronize, `/watchman review`,
   and re-requests of our own check run. Drafts, bots and `[auto-fix]` titles drop out with a reason
   returned in an `x-watchman-skipped` header.
3. **Enqueues** one job per pull request, debounced 60s, cancelled when a newer commit arrives.
4. **Claims the slot** — the sticky comment goes up as *Reviewing* within seconds.
5. **Preflights** config, required reading and rubric integrity, from the **default branch**. Any
   miss and the comment becomes a configuration error. There is no degraded review.
6. **Triages** pushes against path rules first, a cheap model only if those cannot settle it.
7. **Reviews** with the rubric and brain documents in a cached prompt prefix, the diff as delimited
   untrusted data, and a fixed output schema.
8. **Renders and publishes** — we own the markdown and derive the check conclusion from severities.
9. **Carries state forward** in the comment body, so findings keep an identity and an age.

## The decisions worth knowing about

**No database.** The sticky comment carries its own history in an HTML comment
(`<!-- watchman:state:v1 {...} -->`), which GitHub renders as nothing. That buys findings their
identity and age across pushes without a connection string, and state dies with the pull request it
describes. Limits: ~64KB per comment body, and a human deleting the comment loses that PR's history —
both degradations, not failures. A store becomes necessary for cross-PR aggregates (spend by
installation, the findings corpus); [`db/schema.sql`](db/schema.sql) is what it would hold.

**The model cannot set the verdict.** [`schema.ts`](src/engine/schema.ts) lets it return findings and
severities — not a status. The service derives `clean` / `soft_warnings` / `strategic_blocker`
mechanically, and derives the check conclusion from that. A prompt injection in a diff can at worst
produce a wrong finding; it cannot reach the gate.

**Newest commit wins, in our code.** Inngest cancels a superseded run asynchronously, so a run can
finish a step after a newer commit lands. Every publish re-reads the head first and stands down if it
moved.

**Advisory by default.** A strategic blocker resolves to a `neutral` check until a team sets
`gate.mode: required`. A *broken installation* fails the check in either mode — that is not a
judgement, it is a fault.

**The reviewer holds no write credential** beyond its own comment and check run. `contents` is
read-only. See "Not built" below.

## Configuration

```yaml
# .watchman.yml — read from the default branch, never from the PR head
version: 1

brain:
  path: docs/
  required_reading:
    - map-of-content.md
    - positioning.md
    - architecture/overview.md
  decisions: decisions/

rubric: .watchman/rubric.md

gate:
  mode: advisory          # advisory | required
  max_diff_lines: 500
  skip_paths: ["**/*.snap", "pnpm-lock.yaml"]
```

Preflight refuses — loudly, on the pull request — when the config is missing or malformed, when a
required document does not resolve, or when the rubric is missing, under 400 characters, still
contains `<PLACEHOLDER>` tokens, or has no *out of scope* section. That last check is not pedantry: a
rubric without refusals spends its budget on style notes CI already produces for free.

`pnpm run doctor <path>` runs exactly that preflight against a working copy, so a broken rubric is
found by the person who broke it rather than four days later.

## Cost control

| Event | What runs | Model calls |
|---|---|---|
| opened / ready_for_review / reopened | full review | 1 review |
| `/watchman review`, check re-requested | full review, triage skipped | 1 review |
| push, docs/tests/assets only | nothing; previous verdict stands | 0 |
| push, known strategic path | incremental review of the delta | 1 review |
| push, ambiguous | cheap triage, then maybe a review | 1 triage (+1 review) |
| diff over `max_diff_lines` | bounded — asks to split | 0 |

Plus: rubric and brain documents in a cached prefix, 60s debounce, `skip_paths` applied before
anything counts lines, and the cost of each review printed in the comment footer and accumulated in
the state blob.

## Layout

| Path | What it is |
|---|---|
| `src/webhook/` | Signature verification, and the pure event → job router. |
| `src/config/`, `src/preflight/` | `.watchman.yml`, document resolution, rubric integrity, refusal. |
| `src/policy/trigger.ts` | Pure tier decision: full / incremental / refresh / bounded / skip. |
| `src/engine/` | Triage, prompt construction, verdict schema, fingerprints, Anthropic binding. |
| `src/state/blob.ts` | Review history, carried in the comment body. |
| `src/github/` | The only surface of GitHub the service touches, plus the doc sources. `octokit-api.ts` is the one implementation; `installationApi` and `tokenApi` differ only in credential. |
| `src/jobs/` | begin → perform → publish, and the Inngest wiring. |
| `src/cli/doctor.ts` | The production preflight, run locally. |
| `src/cli/review.ts` | The CI entrypoint: route the Actions event, run the pipeline, print the cost, set the exit code. |
| `.github/workflows/watchman.yml` | The workflow teams copy. Preflight as its own step; no `contents: write`. |

## Running it in CI

The same engine as a GitHub Actions job, for teams that want the reviewer without hosting anything.
The template is [`.github/workflows/watchman.yml`](.github/workflows/watchman.yml); copy it into
your repository's `.github/workflows/`.

**This is the shape that died in four days the first time** ([failure-modes §4](../../docs/failure-modes.md)),
so the job is built around what killed it:

| v1 | This job |
|---|---|
| Ran the expensive pass on every push, ~$2.58/PR | Path-rule triage first; a docs-only push costs $0.00 and no model call. Over `gate.max_diff_lines`, no model call either. |
| Pointed at a rubric path that did not exist and reviewed anyway | `pnpm run doctor` is its own step before anything expensive, and fails the job. The engine re-runs the same preflight and will not review past a failure — it posts *not configured* and exits 1. |
| A fresh comment per run | One sticky comment per PR, edited in place; history in its body. Same `sticky.ts`, same state blob. |
| Could have pushed | `contents: read`. The token cannot commit, branch, or open a PR. |
| Cost was discovered from the invoice | Cost is in the comment footer, the job log line, and the run's summary page, every run. |

What you need:

1. `ANTHROPIC_API_KEY` as a repository secret. `GITHUB_TOKEN` is the workflow's own; nothing else.
2. A `.watchman.yml` and a rubric on the default branch — the same files the hosted app reads, from the
   same ref. Run `pnpm run doctor <path-to-your-repo>` from this directory before opening a PR.
3. Optionally `WATCHMAN_GATE_MODE: required` in the workflow. `.watchman.yml`'s `gate.mode` wins when
   the two disagree; the env var is only the fallback for when config cannot be read.

What the job does, in order: route the event through the same `routeEvent` as the webhook (a skipped
event exits 0 with the reason printed); put the *Reviewing* comment and an `in_progress` check up
before the model runs; `performReview`; publish the verdict and the check conclusion; print one line
— tier, status, finding counts, cost, running total.

**Exit code.** 0, unless the verdict is `unconfigured` (a broken installation), or the gate is
`required` and the verdict is `strategic_blocker`. A blocker under `advisory` exits 0: the check run
carries the signal, and a red job nobody trusts yet teaches people to ignore red jobs. A review that
throws exits 1 after writing the failure into the comment and the check.

**Known limits of this shape.**

- Pull requests from forks get a read-only `GITHUB_TOKEN` and no secrets, so the very first write —
  the *Reviewing* placeholder — is refused and the job fails with only a log line to show for it.
  The hosted app has no such limit; that is the main reason it exists.
- Comments made with `GITHUB_TOKEN` are authored by the Actions app, not by one we control, so the
  sticky scan matches on the marker alone (`appId: null`) rather than marker plus author. That means
  the CI job will adopt — and overwrite — a comment the hosted app left on the same pull request.
  Do not run both shapes on one repository.
- `/watchman review` is a billed model call, so the workflow's `if:` only honours it from an
  `OWNER`, `MEMBER` or `COLLABORATOR`. The hosted app has no such check yet.
- `fetch-depth: 0` on the reviewed-repository checkout is there for teams whose preflight or rubric
  wants history; the engine itself reads the diff through the API and does not need it.
- The `concurrency` group cancels a superseded run; the engine also re-reads the head before every
  write and stands down if it moved, exactly as the hosted app does.

## Running it against a real repository

1. **Register the app** (Settings → Developer settings → GitHub Apps → New).
   - Permissions: `contents: read`, `pull requests: write`, `checks: write`, `metadata: read`.
   - Events: **Pull request**, **Issue comment**, **Check run**.
   - Generate a private key, set a webhook secret.
2. **Fill `.env`** from `.env.example` (app id, private key, webhook secret, `ANTHROPIC_API_KEY`).
3. **Run three processes:**
   ```bash
   pnpm dev
   pnpm inngest:dev
   SMEE_URL=https://smee.io/your-channel pnpm tunnel
   ```
4. **Add `.watchman.yml` and a rubric** to the test repo, then `pnpm run doctor .` in that repo
   before opening a pull request. Adapt the rubric from
   [`../claude-code-subagent/template/.claude/prompts/watchman.md`](../claude-code-subagent/template/.claude/prompts/watchman.md).
5. **Install the app** and open a pull request.

## Not built, on purpose

- **`/watchman log-decision`.** Turning a finding into a decision-file PR needs `contents: write`,
  which contradicts the permission stance above. The resolution — a separate, differently
  credentialed writer, triggered by a human — is a decision for z10Labs, not one to make at build
  time. Findings already say *log a decision file*; a person still writes it.
- **Cross-installation budget caps.** Cost is measured, printed and accumulated per pull request.
  Enforcing a monthly cap across repositories needs shared state we deliberately deferred.
- **Anthropic prompt-cache verification.** The cacheable/variable split is built and tested;
  that the provider actually reports a cache hit needs one live call to confirm.
- **A persistent store.** See "No database" above.

## What has not been verified

Everything above the network line is tested; nothing below it has run. Specifically: the live
delivery loop, the Inngest `cancelOn` and `debounce` expressions, real Anthropic calls, and the
observed cost per pull request — which is the number the whole economic argument rests on, and which
must be measured before it appears in any pitch.

For the CI shape specifically: the workflow has not been run on a real repository. `ciReview` is
driven end to end by `tests/ci-review.test.ts` with recorded-shape payloads and the same fake GitHub
the hosted app is tested against; `tokenApi` is driven through Octokit's real request pipeline with
a fake transport. What has not been exercised is the Actions runner itself — checkout of the engine,
`GITHUB_TOKEN` scopes on a real comment and check run, and the `if:` expression against live events.
