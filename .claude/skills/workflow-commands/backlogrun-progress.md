# `backlogrun` — progress, the hand-off, resume and waiting

Point-of-use, read one section at a time from `backlogrun.md` → "The route table"; the heartbeat is `progress-watcher.md` → "Progress while the run is quiet".

## Running a named epic's children

**`backlog:drive` walks this loop on its own; a session runs it when the driver hands back `epic #N`**
(the loop: `docs/maintainers/backlogrun-driver.md`; rationale:
`docs/maintainers/backlogrun-progress-rationale.md` → "Why a named epic's children run in lanes";
`docs/maintainers/backlogrun-progress-rationale.md` → "Why state lives in records, not the
conversation"). Each child runs as `fullrun #<N>` in a lane —
`pnpm josh lane:launch <N>` (`backlogrun-lanes.md` → "Opening one lane and dispatching its child"),
then `pnpm josh lane:await <N...> --owner "$PPID"` in the background — and every ending is read by one
command:

```bash
next=$(pnpm josh run:merge <N> --epic <E> --repo <owner/repo> --owner "$PPID" --output <path>)
```

**`pnpm josh run:merge <N>` is the only reading of how a child ended** — never
classify `issue:state` by hand or ask `epic:next` in its place. **Pass `--output <path>`, the child's
transcript**; the named-epic flags are dropped for the opted-in backlog. It classifies, counts, closes
the lane and comments itself; act on the token. Rationale:
`docs/maintainers/backlogrun-progress-rationale.md` → "Why a child's ending is read by `run:merge` alone";
`docs/maintainers/backlogrun-progress-rationale.md` → "Why a child's ending is classified at once";
provenance of each rule: `docs/maintainers/backlogrun-progress-rationale.md` → "Where each rule came from".

| It prints | What the run does |
| --- | --- |
| numbers | Run the children it offers next. A kept `needs-decision` answers to `backlogrun-park.md` → "Only a person's judgement carries `needs-decision`" |
| `wait` | Wait for the next wake |
| `complete` | Record the root done (`backlogrun-steps.md` → "The session cut is inside the invocation") and post the epic summary |
| `over` | Hand the lanes over and take the cut — "The hand-off" below |
| `human-review` | Stop, leave `in-progress` on; send a `confirmation` only where the child ran in this session's own context (`needs-human-review.md`) |
| `stop` / `environment` | Report the parked children (or the outage) and stop |
| `resumed` | `lane:await <N>` it again |
| `retry` / `busy` | Re-read the child |

**Exit code 1** — a cyclic or unreadable graph: report and finish.

## After a named epic completes

**When a named epic's children are all processed — merged or parked — the run advances to the next
named item, and then drains the opted-in backlog** (unless `--only`, which stops after the named
list). A completed epic is one step of the invocation, never its end. A named item that is a bare,
non-epic Issue reaches the same point when it merges. The epic's own completion summary is sent by the
session standing in the repository that owns it ("Who sends the summary, and who propagates" below).

## The hand-off — one session does not have to run the whole batch

**The check is asked at every merge, and delegation does not excuse it** — `pnpm josh cost --cut`
after every child's merge and `pnpm josh ms`, never wired to `pnpm josh delegate epic-child`. Crossing it **hands the session off to a fresh one,
carrying the budget** (`backlogrun-steps.md` → "The session cut is inside the invocation"); it is not a
stop. The threshold is `CONTEXT_CUT_THRESHOLD` in `scripts/cost-runtime/context-cut-threshold.ts`
(135,000, shared by the scheduler entry, hand-off and the lane worker cut, `pre-gate-cut.md` → "The
implementation-phase cut"). Rationale: `docs/maintainers/backlogrun-progress-rationale.md` → "Why the
hand-off check is asked at every merge".

| It answers | What the run does |
| --- | --- |
| `under` | Back to the loop |
| `over` | Open no new lane, take no new child, and read the lanes below in the same turn |
| exit 1, empty output | Report that the check could not answer, and take `over`'s branch |

**A parent without a completion callback (Codex) dispatches the wave and ends the turn** — `run:step`
prints the `--cut`.

**On `over`, read the lanes rather than judging them** — `pnpm josh lane:list` prints each lane's state
and output path; fill a missing path with `pnpm josh lane:output <N> <path>`:

- **A lane nobody can poll** (`unreadable`, or `open` with no path) — **the cut does not happen**: name
  it in the progress comment and re-ask at the next merge. **Never assume idle.** A `stranded` lane is
  closed by `pnpm josh lane:prune`.
- **Every in-flight lane records a path** — count everything, run `pnpm josh run:carry --cut --owner
  "$PPID"`, post the progress comment naming every lane and its path with `pnpm josh run:board`, and end
  the turn; the `run:wake` driver polls the lanes. Rationale:
  `docs/maintainers/backlogrun-progress-rationale.md` → "Why lanes are handed over rather than drained".
- **`--cut` answers `capped`** (`MAX_CUTS`) — **do not `run:wake` or hand off**;
  carry this session on and re-ask at the next merge.

The hand-off report's format is `backlogrun-handoff-report.md`. **This is not a failure and not a
park** — nothing is labelled, stashed or filed.

## Resuming after a cut

**A session woken by the driver** — `Driver result:` in its prompt — acts on its branch and cuts as its
`Next:` line says. A session resumed by hand reads the subsections below.

### Picking the lanes up in the fresh session

**Start no child again and open no lane already open.** In one turn: `pnpm josh lane:list` (every line
with a path is a handed-over child, polled per `backlogrun-recovery.md` → "A delegated unit that stopped
without reporting"), `pnpm josh run:progress --wait --output <handed-over paths>` in the background
(the `run:watcher:guard` enforces it), `pnpm josh run:liveness`, and
`epic:next --lanes` with a lane for each child it offers. **A carried-over child finishes in its own
unit — never run its `followup` yourself**; one that did not survive the cut is re-dispatched with
`pnpm josh lane:open <N>` then `pnpm josh lane:dispatch <N>`, never adopted.

### What carries over

**Nothing is carried in the conversation**: the budget, counters and named list are
`pnpm josh run:carry --json`; the remaining and runnable children `pnpm josh epic:next <E>`; the order
the epic body; what merged the epic's task list.

## Waiting, and never waiting forever

| Setting | Value | Meaning |
| --- | --- | --- |
| Polling interval | 60 s | **In flight, a floor between two asks, never a clock** — the wake is `lane:await`'s completion or the watcher's arrival exit, never a report. **With nothing in flight no wake comes: it is the parent's own clock.** |
| `backlogrun` idle-watch poll | 5 min | Not the interval above, and a floor in the same sense. |
| Silent delegated unit | 30 min | Not the child's duration — the time its output has gone **unchanged**. Past it, ask `run:liveness` and book a stopped unit as a failure. |
| Stale `in-progress` | 90 min | Past it, the other session is gone. |
| Publish wait | 10 min | `josh propagate`'s own budget. A failed publish never appears. |
| Whole run | 8 h | Past it, the run needs a person. |

Each timeout **ends the wait and reports** — none is retried indefinitely. Rationale for the figures:
`docs/maintainers/backlogrun-progress-rationale.md` → "Why the parent waits on classification, not a
clock". A stale child's label is removed first, so the next poll can offer it. **A graph that has
deadlocked on a cycle is not this loop's to untangle**: `epic:next` detects it and exits with an error.

## Who sends the summary, and who propagates

**Exactly one session does the end-of-epic work: the one standing in the repository that owns the
epic** — the start and completion notifications, `josh propagate`, and `pnpm josh release:scope` once
after the last merge (`followup.md` → "When `pnpm josh release` runs"). **Never compose the summary by
hand — `pnpm josh run:report` generates it**; pass it to `pnpm josh notify
--body-file`.
