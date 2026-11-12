# `prrun` — the manifest (plan → implement → PR → green → stop, a person merges)

`prrun` runs `fullrun` up to a green, mergeable pull request and **stops before the merge**, so a
person merges by hand. **Read `fullrun.md` and `entry-sequence.md` for every step** — the entry
sequence, the step lists, the gate, the review and the stop branches are `fullrun`'s, unchanged.

## The difference — the entry

`prrun #<N>` opens with `pnpm josh run:entry <N> --to prrun` where `fullrun` passes no `--to`
(`docs/how-to/run-issues.md`): a planned Issue starts at the implementation, a `halfrun` stop is adopted and
resumes at the gate, and an Issue already stopped by a `prrun` is reached — report the stage line and
stop. A merged Issue is reached too, but the `entry #<N>` line after the stage line answers it.

## The difference — the end of the run

Where `fullrun` runs `pnpm josh followup` and merges, `prrun` does three things and stops:

1. **Watch the pull request to mergeable** — `pnpm josh followup "<title> #<N>" --no-merge`
   (`followup.md` → "Run `pnpm josh followup`", printed by `followup` as it starts): required CI green and the AI
   review findings resolved. A failure stops the run exactly as it stops a `fullrun`.
2. **Mark the stop — `pnpm josh run:hold <N> --prrun-stop`.** It records the commit the pull request is
   on in this run's own hold, the record `fullrun #<N>` adopts (its prrun resume, `working-tree-hold.md`). **The hold and `in-progress` stay**: the run is not finished until the merge's tail runs.
3. **Stop.** The mark has already sent the `confirmation` Telegram, its resume line `Next: fullrun
   #<N>` — never compose one. The stop report names `fullrun #<N>` (recommended) and a manual merge followed by
   `pnpm josh followup "<title> #<N>"`, in that order.

**Invoking `prrun` is _not_ authorization to merge** — never run `pnpm josh followup` without
`--no-merge` in a `prrun`. After a person merges by hand, the same `pnpm josh followup "<title> #<N>"`
runs only the post-merge tail (`followup.md`).

`prrun new`: `fullrun new` up to the pull request, then the three steps above with the filed number.
