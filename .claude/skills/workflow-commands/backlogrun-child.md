# `backlogrun` — running a child (shared mechanics, delegation, liveness, session setup)

Point-of-use, read one section at a time from `backlogrun.md` → "The manifest — the ordered flow".

## Running a child — the shared mechanics

This file is the single source of how **one child** runs — a named single-issue item, a named epic's
child and a bare backlog child all run the same `fullrun`. A named epic runs these mechanics over its
children until every one is processed, then the run advances to the next named item.

## When `#N` is not an epic

`backlogrun #<N>` on an Issue with no task list runs `#<N>` as a `fullrun` and finishes. A prerequisite
or a split found mid-run does **not** stop it:

**A split** → file the children with `route:split` (no confirmation) by `split-assessment.md` → "Two
or more always means an epic", then
`pnpm josh run:split <N> --children <N1,N2,...> [--ordered] [--title "<title>"]` (`docs/josh-commands-run.md`
→ "`josh run:split`"). `epic #<E>` → continue into the loop against `#<E>`; `needs-decision` → report.

**A prerequisite** `<P>` → file it with `route:tier-a` (no confirmation), then
`pnpm josh run:split <N> --prerequisite <P> [--title "<title>"]` (`docs/josh-commands-run.md` →
"`josh run:split`"), which pauses `#<N>` as `run:pause` does (`prerequisite.md`). `epic #<E>` →
**do not stop**, continue into the loop against `#<E>`; `needs-decision` → report.

Over the size bar before dispatch → a split-only unit, not a lane (`scripts/backlog/backlog-drive-split-unit.ts`).

- **Nothing found means no epic** — the run finishes at `#<N>`'s merge.
- **Every guard applies unchanged** (`backlogrun.md` → "Guards").
- **`fullrun` does not promote itself** — it files and **stops** (`split-assessment.md` → "Finding a
  split mid-run stops the run").
- **A bare Issue named beside an epic is a mistyped command.** Named alone, `epic:next`'s refusal is the answer;
  among several, it is **skipped** — `pnpm josh backlogrun <E> <N> --only` exits 0, notes the skip on stderr
  and **never runs `#<N>`**. To do both, run `pnpm josh backlogrun <N>` after the epic.

## Each child runs in a delegated unit

**Whatever offers a child — the loop, or a person clearing a label — the child is handed to a lane,
never run in the parent's context.** `pnpm josh delegate epic-child` answers `delegate`; the unit is a
detached process from `pnpm josh lane:launch` (`backlogrun-lanes.md` → "Opening one lane and
dispatching its child"; its profile and model: `docs/josh-commands-lane.md` → "`josh lane:dispatch`"). With no isolated
unit, run the child in the parent's context and still ask the hand-off at every merge.

- **The parent reads GitHub, never the summary** — `pnpm josh issue:state <N>` (or `run:merge`)
  verifies; **never advance the loop on the summary alone**.
- **The brief names the invocation it descends from** — e.g. `backlogrun #<E> --only`, the child
  number, and that it runs as `fullrun #<N>` under that authorization; the unit refuses a brief without
  it.
- A child whose ship waits on its merge frees its lane — the next child launches beside it, and a
  stop at `followup` relaunches the child at most one lane past the limit: `run-ship-place.ts`.

### What the summary carries, and how long it may be

**Only what GitHub does not, in at most 25 lines; the brief states the bound.**

- **Kept**: the cause / fix / result lines from `run:tail`'s `child summary template`; every verification not closed the ordinary way, named as such;
  observations that could bite later — **a child's only route for one** (`observation-filing.md` → "A
  delegated child does not take this route"); decisions not yet logged; what was left undone, on whose
  authority.
- **Cut**: the changed-file list, per-round review detail, restated rules.
- Before the final message → `pnpm josh report:lint --child-summary < summary.md`.

Fill the `<…>` narrative fields from `pnpm josh run:tail <N>`, keeping its cited targets.
`report:template child` supplies a standalone skeleton.

The `notify-message template` section supplies the three lines for `followup --notify-message`
(or `--notify-message-file`) when preparing a notification.

## Audit before the first child

Run `pnpm josh epic:audit <E>` before the first child; a run begun from a bare Issue audits when it
creates the epic. Errors stop the run; warnings are read and passed. Fixing a finding is Tier A.

## `josh latest` runs once per session, not once per child

It is a step of `pnpm josh run:prime` (`backlogrun-lanes.md` → "Once per repository, before the first
lane opens"), run before the first child. On `latest required`, load the `dependency-update` skill;
`latest-gate.md` is the single source. **A first child outside a lane** (a named issue) and a `stash`
line other than `clean` → `pnpm josh stash:pop "<message>"` with that message before it, in the
primary checkout; the lock file lands with its `pnpm josh git -y`. A resumed `backlogrun` asks again; fix a failing bump forward.
**Never inside a lane** (`pnpm josh latest:guard` refuses).

## Preflight — the child's claim asks it

`pnpm josh run:hold <N>`, the child's first call, prints the step for an interrupted run's leftovers
on stderr — follow it, and report a reclaim or resume with its stash reference
(`docs/josh-commands-run.md` → "`josh run:hold`").
