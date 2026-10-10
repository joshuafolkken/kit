# `fullrun` — the manifest (plan → implement → PR → merge → notify)

**This file is the manifest, not the procedure.** The entry sequence and the stop branches are
`entry-sequence.md`, shared with `halfrun` and `prrun`; this file names only what is `fullrun`'s own.
`pnpm josh run:step <N>` prints the run's next single action. `chain-rule.md`, `followup.md`,
`background-commands.md` and `latest-gate.md` are **not entry reads** — each is fetched at its point of
use. The step lists are `fullrun-steps.md`, read when a step needs its detail. History:
`docs/maintainers/fullrun-rationale.md` → "Where each rule came from".

## The difference — the entry and the end

- **The entry passes no `--to`**: `pnpm josh run:entry <N>` is `fullrun`'s stage. Follow `run:step`
  into `fullrun-steps.md` — the `fullrun #N` list or the `fullrun new` list.
- **The end merges**: `run:step` names the verification gate, `pnpm josh followup`, `pnpm josh ms` and
  the release ask in order. Invoking `fullrun` authorizes the merge, through `pnpm josh followup` only.
- **A split or a prerequisite stops the run**: typing `fullrun` approved **one** Issue.

## The lane-child seam

- **A lane child asks whether it is a resume first — `pnpm josh run:cut --resume <N>`** (`run:entry` asks it
  before the hold); on `resume` it skips the title, plan, hold and implementation and goes to the gate. At the pre-gate
  boundary — immediately after `pnpm josh main:merge`, before the gate — it takes the cut with
  `pnpm josh run:cut <N>` (the ordered step in `chain-rule.md`, which names the cut's single source),
  and it records any park on the Issue before the stop notify. A run that is not a lane child never
  reads the cut's document.
- **`resume: halfrun`** adopted a stopped `halfrun`: gate in full; `resume: prrun-*` a stopped
  `prrun`; `working-tree-hold.md`.
