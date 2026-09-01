# Implementations

This is where z10Labs experiments with ways to implement the [Watchman](../docs/concept.md). It's an
**exploration log**, not a menu of finished products — we're actively building, and there's far more
we haven't tried yet.

## What we've built so far

| Approach | Status | Notes |
|---|---|---|
| [`claude-code-subagent/`](claude-code-subagent/) | 🧪 experimenting | A Claude Code subagent + rubric prompt, invoked before a PR is opened or by an orchestrator. This is the approach we built inside [TutorSpaces](claude-code-subagent/tutorspaces/); all the [research](../docs/research.md) comes from it. |

## What's next

Undecided and open. There are many points in the software development cycle where a Watchman might
live, and many ways to host one — we're still discovering which work. We'll add approaches here as we
actually build and test them, not before.
