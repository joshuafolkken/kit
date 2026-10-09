# `halfrun` manifest — rationale

This is maintainer-only rationale behind `.claude/skills/workflow-commands/halfrun.md`. It is never read
during a run — every step, stop and command an agent acts on stays in the procedure document, and a
change to this file changes no rule.

## Where each rule came from

- `halfrun.md` as a manifest — joshuafolkken/kit#2189.
- The entry sequence and stop branches shared with `fullrun` and `prrun` in `entry-sequence.md` —
  joshuafolkken/kit#3174.
- The `Next:` line leading the stop's `confirmation` Telegram, because a verified `halfrun` ships by a
  `fullrun` / `prrun` whose `run:entry` adopts the marked hold — joshuafolkken/kit#2796.
- The `-- ':!.josh/observations'` pathspec on the `halfrun new` pre-existing-changes stash —
  joshuafolkken/kit#2919.
