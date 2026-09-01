# Implementations

Ways to realise the [Watchman concept](../docs/concept.md). This is an **exploration log**, not a
menu of finished products — we're actively experimenting with different shapes and none is settled.
The concept lives in [`../docs/`](../docs/); everything here is a way of *trying* it.

## Approaches explored so far

| Approach | Status | Notes |
|---|---|---|
| [`claude-code-subagent/`](claude-code-subagent/) | 🧪 experimenting | A Claude Code subagent + rubric prompt, invoked pre-push or by an orchestrator. The first approach we tried — it's where the [TutorSpaces](claude-code-subagent/tutorspaces/) deployment and all the [research](../docs/research.md) come from. |

## Approaches still on the table

Not built yet — candidate directions we may explore. Add rows as we try them.

- **CI action** — runs on `pull_request`. The TutorSpaces variant of this was deleted after four
  days on cost/economics grounds ([failure-modes §4](../docs/failure-modes.md)); worth revisiting
  with a cheaper trigger policy.
- **Git pre-push hook** — local, zero-infra, author-run.
- **Standalone bot / service** — framework-agnostic, hosts its own source-of-truth access.
- **Different agent framework** — the concept isn't Claude-Code-specific; the invariants in
  [concept.md](../docs/concept.md) should port.

## What every approach must preserve

Whatever the host or trigger, an implementation only counts as a Watchman if it keeps the
[invariants](../docs/concept.md#invariants-true-of-any-implementation): defined by refusal,
independent of the author, anchored to an external source of truth, bounded verdict grammar,
read-only, bounded input, findings routed to durable memory.
