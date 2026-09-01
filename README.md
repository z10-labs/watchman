# The Watchman

> A review agent whose entire job is *strategic alignment* — defined by what it refuses to look at.

Most LLM code reviewers, pointed at a diff, produce the cheapest findings available: style notes,
naming nits, "add one more test." Those are exactly what a linter, a typechecker, and a test runner
already produce for free and deterministically. The expensive, un-automatable question gets crowded
out:

> **Does this change still belong to the product we said we were building?**

The Watchman exists to answer only that. It reads your architecture, your decisions ledger, and your
business model, then judges a pending PR on **scope drift, contradictions with prior decisions,
business-model fit, architectural conformance, and decision discipline** — and explicitly *refuses*
to comment on code style, correctness, or test coverage. CI does that; the Watchman does what CI
can't see.

This repo packages the concept, extracted from a real project ([TutorSpaces](examples/tutorspaces/))
that ran it across 189 PRs.

## What's here

| Path | What it is |
|---|---|
| [`template/`](template/) | Portable, product-agnostic version. Copy this into your repo and fill in the `<PLACEHOLDER>`s. |
| [`template/.claude/agents/senior-watchman.md`](template/.claude/agents/senior-watchman.md) | The thin agent: how to get the diff, where to print. Its one real instruction is *read the rubric*. |
| [`template/.claude/prompts/watchman.md`](template/.claude/prompts/watchman.md) | The rubric — the agent's real system prompt. This is where all the work lives. |
| [`template/.github/workflows/watchman.yml`](template/.github/workflows/watchman.yml) | Optional CI variant. Read the caution at the top before enabling. |
| [`examples/tutorspaces/`](examples/tutorspaces/) | The original, unmodified artifacts as a fully-worked example. |
| [`docs/design-principles.md`](docs/design-principles.md) | Ten transferable design principles, each backed by an incident. |
| [`docs/failure-modes.md`](docs/failure-modes.md) | The four ways it broke — how an LLM reviewer fails without a stack trace. |
| [`docs/research.md`](docs/research.md) | The full evidence base: numbers, invocation patterns, what it caught. |

## The two-file split (and why it's load-bearing)

The implementation is deliberately two files:

- **The agent** (`senior-watchman.md`) is ~22 lines. Its only substantive instruction is: *read the
  other file, that is your real system prompt.*
- **The rubric** (`watchman.md`) is the whole thing — required reading, six review dimensions, an
  out-of-scope list, a strict output grammar, and a "things you must not do" section.

Keeping the rubric in a separate file means the *implementing* agent can be required to run the same
rubric against its own diff as a self-check — while the independent Watchman pass still follows. See
[design-principles §3](docs/design-principles.md) on why independence, not the rubric, is the product.

## Quickstart

1. Copy [`template/.claude/`](template/.claude/) into your repo's `.claude/`.
2. Open both files and replace every `<PLACEHOLDER>`:
   - `<PRODUCT>` — your product name.
   - `<BRAIN_PATH>` — path to your source-of-truth docs (vault, `/docs`, wiki export).
   - `<RUNBOOK>` — your in-repo working-rules doc (`CLAUDE.md`, `CONTRIBUTING.md`, …).
3. Rewrite **Section 1 (Vision drift)** of the rubric to your actual business model. Tune sections
   2–6 to your architecture and decision conventions.
4. Invoke it before opening a PR:
   ```
   > use the senior-watchman agent to review my changes before I push
   ```
   It prints one verdict — `Clean` / `Soft warnings` / `Strategic blocker` — with each finding
   carrying a severity, a suggested action, and a cited source. It never pushes, edits, or opens PRs.

> **Do not ship it with placeholders left in.** A half-filled rubric fails *silently* — the reviewer
> still emits a confident, well-formatted verdict with no substance. This is failure mode #1; read
> [docs/failure-modes.md](docs/failure-modes.md) before you rely on it.

## What it actually caught

Real cases from the source project — each one missed by a green CI run (lint, typecheck, tests, E2E
all passing). Full paper trail in [docs/research.md §5](docs/research.md):

- **Audit rows written outside the transaction** — a documented "zero drops" durability invariant
  broken in 7 endpoints, plus 2 more traced back into already-merged code.
- **A tenant row read on the RLS-bypass database handle** — cross-tenant data exposure that
  contradicted a resolved decision file.
- **Silent scope *reduction*** — a task shipping one of its two required lifecycle behaviours, caught
  and flagged so the task wasn't marked Done prematurely. No code-review tool has that category.

## Credit

Concept and artifacts originate in the TutorSpaces / TutorX project. This repo generalises them for
reuse and preserves the research behind the design.
