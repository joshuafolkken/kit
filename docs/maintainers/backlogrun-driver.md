# How the `backlogrun` driver runs the loop

This document is maintainer-only: it describes what `pnpm josh run:wake`, `backlog:drive`,
`backlog:offer`, `run:carry` and `run:merge` do on their own, so that the procedure documents an AI
parent reads carry only the branches it has to judge (joshuafolkken/kit#3396). It is never read during a
run — each command prints its own answer, and the route the parent follows is `backlogrun.md` →
"The route table". A change to a rule is made in the procedure document first.

## The carry record across a cut

**Count into the record rather than into your head** — `--merged <N> --owner "$PPID"` at every child's
merge, `--filed 1 --owner "$PPID"` at every Issue the run files, and `--cut --owner "$PPID"`
immediately before the cut. `--merged` names the merged issue, never a count
(`scripts/run/carry/run-carry-args.ts`): `run:merge` records the same issue, so a merge counted on both
paths counts once. Every other counter is an increment. A count that does not name the record's owning
process is refused.

**`--cut` hands the record off, and so does `run:wake` for a dead owner** (joshuafolkken/kit#2437): the
next `--begin` naming the same invocation answers `resumed` — even while the cutting process is still
running. A `--merged` or `--filed` issued after the `--cut` is refused.

**`backlog:budget` is fed from the record, never from a count kept in the conversation:** `--started`
takes the record's `started_at` and `--merged` its `merged`, so `--max` and the 8-hour whole-run bound
count across cuts, as one invocation's worth. The 10-filings-per-run ceiling is counted the same way,
from `filed`. **`--idle` is the one budget that is not carried**: a resumed session states its resume
moment as `--active` and the watch begins again at its full budget, bounded by the 8 hours.

**How many cuts the run crossed is named in the completion report**, read from the record's `cuts`,
beside how many sessions were woken — one wake per cut is the invariant, and what counts is a carry
record actually claimed, never a process started.

**`run:wake` supervises the driver.** After a cut or dead-owner recovery it adopts the carry record and
runs `backlog:drive` itself; the driver dispatches, collects, watches and reports without starting a
parent AI session. A handed-off record, or one whose owner died, starts the driver; a live owner
prevents a second driver from taking it over; on `none`, `expired` or `unreadable` it stops. The
supervisor writes no label of its own, takes named issues from the invocation and pool issues from the
offer command, and spends the declared budget without ever declaring another. The named prefix
consults the carried maximum and whole-run bound before each launch, and a failed named issue skips
the rest of the prefix. `window`, `merge busy` and `merge retry` reach a session only after the
supervisor's own re-runs run out (`run-wake-driver.ts`).

## The two budgets

**A `backlogrun` may declare how long it will watch an empty backlog and how many issues it may
take.** The idle watch is on by default while the maximum is not:

| Budget         | Written            | Default        | What it does                                                                                                                     |
| -------------- | ------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Idle watch     | `--idle <minutes>` | **30 minutes** | After the candidates run out, keep polling this long for a new one. A candidate that appears restarts the watch from that moment |
| Maximum issues | `--max <count>`    | unlimited      | How many issues this invocation may take. On reaching it the run reports and finishes                                            |

**`--idle 0` is the only way to turn the watch off.** The default's single source is
`scripts/backlog/backlog-budget.ts` → `DEFAULT_IDLE_MINUTES`. A watch is polled every 5 minutes, not
at the loop's 60-second interval.

**`backlog:offer` asks `backlog:budget` on every iteration** and hands back one verdict:

```bash
offer=$(pnpm josh backlog:offer --started "$started" --active "$active" \
  --merged <count> --running <count> --retries <count> [--idle <minutes>] [--max <count>])
```

`--active` is required of every ask while the watch is on; only `--idle 0` excuses it. `--running` also
decides `wait` and `--retries` decides `retry`. `--started` is when the invocation began; `--active` is
when it last had work, so refreshing it restarts the idle watch. Both are ISO-8601 timestamps.
`--merged` and `--running` both count against the maximum. **No ending abandons a lane**: whatever would
have ended the run answers `watch` while `--running` is above zero.

| Verdict | What the loop does                                                                                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run`   | Start what `backlog:next` offered, up to the free lanes and no more than the maximum still allows                                                   |
| `watch` | Ask again — at the 5-minute idle poll while nothing of this run's is in flight, at the 60-second interval otherwise. Nothing is held while watching |
| `stop`  | Report and finish. The reason it printed **is** the termination reason the completion report carries                                                |

**At the drain the retrospective fires before the watch** (joshuafolkken/kit#2335): `backlog:offer`
marks the drain on the event stream and `run:step` fires the retrospective there, so the watch that
follows picks up its filings. The full contract is `docs/josh-commands-backlog.md` →
"`josh backlog:budget`".

**The completion report names three things the budgets make meaningful**: how many issues the run
took, how many were picked up during an idle watch, and the termination reason quoted from what
`backlog:budget` printed.

## The cost check is not asked during a watch

**A watch does not count towards the session cut.** The hand-off check is asked at a child's merge,
and a watch has no merges, so a run that is only watching never reaches one — nor does the
supervisor's `backlog:drive`, which has no session to cut (joshuafolkken/kit#3156). A Codex parent's
cut is the one taken at a dispatch instead. The 8-hour whole-run bound still outranks all of this.

## Where the run stops

Termination is decided by what the loop is told, never by a judgement that enough has been done:

- **`--only` ends the run once the named list is done** — it never enters the pool loop.
- **`pnpm josh backlog:budget` answering `stop`** — an idle watch running out, the backlog emptying
  with the watch off, the maximum reached, a parked backlog, an unreadable listing, and the whole-run
  bound.
- **The guards in `backlogrun.md` → "Guards"**, counted over the whole `backlogrun`; whichever binds
  first ends the run.
- **A `needs-human-review` child stops the whole run** before its commit (`needs-human-review.md`).
- **Parking is not stopping.** Only the consecutive-failure guard can turn repeated parks into a stop.

## Running a named epic's children — the loop `backlog:drive` walks

**The loop's steps are `backlogrun-progress.md` → "Running a named epic's children"** — the driver walks
the same steps a session walks when it is handed `epic #N`, so they live once, in the shipped
procedure. The non-blocking `lane:await` is joshuafolkken/kit#2113, and classifying the ending at once
on its wake is joshuafolkken/kit#2277. What the driver adds on its own: the hand-off check — `pnpm josh cost --cut` after
`pnpm josh ms` — is folded into the merge branch, and a session that cannot measure reads as `over`.
Passing `--output <path>` is what lets the composite tell an API-outage ending from a genuine failure.
**The counters live in the carry record**, and the epic progress comment is generated from it at every
merge — children run, Issues filed, consecutive failures, and the run's start time.

**The driver reads the epic's current children on every pass** (`scripts/backlog/backlog-drive-epic.ts`),
so a child filed into the epic mid-run is dispatched without `run:add` and without a parent session. It
hands `epic #N` back with the original invocation only on `epic:next`'s `stop`, when every child left
waits on a person, or after `backlog:offer`'s retry limit of consecutive `epic:next` failures (a broken
graph).

## Waiting while something is in flight

**The numbers in `backlogrun-progress.md` → "Waiting, and never waiting forever" are floors between
asks, not a timer the parent sets.** `backlog:drive` polls lane completion and the backlog inside the
detached process; `lane:await` wakes on a child's completion and `run:progress --wait` on an arrival,
and the watcher's interval reports wake nobody (joshuafolkken/kit#3102). With no child in flight the
watcher may decline; the driver still polls for new work and enforces the idle and whole-run bounds. A
GitHub listing failure stays a retry or unreadable answer from the offer command, never an empty
backlog. `epic:next` prints each holder's label age beside it, marked `stale` past the window.

Waiting is decided by `epic:next`'s classification, never by reading labels:

| `epic:next` says                                               | `backlogrun` does                       |
| -------------------------------------------------------------- | --------------------------------------- |
| Something is runnable                                          | Run it                                  |
| Nothing runnable, something resolves on its own                | **Wait**                                |
| Nothing runnable, nothing resolves on its own, children remain | **Stop and report the parked children** |
| No open child                                                  | Post the epic summary and finish        |
