# `fullrun` — the manifest (plan → implement → PR → merge → notify)

**This file is the manifest, not the procedure** (joshuafolkken/kit#2189). It carries the ordered
steps as terse triggers and pointers; the fine print of each step is read on demand from the file its
pointer names, and `pnpm josh run:step <N>` prints the run's next single action, computed from the
event stream, the carry record and the issue state (`run:next` is its pre-implementation degenerate
form, and the two share one mapping).
`chain-rule.md`, `followup.md`, `background-commands.md` and `latest-gate.md` are **not entry
reads** — each is fetched at its point of use, in the turn that reaches it. The step lists themselves
are `fullrun-steps.md`, read when a step needs its detail.

## The ordered entry sequence

**One call folds the mechanical steps of this sequence** (joshuafolkken/kit#2372): `pnpm josh
run:entry <N>` claims the tree, reads the budget, bundles the reads and decides the pre-implementation
step — steps 1, 3, 4 and 5 below in one round trip, so a lane no longer re-bills its context on each.
Its `entry #<N> — hold: … · cost: … · verdict: …` line carries the three facts the run branches on; a
`busy`/`unknown` hold or an `over` budget short-circuits with a non-zero exit, and the numbered steps
below are the detail behind each fact (`run:entry` reuses their own logic, it does not replace their
single sources). Step 2 — the `in-progress` label — stays its own call, applied the moment the folded
call reports `hold`.

1. **Claim the working tree — first, before anything else.** `pnpm josh run:hold <N>` (bare
   `pnpm josh run:hold` for `fullrun new`), ahead of the title, `git switch main` and a `new` entry's
   filing. `hold` continues; `busy` / `unknown` stop with a `confirmation` Telegram carrying stderr.
   `working-tree-hold.md` is the single source; a cross-repository target resolves its checkout from
   `pnpm josh doctor` first (`target-repository.md`).
2. **Apply `in-progress` the moment `run:hold` answered `hold`** — a `#N` counts as holding its lane
   from the claim (`fullrun-steps.md` carries the create/apply commands; a `fullrun new` applies it
   right after filing). Every stop that leaves the tree clean removes it in the same turn as
   `pnpm josh run:release`: `gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/in-progress
   2>/dev/null || true`. A `needs-human-review` stop keeps both hold and label.
3. **Ask the session boundary in the same turn as the hold** — `pnpm josh cost --cut`. `under`
   continues; `over` (or unanswerable) stops before the title with a `confirmation` Telegram carrying
   the figure and the resume command (`fullrun #<N>` / `fullrun new`), then `pnpm josh run:release`.
   **Skip it when dispatched by `backlogrun`** (that batch owns the question). `backlogrun-progress.md`
   → "The hand-off" is the single source of the check and the shared 200,000 threshold.
4. **Gather the mechanical reads — `pnpm josh run:prep <N>`**: `issue:read`'s body/comments
   (`issue-comments.md`), `issue:state`'s state/labels/`human_review`, and `latest:scope`'s dependency
   scope in one report, run beside `run:hold` and `cost --cut` in the same turn. The §2g comment stops,
   the `human_review` stop and the dependency decision are read off it.
5. **Print the next action — `pnpm josh run:step <N>`** (`run:next` for the prose form of the
   pre-implementation step) — and follow it into `fullrun-steps.md`: the
   `fullrun #N` list or the `fullrun new` list. Before implementing, `git switch main && git pull`, then
   `pnpm josh latest:scope` — update dependencies only on `required` (`latest-gate.md`), never on every
   run. `run:step` names every later action in order — the verification gate, `pnpm josh followup`,
   `pnpm josh ms`, the release ask — each read at the point-of-use doc the header lists, never
   re-narrated here (`residency.md` → ordering question).

## The progress step and the lane-child seam

- **Start the progress watcher once the hold is claimed** — `pnpm josh run:progress --wait` in the
  background, presented as-is when it exits, and `pnpm josh run:progress --mark` in the same turn as
  every real report (`backlogrun-progress.md` → "Progress while the run is quiet"). A `fullrun`
  dispatched as a lane child starts none and never reads that document (`pnpm josh read:set
  lane-child`). **The watcher is a per-session heartbeat; the run's report surface is not it** — the
  ambient surface is the run's event stream, followed identically before and after a cut, so nothing
  about the reporter moves when execution hands off (`backlogrun-progress.md` → "The invariant is a
  tier, not a mechanism").
- **A dispatched lane child asks whether it is a resume first — `pnpm josh run:cut --resume <N>`**; on
  `resume` it skips the title, plan, hold and implementation and goes to the gate. At the pre-gate
  boundary — immediately after `pnpm josh main:merge`, before the gate — it takes the cut with
  `pnpm josh run:cut <N>` (the ordered step in `chain-rule.md`, so the cut is taken before the gate
  rather than after a refusal), and it records any park on the Issue before the stop notify.
  `pre-gate-cut.md` is the single source of both.

## The stop branches

- **`needs-human-review`** — implement and gate, then stop before the commit; `needs-human-review.md`.
- **A split** — the assessment (`split-assessment.md` → "The question") finds two or more
  separately-mergeable deliverables over one gate: file the children (each `route:split`) and the epic,
  then **STOP** with "Please run `backlogrun #<E> --only` to execute this epic." Typing `fullrun`
  approved **one** Issue.
- **A prerequisite** — file it (`route:tier-a`), stash, record the dependency, and **STOP** with
  "Please run `backlogrun #<E> --only` to execute this epic"; `prerequisite.md`.
- **An observation** — file it without asking and carry on; `SKILL.md` → §2i.

**Automatic filing is capped at 10 Issues per run.** On reaching it, stop and report.

**The `into <target>` suffix** (a `new` entry) inserts the artifact into a named epic —
`into-target.md`, read when the suffix is typed.
