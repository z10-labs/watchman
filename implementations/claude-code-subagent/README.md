# Approach: Claude Code subagent

**Status: 🧪 experimenting — not ready for use.**

The first approach we tried for realising the [Watchman concept](../../docs/concept.md): a Claude
Code subagent whose real system prompt is a separate rubric file. Invoked locally before a PR is
opened (author-run), or spawned by an orchestrator as an independent gate.

This is an experiment we're still learning from — see the open questions below. It is **not** a
finished template to drop into a project yet.

## The two-file split

| File | Role |
|---|---|
| `.claude/agents/senior-watchman.md` | The thin agent (~22 lines): how to get the diff, where to print. Its one substantive instruction is *read the rubric*. |
| `.claude/prompts/watchman.md` | The rubric — the agent's real system prompt. Required reading, six review dimensions, an out-of-scope list, the output grammar, hard prohibitions. |

Why split them: keeping the rubric in its own file lets the *implementing* agent run the same rubric
against its own diff as a self-check, while an independent Watchman pass still follows. But note
[failure-modes §3](../../docs/failure-modes.md) — a self-check is not a substitute for the
independent pass; independence is the whole point.

## What's in this folder

- [`template/`](template/) — a product-agnostic extraction with `<PLACEHOLDER>`s. A **scaffold for
  the experiment**, not a blessed starter kit. Expect it to change as we learn.
- [`tutorspaces/`](tutorspaces/) — the original, unmodified artifacts from the real TutorSpaces
  deployment, kept verbatim as a worked reference (including two known defects, noted in its README).

## Open questions we're still exploring

- The sub-sub-agent ceiling (failure-modes §3): sub-agents in worktrees couldn't reach the reviewer
  and self-passed. The orchestrator-gate workaround was never fully validated end-to-end.
- No eval harness — no held-out set of diffs with known drift to measure catch rate or false-positive
  rate against ([research.md §6](../../docs/research.md)).
- Cost/latency of the local agent was never measured (only the deleted CI variant was, once).
- How to keep the rubric's Required Reading from rotting when docs move (failure-modes §2).
