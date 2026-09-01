# The four failure modes

The most useful part of the Watchman story is how it broke. Every one of these is a way an LLM
reviewer fails *without a stack trace* — it keeps emitting a confident, well-formatted verdict while
doing nothing useful. Full evidence in [research.md](./research.md) §4.

## 1. The empty prompt — "the appearance of review without the substance"

The rubric file (`.claude/prompts/watchman.md`) was committed with the wrong content — a README was
pasted into it. The agent file correctly told the Watchman to read that file as its real system
prompt. So the agent ran every PR (locally and in a CI workflow) with **no rubric, no verdict
taxonomy, and no scope rules**. It produced the *appearance* of review without the substance, for
four days across ~a dozen PRs. Nobody noticed until someone went to *fix* the prompt and read it.

**The generalisable lesson:** an LLM reviewer with a broken prompt does not fail loudly. It produces
exactly the artifact you expected, in the right shape, at the right time, with the right tone. There
is no stack trace for "the reviewer had no rubric." The only detection mechanism is reading the
prompt file — the same mechanism that would have prevented it.

**Guardrails the current experiment adopts:** a preflight check in the CI variant that the
source-of-truth docs resolve
(`implementations/claude-code-subagent/template/.github/workflows/watchman.yml`), and a loud "do not
commit with placeholders left in" warning in the rubric scaffold.

## 2. Prompt rot after a docs migration

The project moved its source of truth from Notion + a `context/` folder to an Obsidian vault. The
Watchman's Required Reading still pointed at the old paths. Even a *successful* invocation would have
produced a Strategic blocker on its first read, because the paths no longer existed.

**The generalisable lesson:** a review agent's prompt is a hardcoded dependency on your
documentation layout. Moving your docs breaks your reviewer — silently — and the breakage surfaces
as *review output*, not as an error. Keep the Required Reading list under the same review discipline
as code that imports those paths.

## 3. The sub-sub-agent ceiling — self-passing dressed up as review

Implementation sub-agents running in isolated worktrees could not reach the `senior-watchman` agent
type from inside their environment, and fell back to grading *themselves* against the checklist. A
self-pass dressed up as a watchman pass produces **false confidence (same head, different hat)**.

**The generalisable lesson — the deepest point in the story:** the value of the Watchman is not the
rubric (the implementing agent can read the same rubric). The value is **context independence**.
Collapse the reviewer and the author into one context and you keep the artifact and lose the entire
function.

**The fix was structural, not prompt-level:** move the gate *up* a level. Sub-agents open the PR
with a placeholder `## Senior Watchman: pending — orchestrator gate` and stop. The orchestrator —
which *can* spawn a subagent one level down — runs the real, independent pass and edits the verdict
in.

## 4. CI economics

The CI Watchman averaged ~10 min, ~37 turns, **~$2.58/PR** — and (because of failure mode #1) spent
those turns wandering after a nonexistent prompt path, racking up permission denials. It was deleted;
what stayed live was the real gate (lint / typecheck / test + E2E).

**The generalisable lesson:** a strategic reviewer that fires on every push has to be worth more than
a few minutes of a senior engineer's attention per PR, every PR, forever. For most teams the local
pre-push agent (run once, deliberately, by the author or orchestrator) is the better economic shape
than an unconditional CI job. See [research.md](./research.md) §4.4.
