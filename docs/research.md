# The Watchman: research findings

Research into the `senior-watchman` agent as actually used in `project26/tutorspacesmvp-bethel`
(TutorSpaces / codename TutorX). Source material: the agent and prompt definitions, 189 pull
requests, the full git history, and 23 local Claude Code session transcripts spanning
2026-04-21 → 2026-08-03.

Prepared as the evidence base for a published blog post on the Watchman concept.

---

## 1. What the concept is

A **Watchman** is a review agent whose entire job is *strategic alignment*, defined by what it
refuses to look at.

From `.claude/prompts/watchman.md:5`:

> You are **not** a code-quality, syntax, formatter, or test-coverage reviewer. CI does that.
> You exist to catch the things CI cannot see: scope drift, contradictions with prior decisions,
> business-model fit, architectural conformance, decision discipline.
>
> If you find yourself nitpicking variable names or asking for one more test, you are doing the
> wrong job.

The insight it's built on: an LLM reviewer pointed at a diff will, by default, produce style
notes and test suggestions — the cheapest, most abundant findings. Those are exactly the
findings a linter, a typechecker and a test runner already produce for free and deterministically.
The expensive, un-automatable question — *does this change still belong to the product we said we
were building?* — gets crowded out. The Watchman's design is one long exercise in crowding it back in.

### The two files

The implementation is deliberately split:

| File | Role |
|---|---|
| `.claude/agents/senior-watchman.md` | 22 lines. Frontmatter (`tools: Read, Grep, Glob, Bash`, `model: opus`), how to get the diff, where to print. Its only real instruction is: *go read the other file.* |
| `.claude/prompts/watchman.md` | 159 lines. The actual rubric — required reading, six review dimensions, an explicit out-of-scope list, a strict output grammar, and a "things you must not do" section. |

The agent file says it outright: *"That file is your real system prompt."* This split turns out
to be load-bearing — and also the source of the project's first and most instructive failure
(§4.1).

### The six dimensions

1. **Vision drift** — does this move toward or away from the stated business model? (Multi-tenant
   SaaS for tutors; ZAR R49/R299/R799 tiers; tutors pay, students free; South African market.) A
   change pulling toward "platform for everyone" or "students pay" or "course marketplace" is drift.
2. **Architectural fit** — tenancy boundary, auth/RBAC pattern, storage, notification routing,
   shared-surface declarations.
3. **Decision conformance** — does it contradict a *resolved* entry in the decisions ledger?
   Contradiction must supersede explicitly, with a new linked entry.
4. **Scope** — is the PR doing what the task title says? "A useful refactor on the way is fine;
   a refactor that doubles the diff is not."
5. **Decision discipline** — are load-bearing choices logged as decision files? *"When in doubt,
   demand the entry. A 60-second decision file costs less than silent drift."*
6. **Cross-task impact** — does this make the next task harder than necessary?

### The out-of-scope list

Explicitly banned: code style, formatting, naming pedantry, import order, syntax/type errors,
unit-test edge-case coverage, performance micro-optimisation, defensive refactors outside the diff,
and — notably — **library choices on their merits**. On that last one the rubric is subtle:

> Your job is to assess **whether the choice is logged**, not whether it's the right choice.

And: *"If the PR author asks you to look at something in this list, decline politely and remind
them what watchman is for."*

### Output grammar

One verdict, fixed shape: a `Status` line (`Clean` | `Soft warnings` | `Strategic blocker`), zero
or more findings each carrying **Severity** (`info`/`warn`/`block`), **Finding**, **Suggested
action**, **Source** (file:line, architecture §N, decision ID, or CLAUDE.md §N), then a bottom
line. Escalation is mechanical: any one `block` → `Strategic blocker`; `warn`-only → `Soft
warnings`; else `Clean`.

Severity calibration includes a self-restraint clause: *"block — use sparingly; over-blocking
erodes signal."*

### Hard prohibitions

