# `backlogrun` — progress, the hand-off, resume and waiting

Point-of-use, read one section at a time from `backlogrun.md` → "The route table"; the heartbeat is `progress-watcher.md` → "Progress while the run is quiet".

## Running a named epic's children

**`backlog:drive` walks this loop on its own; a session runs it when the driver hands back `epic #N`**
(rationale: `docs/maintainers/backlogrun-progress-rationale.md` → "Why a named epic's children run in
lanes"; `docs/maintainers/backlogrun-progress-rationale.md` → "Why a child's ending is classified at
once"; `docs/maintainers/backlogrun-progress-rationale.md` → "Why state lives in records, not the
conversation"). `josh epic:next <E> --repo <this repository> --lanes` prints one issue number per line
— as many as that repository has free lanes — or, when there is no child to run, the verdict as a
single token.

1. **One or more numbers** — in this session's own checkout the child's `fullrun` claim
   `pnpm josh run:hold <N>` runs the preflight check itself; in a lane the check is skipped and
   `lane:open`'s own answer replaces it. Each child runs as `fullrun #<N>` in a delegated unit, except
   that `josh latest` is not run and no progress watcher is started. `pnpm josh ms` runs in the primary
   checkout immediately before each `lane:open`.
2. **Start the unit without blocking on it** — `pnpm josh lane:dispatch <N>`, and in the same turn
   `pnpm josh lane:await <N...> --owner "$PPID"` in the background, which exits when any named child
   confirms-complete. A `lane:await` wake is a confirmed-gone process, so the ending is classified at
   once by the command below.
3. **Act on the token it prints**, and repeat until `epic:next` answers `complete` or `stop` — then
   record the root as done in the carry record (`backlogrun-steps.md` → "The session cut is inside the
   invocation").

**`pnpm josh run:merge <N>` is the only reading of how a child ended** (joshuafolkken/kit#2024) — never
classify `pnpm josh issue:state` by hand, and never ask `epic:next` in its place. Rationale:
`docs/maintainers/backlogrun-progress-rationale.md` → "Why a child's ending is read by `run:merge` alone".

```bash
next=$(pnpm josh run:merge <N> --epic <E> --repo <owner/repo> --owner "$PPID" --output <path>)
# a child number (or several, one per free lane) to run next, or a verdict token
```

**Pass `--output <path>` — the child's transcript** (joshuafolkken/kit#2240); without it an outage
ending reads as a plain failure. The named-epic flags are dropped for the opted-in backlog.

| It prints | What the child was, or what the run does |
| --- | --- |
| numbers | **merged** (counted, `ms`, `lane:close`, epic comment), **parked** (left alone), **outage** (stale `in-progress` dropped, re-dispatchable, uncounted) or **failed** (parked `needs-decision`, counted against the consecutive-failure guard) — then run the numbers it offers next. A kept label answers to `backlogrun-park.md` → "Only a person's judgement carries `needs-decision`" |
| `wait` / `complete` | `epic:next`'s own verdict: wait for the next wake, or post the epic summary |
| `over` | The merge crossed the budget: hand the lanes over and take the cut — "The hand-off" below |
| `human-review` | The child stopped before its commit (`needs-human-review.md`): stop, leave `in-progress` on, send no second `confirmation` (the unit sent one; where the child ran in this session's own context, it is yours to send) |
| `stop` | `epic:next` found only parked children left, or the consecutive-failure guard tripped: report the parked children and stop |
| `environment` | The consecutive-**outage** guard tripped: the API is down, and the run stops as an environment failure |
| `resumed` | An unadopted cut was relaunched: `lane:await <N>` it again (joshuafolkken/kit#2484) |
| `retry` / `busy` | The child's state could not be read: re-read it |

**Exit code 1** — `epic:next` refused a cyclic or contradictory graph, or could not read a child: report
and finish.

## After a named epic completes

**When a named epic's children are all processed — merged or parked — the run advances to the next
named item, and then drains the opted-in backlog** (unless `--only`, which stops after the named
list). A completed epic is one step of the invocation, never its end: `backlogrun` owns the whole
opted-in pool, so it goes on to whatever the plan and `backlog:next` offer next. A named item that is
a bare, non-epic Issue reaches the same point when it merges without a prerequisite or a split turning
up ("Nothing found means no epic"). The epic's own completion summary is sent by the session standing
in the repository that owns it ("Who sends the summary, and who propagates" below).

## The hand-off — one session does not have to run the whole batch

**The run reads the marginal cost off a line rather than feeling for it** — at **every** child's
merge, and crossing it **hands the session off to a fresh one, carrying the budget with it**
(`backlogrun-steps.md` → "The session cut is inside the invocation"). The cut is where a `backlogrun`
spans several sessions; it is not a stop. Rationale: `docs/maintainers/backlogrun-progress-rationale.md`
→ "Why the hand-off check is asked at every merge".

```bash
pnpm josh cost --cut
```

It prints `over` or `under` on standard output and the measured figure on standard error. `over` means
the next turn of this session costs more than the threshold in billed input.

**135,000 is shared by the scheduler entry, scheduler hand-off and lane worker implementation cut.**
The value is `CONTEXT_CUT_THRESHOLD` in `scripts/cost-runtime/context-cut-threshold.ts`; `cost --cut`,
`run:merge`, `run_cut.IMPLEMENTATION_CONTEXT_THRESHOLD` and the parent hand-off guard all read it — the
lane child's mid-implementation cut is `pre-gate-cut.md` → "The implementation-phase cut". The output
ceiling and the entry-read figure are a separate 150,000, not this threshold.

### The check is asked at every merge, and delegation does not excuse it

**A delegating parent reaches the threshold too, so there is no condition: `pnpm josh cost --cut` is
asked after every child's merge**, delegated or not — once per child, immediately after its merge and
`pnpm josh ms`; mid-child, a hook asks (#2947). **Never wire the question to `pnpm josh delegate
epic-child`** — a static policy lookup that answers `delegate` everywhere.

`over` and `under` are not the only answers: the command **exits 1 with empty standard output** when
there is no transcript, or no request in it. **Neither is `under`** — report that the check could not
answer, and take `over`'s branch at that child.

### A parent without a completion callback hands off at its first dispatch

**A finished command never re-invokes a Codex parent, so after a dispatch `run:step` prints the `--cut`
below the cut cap, `wait` at it** (joshuafolkken/kit#2653): dispatch the wave, run it, end the turn.

### Reading the lanes at the seam

**A merge is not by itself a safe seam, because another lane may still be running.** **Read the lanes rather than judging them:**

```bash
pnpm josh lane:list   # `none`, or one line per lane with its state and its recorded output path
```

**Every lane in flight is handed over, and the last column is what makes that possible** —
`pnpm josh lane:output <N>` prints the same path on its own, which is how the next session polls a lane
it never opened (`backlogrun-recovery.md` → "A delegated unit that stopped without reporting").

- **`under`** — go back to the loop and run the next child.
- **`over`** — **the run hands its lanes over and takes the cut at once.** Open no new lane and take no
  new child. Confirm every lane still in flight records an output path — one missing is filled in with
  `pnpm josh lane:output <N> <path>` — then take one of the next two bullets in the same turn. **There
  is no waiting here at all**: the lanes keep running as processes of their own.
- **A lane nobody could poll** — `unreadable`, or `open` with no recorded path and none that can be
  supplied — **and the cut does not happen.** Name that lane in the progress comment and go back to
  the loop; the reading is asked again at the next merge. **Never assume idle.** A `stranded` lane has
  no work tree and so no running child — `pnpm josh lane:prune` closes it.
- **Every in-flight lane records a path** — **record the cut and hand the session off**: count
  everything the session has, then run `pnpm josh run:carry --cut --owner "$PPID"`. **Unless it answers
  `capped`** (below), the `pnpm josh run:wake` driver starts at its next poll even while this session
  lives on, and polls the still-running lanes from `lane:list`. Post the progress comment naming **every lane in flight and the path each
  records**, name `pnpm josh run:board` for a pane, and end the turn — nothing is relayed (#2492).
- **`capped`** — the invocation has taken its `MAX_CUTS` cuts (joshuafolkken/kit#2346), so `--cut`
  refused and left the record un-handed-off. **Do not `run:wake` or hand off.** Carry **this** session on
  uncut and re-ask at the next merge.

Rationale for handing lanes over: `docs/maintainers/backlogrun-progress-rationale.md` → "Why lanes are
handed over rather than drained".

**The hand-off report belongs to the stop, not to the reading** — a reading that goes back to the loop
writes none; the epic progress comment is the record. The report's format is
`backlogrun-handoff-report.md`. **This is not a failure and not a park**: `needs-decision` is not
applied, nothing is stashed, and no Issue is filed.

## Resuming after a cut

**A session woken by the driver's hand-off** — `Driver result:` in its prompt — acts on its branch and
cuts as its `Next:` line says; the `run:wake` driver watches the lanes, and the watcher guard and the
headless stop rule stand aside for it. A session resumed by hand reads the three subsections below.

### Picking the lanes up in the fresh session

**The resumed session does not start a child again, and does not open a lane that is already open.** Its
first reading is `pnpm josh lane:list`: every line with a recorded path is a child that was handed over,
polled exactly as the session that dispatched it polled it (`backlogrun-recovery.md` → "A delegated unit
that stopped without reporting"). **`pnpm josh lane:open <N>` re-attaches to a lane whose branch is
already pushed**, which a handed-over lane needs when its child has to be finished by hand.

**Restart the progress watcher by name** — `pnpm josh run:progress --wait --output <handed-over paths>`
in the background, in the same turn as that first `lane:list`. The wired `run:watcher:guard` stops a resume that skips this (joshuafolkken/kit#2353).

### A carried-over merge does not stand in front of the next lane

**A carried-over child finishes in its own detached unit, and the resumed parent never runs its
`followup` itself** (`background-commands.md` → "Background the gate and push"): it polls the
handed-over lane and opens new work beside it. **The reads and the dispatches go out together, in one
turn** — `pnpm josh lane:list`, `pnpm josh run:liveness`, `epic:next --lanes`, and opening a lane for a
child it offers take none of each other's results. **Independence is the offer command's answer**: a
new child `blocked-by` a carried-over Issue is withheld. **A carried-over child that did not survive
the cut is re-dispatched, never adopted** — `pnpm josh lane:open <N>` then `pnpm josh lane:dispatch <N>`.

### What carries over, and where it lives

**Nothing is carried in the conversation.** Everything the next session needs it reads back:

| What the next session needs | Where it reads it |
| --- | --- |
| The budget, the counters and the named list | `pnpm josh run:carry --json` |
| Which children remain, and which is runnable | `pnpm josh epic:next <E>` |
| The order and the dependencies | the epic body |
| What each remaining child is | the child Issue body |
| What already merged | the epic's task list, and the closed children |

## Waiting, and never waiting forever

| Setting | Value | Meaning |
| --- | --- | --- |
| Polling interval | 60 s | **A floor between two asks, never a clock the parent sets** — the wake is a child's completion or an arrival (`docs/maintainers/backlogrun-driver.md` → "Waiting while something is in flight"). |
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

With several sessions on one epic, **exactly one does the end-of-epic work: the session standing in the
repository that owns the epic.** It sends the epic completion summary and runs `josh propagate`, which
itself refuses to run outside the supplier repository. Every other session finishes quietly once its own
repository has no children left.

Per-child completion notifications are unchanged: `pnpm josh followup` sends one each. Send an epic
**start** notification when the run begins, and an epic **completion** summary at the end. **Do not
compose that summary by hand — `pnpm josh run:report` generates it from this invocation's events**
(joshuafolkken/kit#2249, scoped in #2393): it renders what merged, what parked and why, and what was cut,
closing with the release tail below. Its output is the Telegram body too — pass it to
`pnpm josh notify --body-file`.

**That same session asks `pnpm josh release:scope` once, after the last child has merged** — in the
primary checkout, after the last lane is closed, and never once per child. `followup.md` →
"When `pnpm josh release` runs" is the single source for the position and the three answers. `run:report`
appends that answer as the summary's closing line: on `required` the request and the exact command, on
`unknown` the word `unknown`, never rounded to `skip`.
