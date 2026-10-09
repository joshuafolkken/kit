# `prrun` — the manifest (plan → implement → PR → green → stop, a person merges)

`prrun` sits between `halfrun` (stop before commit) and `fullrun` (auto-merge). It runs `fullrun`
up to a green, mergeable pull request and **stops before the merge**, so a person merges by hand.
**Read `fullrun.md` and `entry-sequence.md` for every step** — the entry
sequence, the step lists, the gate, the review and the stop branches are `fullrun`'s, unchanged. This
file names only the difference.

## The difference — the entry

`prrun #<N>` opens with `pnpm josh run:entry <N> --to prrun` where `fullrun` passes no `--to`
(`docs/how-to/run-issues.md`): a planned Issue starts at the implementation, a `halfrun` stop is adopted and
resumes at the gate, and an Issue already stopped by a `prrun` is reached — report the stage line and
stop. A merged Issue is reached too, but the `entry #<N>` line after the stage line answers it.

## The difference — the end of the run

Where `fullrun` runs `pnpm josh followup` and merges, `prrun` does three things and stops:

1. **Watch the pull request to mergeable** — `pnpm josh followup "<title> #<N>" --no-merge`
   (`followup.md` → "Run `pnpm josh followup`", read in the same turn): required CI green and the AI
   review findings resolved. A failure stops the run exactly as it stops a `fullrun`.
2. **Mark the stop — `pnpm josh run:hold <N> --prrun-stop`.** It records the commit the pull request is
   on in this run's own hold, the record `fullrun #<N>` adopts (its prrun resume, `working-tree-hold.md`). **The hold and `in-progress` stay**: the run is not finished until the merge's tail runs.
3. **Send a `confirmation` Telegram with the resume commands, then stop.** **`fullrun #<N>` first** —
   its `run:entry` reads where the pull request stands and resumes from there; the direct command
   follows for finishing without an agent:
   `pnpm josh notify --task-type confirmation --issue-url "<issue-url>" --body=$'prrun ready to
   merge: <pr-url>\nNext: fullrun #<N>\nAfter a manual merge, without an agent: pnpm josh followup
   "<title> #<N>"'`. The stop report names the same two, in the same order.

**Invoking `prrun` is _not_ authorization to merge** — never run `pnpm josh followup` without
`--no-merge` in a `prrun`. After a person merges by hand, the same `pnpm josh followup "<title> #<N>"`
runs only the post-merge tail (`followup.md`).

`prrun new`: `fullrun new` up to the pull request, then the three steps above with the filed number.
