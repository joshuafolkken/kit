# The entry sequence and the stop branches — shared by `fullrun`, `halfrun` and `prrun`

`pnpm josh run:step <N>` prints the run's next single action.

## The ordered entry sequence

**Call `pnpm josh run:entry <N> --to <command>` once, fresh or resumed.** It checks the carried cut
before the hold: a resume returns its instructions; `fresh` continues steps 1, 3, 4 and 5 below.
Never call `run:cut --resume` separately. Its `stage` line names the start (`reached` stops);
its `entry` line gives hold, cost and verdict. `busy` / `unknown` hold or `over` budget exits non-zero.

1. **Claim the working tree after the resume check.** `#N`: `pnpm josh run:entry <N> --to
   <command>` (no `--to` is `fullrun`), which calls `run:hold` on `fresh`. `new`: bare `pnpm
   josh run:hold`, ahead of the title and the filing. `hold` continues; `busy` / `unknown` stop with a
   `confirmation` Telegram carrying stderr (`run:entry` sends it). `working-tree-hold.md` is the single
   source; a cross-repository target resolves its checkout from `pnpm josh doctor` first
   (`target-repository.md`).
2. **`in-progress` rides on the hold** — `run:entry` applies it; a `new` entry runs
   `pnpm josh run:entry <N> --adopt` once filed (`fullrun-steps.md`). Every stop that leaves the tree
   clean ends with `pnpm josh run:release <N>`.
3. **Ask the session boundary in the same turn as the hold** — `pnpm josh cost --cut`. `under`
   continues; `over` (or unanswerable) stops before the plan; `new` asks it through `--adopt`. **Skip it
   when dispatched by a batch** (that batch owns the question).
4. **Gather the mechanical reads — `pnpm josh run:prep <N>`**: `issue:read`'s body and comments
   (`issue-comments.md`), `issue:state`'s state, labels and `human_review`, and `latest:scope`'s
   dependency scope in one report; `new` runs it through `--adopt`. The comment stops, the
   `human_review` stop (`needs-human-review.md`) and the dependency decision are read off it.
5. Honor prep's stop and update verdicts first. **`start: gate` skips `run:step`, planning and implementation**;
   enter the verification chain. Otherwise run `pnpm josh run:step <N>` and follow its step list.
   `run:entry` has already merged main (`docs/josh-commands-run.md` → "`josh run:entry`"). On `latest: required`, run `pnpm josh latest:if-required` (`latest-gate.md`). Later actions and their
   point-of-use reads come from `run:step` and `SKILL.md` (`residency.md` → "順序の問い").

**Start the progress watcher once the hold is claimed** — `progress-watcher.md` → "Progress while the
run is quiet", never fetched: `run:entry` prints it. A lane child starts none.

## The stop branches

- **`needs-human-review`** — implement and gate, then stop before the commit, keeping the hold and
  `in-progress`; `needs-human-review.md`.
- **A split** — the assessment (`split-assessment.md` → "The question") finds two or more
  separately-mergeable deliverables over one gate: file the children (each `route:split`) and the epic,
  then **STOP** with "Please run `pnpm josh backlogrun <E> --only` to execute this epic." Typing the
  command approved **one** Issue, never a batch.
- **A prerequisite** — file it (`route:tier-a`), `pnpm josh run:pause <M> --for <N>`, and **STOP**
  with the same line; `prerequisite.md` is the single source of the filing, the pause and the
  epic:bundle branch.
- **An observation** — `observation-filing.md` (ask first if interactive).

**The per-origin filing cap is `prerequisite.md`'s** (`issue:file`'s own step); on its refusal, stop and report.
