# The Watchman

The Watchman is a concept **z10Labs** owns and is bringing to the world. This repo is where we build
it, implement it, and discover how far it can go in the software development cycle.

## What it is

A Watchman is a review function whose entire job is *strategic alignment* — and it is defined by what
it refuses to look at. It judges a proposed change against the product's vision, architecture, and
documented decisions, and deliberately declines to comment on code style, correctness, or test
coverage, because deterministic tooling (linters, typecheckers, test runners, CI) already does that.

The one question a Watchman exists to answer:

> **Does this change still belong to the product we said we were building?**

## Why it matters

An automated reviewer pointed at a diff gravitates to the cheapest findings available — style notes,
naming nits, "add one more test." Those are the most abundant and least valuable findings, because
they're exactly what CI already catches for free and deterministically. The expensive,
un-automatable question — strategic fit — gets crowded out. The Watchman is the discipline of
crowding it back in.

## Where we are

We built the first Watchman inside the TutorSpaces project and ran it across 189 PRs. That work is
the ground truth for this repo:

- [design-principles.md](./design-principles.md) — the design principles we've extracted so far,
  each backed by a real incident.
- [failure-modes.md](./failure-modes.md) — the ways a Watchman fails *without a stack trace*, learned
  the hard way.
- [research.md](./research.md) — the full evidence base behind both.

Everything documented here is what we've actually observed. **There is much more we haven't explored
yet** — how best to implement a Watchman across different points in the development cycle, and how far
the concept can be pushed. That exploration is what this repo is for. We won't write down directions
we haven't taken; we add them as we build them.
