# The Watchman

> A review function whose entire job is *strategic alignment* — defined by what it refuses to look at.

The Watchman is a concept **z10Labs** owns and is bringing to the world. This repo is where we build
it, implement it, and discover how far it can go in the software development cycle.

**Status: exploration & experimentation.** Nothing here is a finished, drop-in tool yet — it's a
research space, and there's far more we haven't explored than we have.

## The idea

Most automated reviewers, pointed at a diff, produce the cheapest findings available: style notes,
naming nits, "add one more test." Those are exactly what a linter, a typechecker, and a test runner
already produce for free and deterministically. The expensive, un-automatable question gets crowded
out:

> **Does this change still belong to the product we said we were building?**

A Watchman exists to answer only that — judging a change against vision, architecture, and the
decisions ledger, while explicitly *refusing* to comment on style, correctness, or test coverage. CI
does that; the Watchman does what CI can't see.

Read the full statement of the concept in **[docs/concept.md](docs/concept.md)**.

## This repo separates the concept from its implementations

The concept is the point. Any given implementation — including the first one we built — is just *one
way* to realise it, and we're still discovering which shapes work.

| Path | What it is |
|---|---|
| [`docs/concept.md`](docs/concept.md) | The Watchman concept, in z10Labs' words. |
| [`docs/design-principles.md`](docs/design-principles.md) | Ten transferable design principles, each backed by an incident. |
| [`docs/failure-modes.md`](docs/failure-modes.md) | The four ways a Watchman fails *without a stack trace*. |
| [`docs/research.md`](docs/research.md) | The full evidence base from the first real deployment. |
| [`implementations/`](implementations/) | Exploration log of how we've implemented the concept so far. |

## Where the material comes from

We built the first Watchman inside the **TutorSpaces / TutorX** project and ran it across 189 PRs.
That deployment lives here as *one* worked example under
[`implementations/claude-code-subagent/tutorspaces/`](implementations/claude-code-subagent/tutorspaces/) —
it's where the lessons came from, but it is deliberately **not** framed as the canonical way to build
a Watchman. What comes next is open; see the [implementations index](implementations/README.md).

## What a Watchman caught (in that first deployment)

Real cases, each missed by a green CI run (lint, typecheck, tests, E2E all passing). Full paper trail
in [docs/research.md §5](docs/research.md):

- **Audit rows written outside the transaction** — a documented "zero drops" durability invariant
  broken in 7 endpoints, plus 2 more traced back into already-merged code.
- **A tenant row read on the RLS-bypass database handle** — cross-tenant data exposure that
  contradicted a resolved decision file.
- **Silent scope *reduction*** — a task shipping one of its two required lifecycle behaviours, caught
  and flagged so the task wasn't marked Done prematurely. No code-review tool has that category.