No `git push`, no PR opening, no file edits, no calling other agents ("you are the terminal node"),
no more than one verdict per invocation, no summarising the diff back to the author ("they wrote
it"), and no reviewing >500 lines without asking first — *"a 'Clean' verdict on a megadiff is worse
than no verdict."*

---

## 2. Where it was used — the numbers

| Metric | Value |
|---|---|
| PRs in repo | 189 |
| PRs carrying a Watchman section in the body | **96 (51%)** |
| PRs carrying a Watchman review as a comment | 3 (#116, #154, #156) |
| Explicit `senior-watchman` subagent spawns in retained transcripts | 19 |
| Recorded `Strategic blocker` verdicts | 2 (#21, #22) — both resolved pre-merge |
| Verdicts in strict `**Status:**` format | 31 → 25 Clean, 5 Soft warnings, 1 Clean (self-review) |

Adoption by month (PRs with a Watchman section / total PRs):

```
2026-04   52/65   ████████████████████████████████████████████████████
2026-05   14/44   ██████████████
2026-06    1/14   █
2026-07   28/64   ████████████████████████████
2026-08    1/2    █
```

The June collapse is the most honest datum in the set. Nothing about the policy changed; the
*process mode* changed. Watchman adoption tracks whether the project is running in orchestrated
phase mode, not whether anyone believes in the review. When the human drove tasks by hand through
the June identity pivot, the gate quietly stopped firing — except once (#116), where it was invoked
manually and produced one of the best reviews in the whole corpus.

---

## 3. How it was actually invoked

Three distinct invocation patterns, in chronological order.

### 3.1 CI (2026-04-21 → 2026-04-25, four days)

`.github/workflows/watchman.yml`, added in commit `575b11d`. Ran on
`pull_request: [opened, synchronize, reopened]` via `anthropics/claude-code-action@v1` on
`claude-opus-4-7`, with `cancel-in-progress: true` so new commits cancel and re-review the latest.
It had a preflight guard (`context/index.md` must exist), a loop-breaker (skip PRs titled
`[auto-fix]` or authored by `github-actions[bot]`), and posted exactly one top-level PR comment.

Deleted four days later in commit `c98469b`.

### 3.2 Local subagent, self-invoked by the implementing agent (Phase 1–2)

The agent doing the work spawns `senior-watchman` on its own diff before opening the PR, then
pastes the verdict verbatim into the PR description. This is what produced the two Strategic
blockers.

### 3.3 Orchestrator-run gate + mandatory self-check (2026-04-26 → present)

The current shape, and the most interesting one, because it's **two-tier**:

- **Tier 1 — self-check.** `tutorx-senior-developer` (the implementing agent) is required to read
  `.claude/prompts/watchman.md` and apply it to its own diff:

  > *`.claude/prompts/tutorx-senior-developer.md:131`* — "Write the resulting verdict as a short
  > `## Watchman self-check` section. This section MUST go into the PR description verbatim. If
  > your own watchman pass finds drift you cannot resolve without expanding scope, stop and report
  > back instead of opening the PR. **(An independent watchman pass by the orchestrator may still
  > follow — your self-check does not replace it.)**"

  Listed among the agent's hard don'ts: *"Do NOT skip the watchman self-check or omit it from the
  PR description."*

- **Tier 2 — independent pass.** The orchestrator spawns `senior-watchman` as a *fresh context*
  against the same PR, writes the verdict into the PR body via `gh pr edit --body-file`, then
  releases the sub-agent to self-merge if clean.

A real orchestrator brief, from the 2026-07-02 transcript (PR #151):

> Review PR #151 (`feat/comms-job-queue` → `phase/s2-05-communication`) — TSK-55, "Job queue
> foundation", part of S2 Phase 05.
>
> Get the diff with: `gh pr diff 151` and the PR body with `gh pr view 151`.
>
> Strategic context to check against (in `../tutorspacebrain/`):
> - `04-decisions/dec-jobs-pg-queue-eventbridge-tick.md` — the governing architecture decision …
> - `02-roadmap/s2-phase-05-communication/phase-overview.md` — phase scope: this task is queue
>   mechanics + tick endpoint + fast path ONLY; email sending is TSK-58, IaC is TSK-56 …
> - New decision files the implementing agent added — **sanity-check these don't contradict prior
>   decisions.**
>
> Focus: scope drift, contradictions with documented decisions, business-model fit,
> RLS/tenant-isolation posture. **NOT code style or correctness.**

Note what the brief does: it names the *boundaries of the task* ("this task is queue mechanics
ONLY; email sending is TSK-58") and asks the reviewer to audit the decision files the implementer
wrote to justify itself. The reviewer is being handed the fence, then asked whether anything
climbed over it.

---

## 4. The four failure modes (the best material in the corpus)

### 4.1 The empty prompt — "the appearance of review without the substance"

The single most quotable finding in this research.

`.claude/prompts/watchman.md` was committed in `575b11d` — but with the wrong content. Someone
pasted the `context/index.md` README into it. The agent file correctly told the Watchman to read
that file as its real system prompt. So:

> *PR #15, 2026-04-25* — "the agent ran every PR (locally and in the now-disabled CI workflow) with
> no rubric, no verdict taxonomy, and no scope rules. **It produced the *appearance* of review
> without the substance.**"

The CI workflow had a parallel version of the same bug: it instructed the agent to read
`.watchman/prompt.md`, a path that never existed in the repo at all.

This ran for four days across roughly a dozen PRs. Every one of them got a confident, plausible,
well-formatted review from an agent operating with no instructions. Nobody noticed until someone
went to *fix* the prompt and read the file.

**The generalisable lesson:** an LLM reviewer with a broken prompt does not fail loudly. It
produces exactly the artifact you were expecting, in the right shape, at the right time, with the
right tone. There is no stack trace for "the reviewer had no rubric." The only detection mechanism
is reading the prompt file — which is to say, the same mechanism that would have prevented it.

### 4.2 Prompt rot after a docs migration

On 2026-04-26 the project moved its source of truth off Notion and a `context/` folder onto an
Obsidian vault (`../tutorspacebrain/`). The Watchman's Required Reading still pointed at
`context/index.md`, `context/business/`, `context/architecture-docs/`, and "the Notion Decisions DB."

> *PR #29* — "Even a successful invocation would have produced a Strategic blocker on its first read."

A review agent's prompt is a hardcoded dependency on your documentation layout. Moving your docs
breaks your reviewer, silently, and the breakage surfaces as *review output*, not as an error.

Residue of this is still present today: `watchman.md:15` and `:147` declare Notion legacy and
forbid calling Notion MCP tools, while `:70` still tells the reviewer to check the dependency graph
"(visible in Notion)."

### 4.3 The sub-sub-agent ceiling — self-passing dressed up as review

Phase 2 ran four implementation sub-agents in isolated git worktrees. All four reported that the
`senior-watchman` agent type was not reachable from inside their environment, and fell back to
grading themselves against the checklist.

> *PR #29* — "A self-pass dressed up as a watchman pass produces **false confidence (same head,
> different hat)**."

This is the deepest architectural point in the whole story. The value of the Watchman is not the
rubric — the implementing agent can read the same rubric. The value is **context independence**:
a reviewer that did not participate in the reasoning that produced the diff, and therefore has not
already talked itself into it. Collapse the two into one context and you keep the artifact and lose
the entire function.

The fix (PR #29) was structural, not prompt-level: move the gate *up* a level. Sub-agents open the
PR with a placeholder `## Senior Watchman: pending — orchestrator gate` and stop. The orchestrator —
which *can* spawn a subagent, because it's spawning one level down, not two — runs the real pass and
edits the verdict in.

The limitation persisted into Phase 3. From PR #50 (phase summary, 19 tasks):

> "The `senior-watchman` subagent was not exposed inside spawned sub-agents (carried over from
> Phase 2); orchestrator-side spot-checks during merge approval found no drift."

### 4.4 CI economics

The measured reason the CI Watchman died, from PR #12:

> "`watchman.yml` — averaging ~10 min, 37 turns, **~$2.58/PR**. Also points at `.watchman/prompt.md`
> which doesn't exist in the repo, so it spends turns wandering and racks up **18 permission denials
> per run**."

What stayed live was named explicitly: *"`ci.yml` — lint / typecheck / test + Playwright (**the
actual gate**)"*.

Ten minutes and $2.58 for a review with no rubric is a bad trade at any price. But the numbers are
worth quoting even for a *working* reviewer, because they set the bar: a strategic reviewer has to
be worth more than three minutes of a senior engineer's attention per PR, every PR, forever.

---

## 5. What it actually caught

Five cases with a hard paper trail. These are the load-bearing evidence for the post — each one is
something a linter, a typechecker, a test suite and a green CI run all missed.

### 5.1 Audit rows written outside the transaction — PR #22, severity `block`

Architecture §17 mandates that the audit row and the business write land in the same transaction
("zero drops"). The PR violated it in **7 endpoints**. Watchman also traced the same bug backwards
into **TSK-13, already merged**, in 2 more endpoints.

Fix: every state-changing handler wrapped in `db.transaction(async tx => …)`, and `auditLog()`'s
signature widened to accept a transaction handle — a shared-utils API change, driven by a review
finding.

This is the strongest single argument for the concept. A tests-green, types-clean, lint-clean PR
was silently breaking a documented durability invariant, in a way that only shows up as *missing
audit rows under partial failure* — the kind of bug that surfaces during an incident, months later,
when the audit log is the thing you're relying on.

### 5.2 Dual source of truth for Google identity — PR #21, severity `block`

`users.google_id` was being written as a second home for a fact that Architecture §4 said lived in
`auth_accounts.providerAccountId`. Watchman also caught that the code comment claimed an idempotency
`IS NULL` guard the SQL did not have.

Resolution: the mirror was kept (Google's `sub` is stable, so re-link is a deterministic overwrite),
the false comment was deleted, and a decision file was filed that *explicitly supersedes
Architecture §4 on this point*. Two further findings from the same review — a `NODE_ENV`-gated
cookie domain that would have silently broken staging and every Vercel preview, and a public type
defined in `apps/web` instead of `packages/types` — produced two more decision files and a moved type.

One review; three decision files; the architecture document updated rather than quietly contradicted.

### 5.3 Tenant data read on the RLS-bypass handle — PR #156

The session-reminder scanner enriched its payloads (session titles, course titles, meeting URLs)
using the owner `BYPASSRLS` database handle, contradicting
`dec-jobs-queue-owner-db-cross-tenant-claim`. The same review caught that a throw in the scan would
skip the delivery drain entirely.

The fix trail is fully visible: commit `9adf5ed` (*"read reminder payload data under `withTenant`,
not the owner handle"*) moved enrichment back under a tenant-scoped role batched per-tenant, and a
new test file `tick-scan-resilience.test.ts` was written to prove the drain survives a scan failure.
The PR's own doc comment, which had overclaimed "never aborts the tick," was corrected to match reality.

A second commit, `9feeab0`, carries the attribution directly in its subject line:

```
fix(audit): users/me PATCH logs auth.profile_updated as null-tenant identity event
— never route a tenant row through the control-plane RLS bypass (watchman)
```

### 5.4 Silent scope *reduction* — PR #155

Watchman is usually pitched as a scope-creep detector. Here it caught the opposite. TSK-61's spec
carried two lifecycle requirements (90-day archive, 365-day delete); the PR shipped one:

> "This is a scope *reduction* (surfaced, not silent), not creep. **The orchestrator must not mark
> TSK-61 fully Done until the archive lands.**"

The finding isn't addressed to the code. It's addressed to the *project bookkeeping* — the risk
that a task gets closed while half its acceptance criteria quietly evaporate. No code-review tool
has that as a category.

### 5.5 It reviewed the PR that fixed itself — PR #29

PR #29's entire purpose was scrubbing stale `context/` paths out of the Watchman prompt. Run against
its own diff, the Watchman found that **line 42 of the new prompt still said
`context/architecture-docs/`**:

> "A future watchman invocation that follows that line literally will look for a path that doesn't
> exist — exactly the failure mode the PR was built to eliminate. The whole point of this PR is to
> scrub stale `context/` paths from the watchman prompt; leaving one in is a self-contradiction."

Fixed in commit `02902b9`; pass 2 came back Clean. The PR author's own summary of the episode:

> "The validation worked end-to-end: watchman read the brain, produced a verdict in the prescribed
> format, **caught a real finding the orchestrator missed**, and verified the fix on re-review."

### 5.6 Bonus: the review that argued with its own severity model — PR #116

Manually invoked during the June identity pivot, and the most sophisticated output in the corpus.
It opened a section titled *"Findings — filtered for pre-production reality"* and re-weighted its
own findings downward because the product was pre-launch with seeded data:

> "This finding was about legacy *production* rows … We have none — the data is seeded and the pivot
> *is* the model."

Then it turned the same argument against itself on a different item — a missing DB `CHECK`
constraint:

> "The one place 'we can steer any day' cuts the *other* way: **an empty table is the free window to
> harden this invariant.** Adding it post-data becomes a cleanup project. Not asking for it here —
> just flagging that pre-production is the cheapest moment to make this an explicit keep/skip call
> rather than an implicit deferral."

That is the behaviour the whole design is chasing: not rule-matching, but reasoning about *when* a
rule is expensive to apply and *when* it is cheap.

---

## 6. Testing — what was and wasn't verified

Worth being precise here, because it's the weakest part of the story and a good post should say so.

### How the Watchman treats testing

Test coverage is explicitly out of scope: *"Unit-test coverage of edge cases. CI runs the tests;
you assess whether the *test strategy* aligns with the spec."* The distinction holds up in
practice — verdicts across PRs #39, #67, #69, #74, #159 discuss whether deferred E2E coverage is a
legitimate deferral or a hole in the acceptance criteria, and never count test cases.

The separation is enforced structurally, not just by instruction: `ci.yml` (lint, typecheck, unit,
integration, Playwright) is described in the repo's own words as *"the actual gate."* The Watchman
runs beside it, never instead of it. Every PR in the corpus is CI-green *before* the Watchman
verdict is recorded.

### How the Watchman itself was tested

Thinly, and only once. PR #29 carries the only explicit test plan for the agent:

```
- [x] senior-watchman invocation succeeds and reads ../tutorspacebrain/
- [x] Watchman produces a real verdict, not a self-pass (validated — caught a finding
      the orchestrator missed)
- [x] No stale context/-shaped references remain (grep returns nothing)
- [ ] First Phase-3 sub-agent runs the new flow end-to-end (deferred until Phase 3 kicks off)
```

That is the whole of it. Specifically, there is:

- **No eval harness** — no held-out set of diffs with known drift to measure catch rate against.
- **No regression suite** — nothing that would have caught the empty-prompt bug (§4.1) automatically,
  and nothing that would catch the next one.
- **No false-positive tracking** — the rubric warns that over-blocking erodes signal, but no one is
  measuring block rate.
- **No cost/latency measurement for the local agent** — the only numbers that exist ($2.58, ~10 min,
  37 turns) are for the CI variant, taken once, while it was running with no prompt.
- **The one deferred checkbox stayed deferred.** Phase 3's summary (PR #50) records that sub-agents
  still couldn't reach the Watchman, so the end-to-end flow PR #29 was written to enable was never
  validated as designed.

The verification that *did* happen was empirical and adversarial, and is arguably the more
interesting model: run the reviewer on the PR that changes the reviewer, and see whether it finds
something the human orchestrator missed. It did. That's one data point, not a test suite — but it's
a data point with a property most evals lack, which is that nobody could have written the answer key
in advance.

### Two live defects found during this research

1. `.claude/agents/senior-watchman.md:10` — unbalanced backtick: ``read .claude/prompts/watchman.md` ``
   should be `` `.claude/prompts/watchman.md` ``. Cosmetic, but it sits on the single most important
   instruction in the file.
2. `.claude/prompts/watchman.md:70` — instructs the reviewer to consult the dependency graph
   "(visible in Notion)", while lines 15 and 147 declare Notion legacy and forbid calling Notion MCP
   tools. Leftover from the migration described in §4.2.

---

## 7. Design principles worth extracting for the post

These are the transferable claims — each one is backed by an incident above, not by theory.

1. **A reviewer is defined by its refusals.** Half the prompt is an out-of-scope list. Without it,
   the model spends its budget on the findings that are cheapest to generate and least valuable to
   receive.
2. **Review authority must be bounded by tools, not just words.** `tools: Read, Grep, Glob, Bash`,
   plus explicit "do not push / do not edit / do not open PRs / you are the terminal node." A
   reviewer that can fix things stops being a reviewer.
3. **Independence is the product; the rubric is just the spec.** Same rubric + same context = a
   self-pass in a review costume. This was learned the hard way and fixed structurally (§4.3).
4. **The reviewer needs a source of truth it doesn't share with the author.** Vision doc,
   architecture overview, module specs, decisions ledger. Without those, "strategic alignment"
   collapses into vibes — and the ledger is what makes findings *citable* (`Source:` is a required
   field on every finding).
5. **Verdict taxonomies need friction.** Three statuses, three severities, mechanical escalation,
   and an explicit anti-inflation clause. Every finding must carry a *suggested action*, which
   forces the reviewer to have an opinion about what happens next rather than just registering unease.
6. **Bound the diff.** >500 lines → ask before proceeding. *"A 'Clean' verdict on a megadiff is
   worse than no verdict."*
7. **Route findings into a durable ledger, not a comment thread.** Roughly a third of Watchman
   findings resolve as *"log a decision file"* rather than *"change the code."* The output of review
   becomes institutional memory the next reviewer reads — the loop closes.
8. **Prompt files are production dependencies.** They rot when docs move, they can be committed
   empty, and they fail silently in the most convincing possible way (§4.1, §4.2).
9. **Adoption follows process, not policy.** June: 1 of 14. The gate holds only where the workflow
   mechanically requires it.
10. **Sharpen the gate exactly where the human isn't.** The rubric ends: *"If you'd flag a finding
    in default mode but not phase mode, flag it harder in phase mode … You are the only review
    before that merge. Don't soften findings expecting a human to catch them later. There is no
    later."*

---

## 8. Suggested blog angles

Strongest single narrative — **"We shipped a code reviewer with no instructions and nobody
noticed for four days."** Open on §4.1, use it to argue that LLM review failures are
indistinguishable from LLM review successes at the artifact level, then earn the way back to what a
*working* Watchman caught (§5.1, §5.3) and what it costs to keep one honest (§6).

Alternatives:

- **"The reviewer that isn't allowed to review your code."** Lead with the refusal list; the
  argument is that the constraint *is* the feature. Best paired with §5.4 (scope reduction) and
  §5.6 (pre-production re-weighting) as proof that the freed-up attention goes somewhere real.
- **"Same head, different hat."** The context-independence argument (§4.3) as the central thesis:
  self-review by the same agent is theatre regardless of rubric quality, and the fix is
  architectural. Naturally sets up multi-agent orchestration as a topic.
- **"What CI can't see."** Straight case-study format: audit-outside-transaction, RLS bypass,
  silent scope reduction — three green-CI PRs with real problems. The most concrete and least
  philosophical option.

Honesty notes to keep in the post: the 51% adoption figure and the June collapse; the absence of an
eval harness; the fact that the two Strategic blockers both come from a single week in Phase 1; and
that the reviewer's own most-cited validation is a single self-referential run on PR #29.

---

## 9. Source index

| Artifact | Path / ref |
|---|---|
| Agent definition | `.claude/agents/senior-watchman.md` |
| Rubric / real system prompt | `.claude/prompts/watchman.md` |
| Implementer's mandatory self-check | `.claude/prompts/tutorx-senior-developer.md:129-139, 163` |
| Phase-mode gate spec | `claude.md:290-294`; `docs/agent-runbook.md` §13.3–13.7 |
| Original CI workflow | `git show 575b11d:.github/workflows/watchman.yml` |
| Origin PR | #8 — "The watchman local agent and the watchman CI in the flow" (2026-04-21) |
| CI disabled + cost data | #12 (2026-04-25), commit `c98469b` |
| Empty-prompt discovery | #15 (2026-04-25) |
| Strategic blockers | #21 (dual source of truth), #22 (audit outside transaction) |
| Orchestrator-gate redesign | #29 (2026-04-26), decision `dec-watchman-orchestrator-only-invocation.md` |
| Phase-3 limitation note | #50 |
| Best standalone review | #116 (as PR comment) |
| Findings → code + tests | #156; commits `9adf5ed`, `9feeab0`; `tick-scan-resilience.test.ts` |
| Recent soft-warning verdicts | #155, #167, #178, #185, #188 |
| Transcripts | `~/.claude/projects/-Users-dzithendolabs-Documents-project26-tutorspacesmvp-bethel/` (23 files, 2026-06-15 → 2026-08-03) |
