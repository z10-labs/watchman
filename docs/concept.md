# The Watchman concept

This document defines what a Watchman *is*, independent of how you build one. The concrete
implementations under [`../implementations/`](../implementations/) are ways to realise this concept —
none of them is the concept itself, and we're still exploring which shapes work best.

## Definition

A **Watchman** is a review function whose entire job is *strategic alignment*, defined by what it
refuses to look at. It judges a proposed change against the product's vision, architecture, and
documented decisions — and deliberately declines to comment on code style, correctness, or test
coverage, because deterministic tooling (linters, typecheckers, test runners, CI) already does that
better and cheaper.

The one question a Watchman exists to answer:

> **Does this change still belong to the product we said we were building?**

## Why the concept is needed

An automated reviewer pointed at a diff gravitates to the cheapest findings available — style notes,
naming nits, "add one more test." Those are the *most abundant* and *least valuable* findings,
because they're exactly what CI already catches for free and deterministically. The expensive,
un-automatable question — strategic fit — gets crowded out. A Watchman is the discipline of crowding
it back in.

## Invariants (true of any implementation)

These are the properties a thing must have to be a Watchman. How you achieve them is
implementation-specific.

1. **Defined by refusal.** It has an explicit out-of-scope list at least as important as its
   in-scope list. Without the refusals, it reverts to a generic reviewer.
2. **Independent of the author.** The reviewer must not be the same context that produced the change.
   Same reasoning + same rubric = a self-pass in a review costume. Independence — not the rubric — is
   the product.
3. **Anchored to a source of truth the author doesn't privately control.** Vision doc, architecture
   overview, decisions ledger. Findings must be *citable* against it. Without an external anchor,
   "strategic alignment" collapses into vibes.
4. **Bounded, friction-bearing verdict grammar.** A small fixed set of statuses and severities,
   mechanical escalation, an anti-inflation clause, and a required *suggested action* per finding.
5. **Read-only authority.** It reviews; it does not push, edit, merge, or open PRs. Authority bounded
   by capability, not just by instruction.
6. **Bounded input.** It refuses (or degrades gracefully on) inputs too large to review honestly. A
   confident "Clean" on a megadiff is worse than no verdict.
7. **Findings route to durable memory.** A large share of good findings resolve as "log a decision,"
   not "change the code" — so the review output feeds the same ledger the next review reads. The loop
   closes.

## What varies between implementations

- **Trigger** — pre-push (author-run), orchestrator-run gate, CI on `pull_request`, git hook, manual.
- **Host** — a Claude Code subagent, a CI action, a standalone bot/service, an IDE integration, a
  different agent framework, or even a human following the rubric.
- **Output sink** — terminal, PR comment, PR body, decisions ledger, a dashboard.
- **Source-of-truth medium** — an Obsidian vault, a `/docs` tree, a wiki export, a database.

The [implementations index](../implementations/README.md) tracks the approaches we've tried and what
we've learned about each.

## What stays out (in every implementation)

Code style, formatting, naming, import order, syntax/type errors, unit-test edge-case coverage,
performance micro-optimisation, library choices *on their merits* (only *whether the choice is
logged* is in scope), and defensive refactors outside the diff.

## Related reading

- [design-principles.md](./design-principles.md) — ten transferable design principles, each backed
  by an incident.
- [failure-modes.md](./failure-modes.md) — the four ways a Watchman fails *without a stack trace*.
- [research.md](./research.md) — the full evidence base from the first real deployment (TutorSpaces).
