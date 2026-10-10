# The entry sequence and the stop branches — shared by `fullrun`, `halfrun` and `prrun`

`fullrun.md`, `halfrun.md` and `prrun.md` name only how their own run differs from this shared
procedure; `pnpm josh run:step <N>` prints the run's next single action. History:
`docs/maintainers/entry-sequence-rationale.md` → "Where each rule came from".

## The ordered entry sequence

**One call folds the mechanical steps**: `pnpm josh run:entry <N> --to
<command>` claims the tree, reads the budget, bundles the reads and decides the pre-implementation
step — steps 1, 3, 4 and 5 below in one round trip. Its `stage #<N>` line says where the run starts
(`start: reached` redoes nothing — stop), and its `entry #<N> — hold: … · cost: … · verdict: …` line
carries the three facts the run branches on; a `busy` / `unknown` hold or an `over` budget
short-circuits with a non-zero exit. The numbered steps are the detail behind each fact.

1. **Claim the working tree — first, before anything else.** `#N`: `pnpm josh run:entry <N> --to
   <command>` (no `--to` is `fullrun`), which calls `run:hold` as its first step. `new`: bare `pnpm
   josh run:hold`, ahead of the title and the filing. `hold` continues; `busy` / `unknown` stop with a
   `confirmation` Telegram carrying stderr (`run:entry` sends it). `working-tree-hold.md` is the single
   source; a cross-repository target resolves its checkout from `pnpm josh doctor` first
   (`target-repository.md`).
2. **`in-progress` rides on the hold** — for a `#N`, `run:entry` applies it once the tree is held and
   the budget allows the run; a `new` entry applies it right after filing (`fullrun-steps.md`). Every
   stop that leaves the tree clean ends with `pnpm josh run:release <N>`, which removes the label with
   the record (a `new` entry's bare release does not — `working-tree-hold.md`).
3. **Ask the session boundary in the same turn as the hold** — `pnpm josh cost --cut`. `under`
   continues; `over` (or unanswerable) stops before the title — `run:entry` sends the `confirmation`
   Telegram and runs `run:release` (`stop notified: …`); by hand only for `new`. **Skip it when
   dispatched by a batch** (that batch owns the question). The verdict and the shared 135,000 threshold
   are the command's own.
4. **Gather the mechanical reads — `pnpm josh run:prep <N>`**: `issue:read`'s body and comments
   (`issue-comments.md`), `issue:state`'s state, labels and `human_review`, and `latest:scope`'s
   dependency scope in one report; a `new` entry runs it once filed. The comment stops, the
   `human_review` stop (`needs-human-review.md`) and the dependency decision are read off it.
5. **Print the next action — `pnpm josh run:step <N>`** — and follow it into the command's step list.
   Before implementing, `pnpm josh ms`, then `pnpm josh latest:scope` — update
   dependencies only on `required` (`latest-gate.md`), never on every run. `run:step` names every later
   action in order, each read at the point-of-use document `SKILL.md` lists, never re-narrated here
   (`residency.md` → "順序の問い").

**Start the progress watcher once the hold is claimed** — `pnpm josh run:progress --wait` in the
background, started once and relayed never, and `pnpm josh run:progress --mark` in the same turn as
every real report (`progress-watcher.md` → "Progress while the run is quiet"). A run dispatched as a
lane child starts none and never reads that document (`pnpm josh read:set lane-child`).

## The stop branches

- **`needs-human-review`** — implement and gate, then stop before the commit, keeping the hold and
  `in-progress`; `needs-human-review.md`.
- **A split** — the assessment (`split-assessment.md` → "The question") finds two or more
  separately-mergeable deliverables over one gate: file the children (each `route:split`) and the epic,
  then **STOP** with "Please run `backlogrun #<E> --only` to execute this epic." Typing the command
  approved **one** Issue, never a batch.
- **A prerequisite** — file it (`route:tier-a`), stash, record the dependency, and **STOP** with
  "Please run `backlogrun #<E> --only` to execute this epic"; `prerequisite.md` is the single source of
  the filing, the `-u` stash and the epic:bundle branch.
- **An observation** — `observation-filing.md` (ask first if interactive).

**Automatic filing is capped at 10 Issues per run.** On reaching it, stop and report.

**The `into <target>` suffix** (a `new` entry) inserts the artifact into a named epic —
`into-target.md`, read when the suffix is typed.
