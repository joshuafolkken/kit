# `backlogrun` — progress, the hand-off, resume and waiting

Point-of-use, read one section at a time from `backlogrun.md` → "The manifest — the ordered flow"; the heartbeat is `progress-watcher.md` → "Progress while the run is quiet".

## Running a named epic's children

**`backlog:drive` walks this loop on its own; a session runs it when the driver hands back `epic #N`.**
Each child runs as `fullrun #<N>` in a lane —
`pnpm josh lane:launch <N>` (`backlogrun-lanes.md` → "Opening one lane and dispatching its child"),
then `pnpm josh lane:await <N...>` in the background — and every ending is read by one
command:

```bash
next=$(pnpm josh run:merge <N> --epic <E> --repo <owner/repo> --output <path>)
```

**`pnpm josh run:merge <N>` is the only reading of how a child ended** — never
classify `issue:state` by hand or ask `epic:next` in its place. **Pass `--output <path>`, the child's
transcript**; the named-epic flags are dropped for the opted-in backlog. It classifies, counts, closes
the lane and comments itself; act on the token.

| It prints | What the run does |
| --- | --- |
| numbers | Run the children it offers next. A kept `needs-decision` answers to `backlogrun-park.md` → "Only a person's judgement carries `needs-decision`" |
| `wait` | Wait for the next wake |
| `complete` | Record the root done (`backlogrun-steps.md` → "The session cut is inside the invocation") and post the epic summary |
| `over` | Hand the lanes over and take the cut — "The hand-off" below |
| human-review child | Keep its lane and `in-progress`; `run:merge` offers the next children and the stopped lane keeps one place under the limit (`backlogrun-park.md`) |
| `stop` / `environment` | Report the parked children (or the outage, or the `/login` an authentication failure needs) and stop |
| `resumed` | `lane:await <N>` it again |
| `retry` / `busy` | Re-read the child |

**Exit code 1** — a cyclic or unreadable graph: report and finish.

## After a named epic completes

**When a named epic's children are all processed — merged or parked — the run advances to the next
named item, and then drains the opted-in backlog** (unless `--only`). A completed epic — or a merged
bare named Issue — is one step of the invocation, never its end. Its summary is sent per "Who sends the
summary, and who propagates" below.

## The hand-off — one session does not have to run the whole batch

**The check is asked at every merge, and delegation does not excuse it** — `pnpm josh run:handoff-lanes`
after every child's merge and `pnpm josh main:sync`, never wired to `pnpm josh delegate epic-child`. It
chains `pnpm josh cost --cut` (its threshold priced at the session's model), the lane reading, `run:carry --cut`, `run:board --chat` and
`pnpm josh run:report --handoff` (`backlogrun-handoff-report.md`), and prints its verdict and `next:`
line. A cut **hands the session off to a fresh one, carrying the budget** (`backlogrun-steps.md` →
"The session cut is inside the invocation"); the threshold is `pre-gate-cut.md` → "The threshold".

| It answers | What the run does |
| --- | --- |
| `under` | Back to the loop |
| `cut` | Open no new lane, take no new child, and end the turn; the `run:wake` driver polls the lanes |
| `blocked <lanes>` | No cut, never assume idle: fix each named lane as printed, name it in the progress comment, re-ask at the next merge |
| `capped` | No `run:wake`, no hand-off: carry this session on and re-ask at the next merge |
| a step's exit code | Settle what it refused, then rerun the command |

**A parent without a completion callback (Codex) dispatches the wave and ends the turn** — `run:step`
prints the `--cut`. **A cut is not a failure and not a park** — nothing is labelled, stashed or filed.

## Resuming after a cut

**A session woken by the driver** — `Driver result:` in its prompt — acts on its branch and ends its turn
as its `Next:` line says. A session resumed by hand reads the subsections below.

### Picking the lanes up in the fresh session

**Start no child again and open no lane already open.** Run `pnpm josh run:pickup <E>...`: it launches
a lane per child the epics offer, prints each lane's liveness, and prints the watcher line to start in
the background (`run:watcher:guard`). A lane with a path is a handed-over child, waited on per
`backlogrun-recovery.md` → "A delegated unit that stopped without reporting".
**A carried-over child finishes in its own unit — never run its `followup` yourself**; one lost in the
cut is re-dispatched with `pnpm josh lane:open <N>` then `pnpm josh lane:dispatch <N>`.

### What carries over

**Nothing is carried in the conversation**: the budget, counters and named list are
`pnpm josh run:carry --json`; the remaining and runnable children `pnpm josh epic:next <E>`; the order
the epic body; what merged the epic's task list.

## Waiting, and never waiting forever

| Setting | Value | Meaning |
| --- | --- | --- |
| Re-ask floor | 60 s | **In flight, never a clock — the wait is `backlog:drive` or `lane:await`**, and the wake is their exit or the watcher's arrival exit, never a report; a state read repeated with nothing decided in between is refused. **With nothing in flight no wake comes: it is the parent's own clock.** A `backlogrun` idle watch re-asks at this same floor. |
| Silent delegated unit | 30 min | Not the child's duration — the time its output has gone **unchanged**. Past it, ask `run:liveness` and book a stopped unit as a failure. |
| Stale `in-progress` | 90 min | Past it, the other session is gone. |
| Publish wait | 10 min | `josh propagate`'s own budget. A failed publish never appears. |
| `backlogrun` idle watch | 8 h | Counted from when the run's hands became free, never from its start; `pnpm josh backlog:budget` decides it. |

Each timeout **ends the wait and reports** — none is retried indefinitely. A stale child's label is
removed first, so the next ask can offer it. **A graph that has
deadlocked on a cycle is not this loop's to untangle**: `epic:next` detects it and exits with an error.

## Who sends the summary, and who propagates

**Exactly one session does the end-of-epic work: the one standing in the repository that owns the
epic** — the start and completion notifications, `josh propagate`, and `pnpm josh release:scope` once
after the last merge (`followup.md` → "When `pnpm josh release` runs"). **Never compose the summary by
hand — `pnpm josh run:report` generates it**; pass it to `pnpm josh notify
--body-file`.
