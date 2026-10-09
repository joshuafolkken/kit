# `fullrun` and `prrun` manifests — rationale

This is maintainer-only rationale behind `.claude/skills/workflow-commands/fullrun.md` and the `prrun`
manifest that is its difference. It is never read during a run — every step, stop and command an agent
acts on stays in the procedure documents, and a change to this file changes no rule.

## Where each rule came from

- `fullrun.md` as a manifest, its step lists relocated to `fullrun-steps.md` so the entry read carries
  the manifest rather than the prose — joshuafolkken/kit#2189.
- The entry sequence and stop branches shared with `halfrun` and `prrun` in `entry-sequence.md` —
  joshuafolkken/kit#3174.
- A lane child asking `pnpm josh run:cut --resume <N>` before the hold — joshuafolkken/kit#2760.
- A run that is not a lane child never reading the cut's document — joshuafolkken/kit#3172.
- `resume: halfrun`, adopting a stopped `halfrun` — joshuafolkken/kit#2796.
- `prrun` — `fullrun` up to a green, mergeable pull request, stopping before the merge so a person
  merges by hand — and its `resume: prrun-*` adoption — joshuafolkken/kit#3023.
