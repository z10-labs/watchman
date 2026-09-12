# Implementations

This is where z10Labs experiments with ways to implement the [Watchman](../docs/concept.md). It's an
**exploration log**, not a menu of finished products — we're actively building, and there's far more
we haven't tried yet.

## What we've built so far

| Approach | Status | Notes |
|---|---|---|
| [`github-app/`](github-app/) | 🧪 built, not yet run live | One engine, two deployment shapes. A **hosted GitHub App** that reviews a PR from outside the author's environment, and a **GitHub Actions job** (`pnpm run review` + a workflow template) that runs the same modules with the workflow's own token. Both leave one verdict comment, edited in place. Built to attack the two things that killed the first CI variant: trigger economics, and silent prompt breakage — preflight is a separate, job-failing step, and a docs-only push costs zero model calls. Complete and tested; neither shape has been pointed at a real repository yet. |
| [`claude-code-subagent/`](claude-code-subagent/) | 🧪 experimenting | A Claude Code subagent + rubric prompt, invoked before a PR is opened or by an orchestrator. This is the approach we built inside [TutorSpaces](claude-code-subagent/tutorspaces/); all the [research](../docs/research.md) comes from it. |

## What's next

Undecided and open. There are many points in the software development cycle where a Watchman might
live, and many ways to host one — we're still discovering which work. We'll add approaches here as we
actually build and test them, not before.
