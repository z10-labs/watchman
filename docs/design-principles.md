# Watchman design principles

Ten transferable claims for building a strategic-alignment review agent. Each is backed by an
incident in [research.md](./research.md) (§ references point there), not by theory.

1. **A reviewer is defined by its refusals.** Half the prompt is an out-of-scope list. Without it,
   the model spends its budget on the findings that are cheapest to generate and least valuable to
   receive — style notes and "add one more test."

2. **Review authority must be bounded by tools, not just words.** `tools: Read, Grep, Glob, Bash`,
   plus explicit "do not push / do not edit / do not open PRs / you are the terminal node." A
   reviewer that can fix things stops being a reviewer.

3. **Independence is the product; the rubric is just the spec.** Same rubric + same context = a
   self-pass in a review costume. The value of the Watchman is *context independence*: a reviewer
   that did not participate in the reasoning that produced the diff, and has not already talked
   itself into it. Learned the hard way and fixed structurally — see failure-modes §3.

4. **The reviewer needs a source of truth it doesn't share with the author.** Vision doc,
   architecture overview, module specs, decisions ledger. Without those, "strategic alignment"
   collapses into vibes — and the ledger is what makes findings *citable* (`Source:` is a required
   field on every finding).

5. **Verdict taxonomies need friction.** Three statuses, three severities, mechanical escalation,
   and an explicit anti-inflation clause ("block — use sparingly; over-blocking erodes signal").
   Every finding must carry a *suggested action*, which forces the reviewer to have an opinion about
   what happens next rather than just registering unease.

6. **Bound the diff.** >500 lines → ask before proceeding. *"A 'Clean' verdict on a megadiff is
   worse than no verdict."*

7. **Route findings into a durable ledger, not a comment thread.** Roughly a third of Watchman
   findings resolve as *"log a decision file"* rather than *"change the code."* The output of review
   becomes institutional memory the next reviewer reads — the loop closes.

8. **Prompt files are production dependencies.** They rot when docs move, they can be committed
   empty, and they fail silently in the most convincing possible way (failure-modes §1, §2).

9. **Adoption follows process, not policy.** In the source project, June adoption was 1 of 14 PRs —
   nothing about the policy changed, the *process mode* did. The gate holds only where the workflow
   mechanically requires it.

10. **Sharpen the gate exactly where the human isn't.** *"If you'd flag a finding in default mode
    but not phase mode, flag it harder in phase mode … You are the only review before that merge.
    Don't soften findings expecting a human to catch them later. There is no later."*

---

## The core idea in one paragraph

An LLM reviewer pointed at a diff will, by default, produce style notes and test suggestions — the
cheapest, most abundant findings, and exactly the ones a linter, typechecker, and test runner
already produce for free and deterministically. The expensive, un-automatable question — *does this
change still belong to the product we said we were building?* — gets crowded out. The Watchman's
whole design is one long exercise in crowding it back in.
