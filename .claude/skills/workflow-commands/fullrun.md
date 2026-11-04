# `fullrun` — the manifest (plan → implement → PR → merge → notify)

The entry sequence and the stop branches are `entry-sequence.md`. `pnpm josh run:step <N>` prints the
run's next single action. `chain-rule.md`, `followup.md`, `background-commands.md` and
`latest-gate.md` are **not entry reads** — each is fetched at its point of use. The step lists are
`fullrun-steps.md`, read when a step needs its detail.

## The difference — the entry and the end

- **The entry passes no `--to`**: `pnpm josh run:entry <N>` is `fullrun`'s stage. Follow `run:step`
  into `fullrun-steps.md` — the `fullrun #N` list or the `fullrun new` list.
- **The end merges**: `run:step` names the verification gate, `pnpm josh followup` and the release ask
  in order. Invoking `fullrun` authorizes the merge, through `pnpm josh followup` only.
- **A split or a prerequisite stops the run**: typing `fullrun` approved **one** Issue.

## The lane-child seam

- **A lane child enters once with `pnpm josh run:entry <N>`**, which checks the carried cut before
  the hold and completes the fresh entry itself; never call `run:cut --resume` separately. It takes
  the cut with `pnpm josh run:cut <N>` at the pre-gate boundary of
  `chain-rule.md` step 1. On a non-trivial answer `run:cut` prints the section that acts on it. A run
  that is not a lane child never reads the cut's document.
- **`resume: halfrun`** adopted a stopped `halfrun`: gate in full; `resume: prrun-*` a stopped
  `prrun`; `working-tree-hold.md`.
