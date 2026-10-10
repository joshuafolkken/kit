# Entry sequence — rationale

This is maintainer-only rationale behind `.claude/skills/workflow-commands/entry-sequence.md`: where the
shared entry sequence came from. It is never read during a run — every step, stop and command an agent
acts on stays in the procedure document, and a change to this file changes no rule.

## Where each rule came from

- One procedure for the entry and the stop branches of `fullrun`, `halfrun` and `prrun`, with each
  manifest carrying only its difference — joshuafolkken/kit#3174.
- `pnpm josh run:entry` folding the hold, the budget, the bundled reads and the pre-implementation
  decision into one round trip — joshuafolkken/kit#2372.
