# Workflow commands manifest — rationale

Rationale behind `.claude/skills/workflow-commands/SKILL.md`.

## Where each rule came from

- The manifest shape — triggers and pointers, never a procedure, each rule stated once in the file its
  row names — joshuafolkken/kit#3174, which also moved the entry sequence `fullrun`, `halfrun` and
  `prrun` share into `entry-sequence.md`.
- The point-of-use reads of `backlogrun-park.md` → "park and continue" by a parking lane child and of
  `progress-watcher.md` → "Progress while the run is quiet" by every implementing run, rather than at
  the entry — joshuafolkken/kit#3172.
- The read set `pnpm josh read:set` reports is derived from the point-of-use table and the documents
  themselves, never transcribed, so a row added to the table changes what an entry is costed at without
  a second edit.
