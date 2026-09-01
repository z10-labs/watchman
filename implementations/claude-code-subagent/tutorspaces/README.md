# Example: the original TutorSpaces Watchman

These are the **real, unmodified** artifacts as used in the TutorSpaces (codename TutorX) project —
the source material the whole concept and [research](../../../docs/research.md) are drawn from.
They're kept here verbatim as a worked example, so you can see a fully-specified Watchman rather than
a template full of `<PLACEHOLDER>`s. This is *one* implementation of the
[concept](../../../docs/concept.md), not the canonical one.

| File | Role |
|---|---|
| `senior-watchman.md` | The thin agent definition (~22 lines). Frontmatter + how to get the diff + where to print. Its only real instruction: *go read the other file.* |
| `watchman.md` | The 159-line rubric — the agent's real system prompt. Six review dimensions, out-of-scope list, output grammar, hard prohibitions. |

The product-agnostic scaffold for this approach lives in [`../template/`](../template/) — but note
it's an in-progress experiment, not a blessed starter kit.

## Known defects preserved here

Kept faithful to the source, including two live defects the research surfaced ([research.md §6](../../../docs/research.md)):

1. `senior-watchman.md:10` — an unbalanced backtick on the single most important instruction in the
   file (```` read .claude/prompts/watchman.md` ````). Cosmetic, but instructive: it sits on the
   load-bearing line.
2. `watchman.md:70` — tells the reviewer to consult the dependency graph "(visible in Notion)",
   while other lines declare Notion legacy and forbid calling Notion MCP tools. Leftover from the
   docs migration described in failure-modes §2.

The `template/` versions have these cleaned up.
