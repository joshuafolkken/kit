# `fullrun` step lists — rationale

This is maintainer-only rationale behind `.claude/skills/workflow-commands/fullrun-steps.md`: where its
steps came from and why a lane child skips one of them. It is never read during a run — every step,
stop and command an agent acts on stays in the procedure document, and a change to this file changes
no rule.

## Where each rule came from

- The step lists relocated out of `fullrun.md` so the entry read carries the manifest, not the prose —
  joshuafolkken/kit#2189.
- No cut after the plan; a lane child's context is bounded by the threshold-gated implementation cut
  alone — joshuafolkken/kit#2489.
- A dispatched lane child handing the rest of the run to `pnpm josh ship --detach --review` and ending
  its turn — joshuafolkken/kit#2428.
- `pnpm josh ship` folding gate → commit/push/PR → the CI-wait `followup` → `run:tail` into one call on
  the clean path — joshuafolkken/kit#2398.
- `run:tail` folding the post-merge bookkeeping (`observations:flush`, `issue:cite`, `release:scope`)
  into one round trip — joshuafolkken/kit#2372.
- The `-- ':!.josh/observations'` pathspec on the `fullrun new` pre-existing-changes stash, and
  `observations:flush` committing ledger lines written outside any issue's run —
  joshuafolkken/kit#2919.

## Why a lane child skips `josh ms`

`pnpm josh ms` refuses in a lane, as a raw `git switch main` does: the primary checkout holds the
default branch, so the switch fails with `already used by worktree`. Nothing is lost by skipping it —
the lane was branched from a fresh default before it opened, and the latest default is brought in
during the gate by `pnpm josh main:merge`.
