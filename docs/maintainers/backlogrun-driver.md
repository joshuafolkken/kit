# How the `backlogrun` driver runs the loop

This document is maintainer-only: it describes what `pnpm josh run:wake`, `backlog:drive`,
`backlog:offer`, `run:carry` and `run:merge` do on their own, so that the procedure documents an AI
parent reads carry only the branches it has to judge (joshuafolkken/kit#3396). It is never read during a
run — each command prints its own answer, and the route the parent follows is `backlogrun.md` →
"The manifest — the ordered flow". A change to a rule is made in the procedure document first.

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
takes the record's `started_at` and `--merged` its `merged`, so `--max` counts across cuts, as one
invocation's worth. The ten-per-origin filing ceiling outlives a cut too: `issue:file` counts it
from the event stream's `filed` events. **`--idle`
is the one budget that is not carried**: a resumed session states its resume moment as `--active` and
the watch begins again at its full budget.

**How many cuts the run crossed is named in the completion report**, read from the record's `cuts`,
beside how many sessions were woken — one wake per cut is the invariant, and what counts is a carry
record actually claimed, never a process started.

**`run:wake` supervises the driver.** After a cut or dead-owner recovery it adopts the carry record and
runs `backlog:drive` itself; the driver dispatches, collects, watches and reports without starting a
parent AI session. A handed-off record, or one whose owner died, starts the driver; a live owner
prevents a second driver from taking it over; on `none` or `unreadable` it stops. The
supervisor writes no label of its own, takes named issues from the invocation and pool issues from the
offer command, and spends the declared budget without ever declaring another. The named prefix
consults the carried maximum before each launch, and a failed named issue skips
the rest of the prefix. `window`, `merge busy` and `merge retry` reach a session only after the
supervisor's own re-runs run out (`run-wake-driver.ts`).

## The two budgets

**A `backlogrun` may declare how long it will wait once nothing can proceed and how many issues it
may take.** The idle watch is on by default while the maximum is not:

| Budget         | Written            | Default     | What it does                                                                                                                                                                                                                                             |
| -------------- | ------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Idle watch     | `--idle <minutes>` | **8 hours** | Once nothing can proceed — the backlog is empty, every opted-in issue waits on a person, or the listing could not be read — keep polling this long, counted from when the run's hands became free. A child that runs restarts the watch from that moment |
| Maximum issues | `--max <count>`    | unlimited   | How many issues this invocation may take. On reaching it the run reports and finishes                                                                                                                                                                    |

**`--idle 0` is the only way to turn the watch off.** The default's single source is
`scripts/backlog/backlog-budget.ts` → `IDLE_WAIT_HOURS` — the only 8 hours the run knows: nothing is
counted from the run's start, so no run is ended by its own age. A watch is polled
at the loop's one 60-second interval, the same as a running batch
(`scripts/backlog/backlog-budget.ts` → `OFFER_INTERVAL_SECONDS`).

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

| Verdict | What the loop does                                                                                                                                                |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run`   | Start what `backlog:next` offered, up to the free lanes and no more than the maximum still allows                                                                 |
| `watch` | Ask again at the 60-second interval, whether or not anything of this run's is in flight; a collected child is asked about at once. Nothing is held while watching |
| `stop`  | Report and finish. The reason it printed **is** the termination reason the completion report carries                                                              |

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
cut is the one taken at a dispatch instead.

## Where the run stops

Termination is decided by what the loop is told, never by a judgement that enough has been done:

- **`--only` ends the run once the named list is done** — it never enters the pool loop.
- **`pnpm josh backlog:budget` answering `stop`** — an idle watch running out, the maximum reached,
  and, only with the watch turned off by `--idle 0`, an empty backlog, a parked backlog or an
  unreadable listing. With the watch on, all three wait instead — **right after a merge too**: the
  driver asks `run:merge --driver` for no offer (it answers `deferred`, joshuafolkken/kit#4406), so
  no `backlog:next` `stop` (only person-waiting issues left) reaches it; the next pass asks
  `backlog:offer`, and `backlog:budget` decides (joshuafolkken/kit#3781). Only `run:merge`'s own control `stop` — the failure guard, or a failed
  child left unparked — ends the run there (`run_merge_token.is_control_stop`).
- **The guards in `backlogrun.md` → "Guards"**, counted over the whole `backlogrun`; whichever binds
  first ends the run.
- **A `needs-human-review` child stops only its lane** before its commit; the parent continues in free lanes (`needs-human-review.md`).
- **Parking is not stopping.** Only the consecutive-failure guard can turn repeated parks into a stop.
- **A driver that cannot read the carry record asks again before it ends** (joshuafolkken/kit#3697).
  `backlog:drive` checks the record before every offer, merge and launch; a read that is not
  `carried` is repeated up to 6 times at the 60-second offer interval, each failed read logged with
  what it answered and whether the file was there
  (`scripts/backlog/backlog-drive-owner.ts` → `READ_ATTEMPTS`). One failed read therefore costs one
  interval of the idle watch, never the rest of it. Two records are not re-read: one `run:carry --end`
  ended stops at once with `The carry record is no longer active.`, and one another owner holds
  stops with `The driver no longer owns the carry record.`
- **A named issue whose state does not read is read again before a session hears of it**
  (joshuafolkken/kit#3739). The failure is a `wait`, so the next offer — 60 seconds on — reads it again
  while the children in flight are still collected. The third consecutive failure (`backlog:offer`'s
  retry limit) hands back `offer`, with the issue and why the read failed on stderr; a number that
  resolves to nothing is handed back at once (`scripts/backlog/backlog-drive-unread.ts`).
- **A driver failure the supervisor cannot recover from ends the watch, and says so.** The driver
  exits non-zero once its re-reads run out, and the supervisor — whose own read of the record then
  fails too — stops as `failed`: it removes its wake record, sends the warning, and — when the run is
  left stranded and the warning was sent — leaves a `stranded` event carrying the driver's own error.
  A record that does not read is left stranded unless `run:carry --end` closed that very run, and one
  the driver left owned by the supervisor's own process is too, since that owner is the one leaving
  (`run-stranded-detect.ts` → `is_left_stranded`). A driver that fails while the record still reads
  is re-driven by the supervisor's restart: the record it left owned by the supervisor's own process
  is not read as a session at work (`run-carry.ts` → `is_held_by_another`), so the restarted pass
  claims it again and runs the driver, and a driver that keeps failing stops as `failed` after
  `RESTART_LIMIT` restarts (joshuafolkken/kit#3701). A record another live process holds is still
  waited on. After a failed send the stop-time detector leaves the marker and
  notifies instead, and a run `run:carry --end` closed gets none. `run:board` then draws
  the run `■` rather than `⏸` — it reads the same owner-gone, no-supervisor judgement as
  the `Stop` hook's strand report — so a run nobody is polling for is never drawn as one still waiting. Recovery is
  `pnpm josh run:wake --start`.

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

**`triage` is handed back rather than waited on** (joshuafolkken/kit#3731), when a child carries neither
`run:solo` nor `run:lane`. `epic:next --lanes` answers it with exit 0 on every pass, so it never reaches
the failure limit, and the named path gives `backlog:budget` a fixed `candidates` answer
(`scripts/backlog/backlog-drive-named-offer.ts`), so the idle bound never ends it either — a wait there
starts nothing and tells nobody. **It is handed back as `triage`, the pool path's word, never as
`epic #N`**: the `epic #N` procedure runs the epic's children and asks the single-child `epic:next`,
which is not triage-gated, so a session woken on it would launch the untriaged child. On `triage` the
session labels each child standard error names and cuts (`backlogrun-steps.md` → "The loop"), and the
next pass offers them; a child already running is left running.

## Waiting while something is in flight

**The numbers in `backlogrun-progress.md` → "Waiting, and never waiting forever" are floors between
asks, not a timer the parent sets.** `backlog:drive` polls lane completion and the backlog inside the
detached process; `lane:await` wakes on a child's completion and `run:progress --wait` on an arrival,
and the watcher's interval reports wake nobody (joshuafolkken/kit#3102). With no child in flight the
watcher may decline; the driver still polls for new work and enforces the idle bound. A
GitHub listing failure stays a retry or unreadable answer from the offer command, never an empty
backlog. `epic:next` prints each holder's label age beside it, marked `stale` past the window.

Waiting is decided by `epic:next`'s classification, never by reading labels:

| `epic:next` says                                               | `backlogrun` does                       |
| -------------------------------------------------------------- | --------------------------------------- |
| Something is runnable                                          | Run it                                  |
| Nothing runnable, something resolves on its own                | **Wait**                                |
| Nothing runnable, nothing resolves on its own, children remain | **Stop and report the parked children** |
| No open child                                                  | Post the epic summary and finish        |
