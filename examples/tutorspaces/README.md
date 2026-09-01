# Example: the original TutorSpaces Watchman

These are the **real, unmodified** artifacts as used in the TutorSpaces (codename TutorX) project —
the source material the whole concept and [research](../../docs/research.md) are drawn from. They're
kept here verbatim as a worked example, so you can see a fully-specified Watchman rather than a
template full of `<PLACEHOLDER>`s.

| File | Role |
|---|---|
| `senior-watchman.md` | The thin agent definition (~22 lines). Frontmatter + how to get the diff + where to print. Its only real instruction: *go read the other file.* |
| `watchman.md` | The 159-line rubric — the agent's real system prompt. Six review dimensions, out-of-scope list, output grammar, hard prohibitions. |

To build your own, copy [`../../template/`](../../template/) instead and fill in the placeholders.

## Known defects preserved here

Kept faithful to the source, including two live defects the research surfaced (research.md §6):

1. `senior-watchman.md:10` — an unbalanced backtick on the single most important instruction in the
   file (```` read .claude/prompts/watchman.md` ````). Cosmetic, but instructive: it sits on the
   load-bearing line.
2. `watchman.md:70` — tells the reviewer to consult the dependency graph "(visible in Notion)",
   while other lines declare Notion legacy and forbid calling Notion MCP tools. Leftover from the
   docs migration described in failure-modes §2.

The `template/` versions have these cleaned up.
