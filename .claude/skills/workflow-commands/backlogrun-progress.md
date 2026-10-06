# `backlogrun` — progress, the hand-off, resume and waiting

**Read this file in full before the first child is dispatched** and before the hand-off check at a
child's merge (`pnpm josh cost --cut`). It is a point-of-use document, never an entry read: the entry
procedure is `backlogrun.md`, which points here at those steps (joshuafolkken/kit#2010). This file is
the single source of the session hand-off and cut/resume, waiting without waiting forever, and the
end-of-run summary and propagate. **The heartbeat is not here** — it binds every implementing run, so
its single source is `progress-watcher.md` → "Progress while the run is quiet" (joshuafolkken/kit#3172),
read before the watcher starts.

After a carry hand-off, the detached `run:wake` supervisor runs the deterministic `backlog:drive`
loop. References below to a parent's mechanical polling and lane collection describe work now done
by that supervisor; an AI parent is started only for a driver branch that requires judgment.

## Running a named epic's children

`josh epic:next <E> --repo <this repository> --lanes` prints **one issue number per line** on standard
output — as many as that repository has free lanes — or, when there is no child to run, the verdict as a
single token. Everything else goes to standard error. Without `--lanes` the answer is a single token
either way.

```bash
answers=$(pnpm josh epic:next 858 --repo joshuafolkken/kit --lanes)
# one issue number per line, up to the number of free lanes; a verdict token when there is none
answers=$(pnpm josh epic:next 858 909 --repo joshuafolkken/kit --lanes)
# every named epic, merged into the same pool — "Several epics in one run" above
```

**`--lanes` is the form to use.** Read a line per child, and treat a single non-numeric line as the
verdict. Rationale: `docs/maintainers/backlogrun-progress-rationale.md` → "Why a named epic's children
run in lanes".

1. Run the command above.
2. **One or more numbers** — where the child runs in this session's own checkout, its `fullrun` claim
   `pnpm josh run:hold <N>` **now runs the preflight check itself** and is obeyed: `reclaim` is
   recovered and `run:hold` asked again, `park` parks this child and returns to step 1, `unknown` stops
   the session, `resume` starts the child on the branch that is there with the whole verification gate
   re-run, and `hold` starts it. **In a lane the check is skipped**, and `lane:open`'s own answer
   replaces it. **Everything from here on is per child**:
   with several in flight each is confirmed, counted and closed on its own, and step 1 is asked again
   once a lane comes free rather than once the last child returns. Either way the child runs as
   `fullrun #<N>` does, **in a delegated unit where one is available** (`pnpm josh delegate epic-child`
   → `delegate`) and **in this session's own context where none is**, **except that `josh latest` is
   not run** and **no progress watcher is started**. `git switch main && git pull` runs per child in
   whichever context implements it, **and again in this session afterwards** when the child was
   delegated. **In a lane the child cannot run it at all**, so it is the parent's, immediately before
   that lane's `lane:open`.

   **Start the unit without blocking on it — `pnpm josh lane:dispatch <N>` when the child runs in a
   lane — and in the same turn start `pnpm josh lane:await <N...> --owner "$PPID"` in the background** (joshuafolkken/kit#2113).
   `lane:await` watches local process presence and exits when any named child confirms-complete. **The
   re-confirm delay and poll interval are the command's, not the agent's** — pass only the issue
   numbers and `--owner` (why: `docs/josh-commands-run.md` → `josh lane:await`). Without that wake (Codex), hand off instead — "A parent without a completion callback".

   **A `lane:await` wake is a confirmed-gone process, so classify the ending at once — do not wait out
   the silent-unit window** (joshuafolkken/kit#2277). On a `lane:await` wake go straight to `pnpm josh run:merge <N> --output <path>` — the composite reads the child's **exit
   record**, decisive whether the child merged, died on an outage, or abandoned mid-implementation
   ("Running a named epic's children" reads its tokens). An outage child is re-dispatched in the same run
   and a run of them trips the environment guard; nothing waits for a person. Rationale:
   `docs/maintainers/backlogrun-progress-rationale.md` → "Why a child's ending is classified at once".

   **`run:liveness` stays the fallback for a lane no `lane:await` is watching** — a handed-over lane a
   resumed session polls ("Picking the lanes up in the fresh session"). Ask
   `pnpm josh run:liveness <N> --output <path> --process <what `pgrep -laf "(fullrun|run-ship-cli\.ts .*) #<N>$"` found>` where
   that file has been unchanged for the silent-unit window; on `stopped` its own advice routes the child
   through the same `run:merge --output` classification. **The flag is what you saw, never what kind of
   child it is.**

   **When the unit reports back, a merge is one event, and one call of the parent's — `pnpm josh
   run:merge <N>`** (joshuafolkken/kit#2024). It is the only reading of how the child ended: never
   classify `pnpm josh issue:state` by hand, and never ask `epic:next` in its place. Rationale:
   `docs/maintainers/backlogrun-progress-rationale.md` → "Why a child's ending is read by `run:merge` alone".
   The composite command confirms the child from GitHub, does the post-merge steps, folds in the hand-off check, and prints
   the next child number — or a control verdict — for the parent to read. Pass the merged child's
   number and the offer's source — `--epic <E> --repo <owner/repo>` for a named epic,
   nothing for the opted-in backlog — with `--owner "$PPID"` so it counts into the carry record under
   the ownership guard.

   ```bash
   next=$(pnpm josh run:merge <N> --epic <E> --repo <owner/repo> --owner "$PPID" --output <path>)
   # a child number (or several, one per free lane) to run next, or a verdict token
   ```

   **Pass `--output <path>` — the child's transcript** (joshuafolkken/kit#2240). Without it the
   composite cannot tell an API-outage ending from a genuine failure: an OPEN, unparked child is a plain
   failure.

   **What the one call does is decided by what the child turned out to be** — read from its GitHub state
   (and, for the failed case alone, its exit record), never from a log: a **merged** child (CLOSED) is
   counted into the carry record (which resets the failure streak), then `pnpm josh ms`,
   `pnpm josh lane:close <N>`, and the counters mirrored onto the epic comment; a **parked** child (OPEN,
   `needs-decision` or `already-done`) is left alone and not counted; an **outage** child (OPEN, neither
   label, but the exit record shows it could not reach the API) has its stale `in-progress` dropped, is
   **not** parked and **not** counted against the consecutive-failure guard, and stays re-dispatchable
   (joshuafolkken/kit#2240); a **failed** child (OPEN, neither label, not an outage) has its stale
   `in-progress` dropped, is parked with `needs-decision`, and is counted against the consecutive-failure
   guard. The label stays only once its reason passes `backlogrun-park.md` → "Only a person's judgement
   carries `needs-decision`".

   **Beyond the offer `epic:next` prints** (`run` becomes numbers; `wait` / `stop` / `complete` /
   `error` pass through), the composite adds six verdict tokens: `over` — the merge crossed the budget,
   so hand the lanes over and take the cut ("The hand-off" below); `human-review` — the child stopped
   before its commit, the run's own ending (needs-human-review.md), so stop — leave `in-progress` on, and send
   no second `confirmation` Telegram, since the unit already sent one (where the child ran in this
   session's own context, that first notification is yours to send); `stop` — the consecutive-failure
   guard tripped; `environment` — the consecutive-**outage** guard tripped, so the API is down and the
   run stops as an environment failure rather than the children's (joshuafolkken/kit#2240); `resumed` —
   an unadopted cut was relaunched; `lane:await <N>` it again (joshuafolkken/kit#2484); and `retry` — the child's state could not be read, so re-read it.

   **The counters are the carry record's, and the epic progress comment is generated from it** (see "The
   counters live in the record" below). **The hand-off check is folded into the merge branch of the one
   call** — `pnpm josh cost --cut`, run after `pnpm josh ms`; `under` offers the next child,
   `over` prints `over` so the parent hands its lanes over and takes the cut ("The hand-off" below), and
   a session that cannot measure is read as `over`. **Never read the condition off `pnpm josh delegate
   epic-child`** ("The check is asked at every merge" below).
3. **`wait`** — go back to step 1. **With something of this run's own in flight, that happens on the
   wake `lane:await` or the progress watcher's arrival exit delivers** and the parent starts no sleep
   of its own; the 60 s figure bounds how soon the ask may be repeated. **A scheduled report is not one
   of those wakes** (joshuafolkken/kit#3102). **With nothing in flight neither wake comes, so the parent
   keeps the interval** — the case for "another repository has work but this one does not", and for a
   cross-repository publish wait. "The wake exists only while something is in flight" below decides
   which.
4. **`stop`** — report the parked children and finish.
5. **`complete`** — post the epic summary and finish.
6. **Exit code 1** — `epic:next` refused a cyclic or contradictory graph, or could not read a child.
   Report and finish.

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
`run:merge`, `run_cut.IMPLEMENTATION_CONTEXT_THRESHOLD` and the parent hand-off guard all read it. The
output ceiling and the entry-read figure are a separate 150,000, not this threshold.

### The check is asked at every merge, and delegation does not excuse it

**A delegating parent reaches the threshold too, so there is no condition: `pnpm josh cost --cut` is
asked after every child's merge**, delegated or not.
**Never wire the question to `pnpm josh delegate epic-child`** — a static policy lookup that answers
`delegate` everywhere.

`over` and `under` are not the only answers: the command **exits 1 with empty standard output** when
there is no transcript, or no request in it. **Neither is `under`** — report that the check could not
answer, and take `over`'s branch at that child.

### When to ask, and what to do

**Ask once per child, immediately after its merge and `pnpm josh ms`**; mid-child, a hook asks (#2947).

### A parent without a completion callback hands off at its first dispatch

**A finished command never re-invokes a Codex parent, so after a dispatch `run:step` prints the `--cut`
below the cut cap, `wait` at it** (joshuafolkken/kit#2653): dispatch the wave, run it, end the turn.

### The lane child reuses this measurement mid-implementation

**The same `pnpm josh cost --over` measurement bounds a lane child's context _during_ implementation, not
only the parent's between children**. The child measures its own per-request
context with **this command** at the shared `CONTEXT_CUT_THRESHOLD`, 135_000, and cuts with
`pnpm josh run:cut --impl <N> --handoff <path>`. **The measurement and threshold are single-sourced**:
`cost_verdict.per_request_cost` is what both seams compare, and `cost --cut` selects the same constant
for both. The boundary and the resume: `pre-gate-cut.md` → "The implementation-phase cut".

**A merge is not by itself a safe seam, because another lane may still be running.** **Read the lanes rather than judging them:**

```bash
pnpm josh lane:list   # `none`, or one line per lane with its state and its recorded output path
```

**Every lane in flight is handed over, and the last column is what makes that possible.**
`pnpm josh lane:output <N>` prints the same path on its own, so the next session polls a lane it never
opened with two:

```bash
unit_output=$(pnpm josh lane:output <N>) &&
  pnpm josh run:liveness <N> --output "$unit_output" --process alive
```

**`--process` carries what `pgrep` found, and with a dispatched child that is the whole answer.** Run
`pgrep -laf "(fullrun|run-ship-cli\.ts .*) #<N>$"` first and pass `alive` where it found the child and `none` where it did not
— **never `alive` because the child was dispatched**, and never from a `pgrep` on the lane's directory.

**The `&&` is load-bearing.** A lane that records nothing prints `none` and exits non-zero; substituted
straight into `--output`, that `none` is a relative path and `run:liveness` answers `undetermined` for
ever.

- **`under`** — go back to step 1 of the loop and run the next child.
- **`over`** — **the run hands its lanes over and takes the cut at once.** Open no new lane and take no
  new child. Confirm every lane still in flight records an output path — one missing is filled in with
  `pnpm josh lane:output <N> <path>` — then take one of the next two bullets in the same turn. **There
  is no waiting here at all**: the lanes keep running as processes of their own.
- **A lane nobody could poll** — `unreadable`, or `open` with no recorded path and none that can be
  supplied — **and the cut does not happen.** Name that lane in the progress comment and go back to
  step 1 of the loop; the reading is asked again at the next merge.
- **Every in-flight lane records a path** — **record the cut and hand the session off.** `backlogrun`
  declares a budget — `--max`, `--idle` and the 8-hour bound — so the cut is an execution detail: count
  everything the session has, then run `pnpm josh run:carry --cut --owner "$PPID"`. **Unless it answers
  `capped`** (below), `pnpm josh run:wake` then starts the next session, which polls the still-running
  lanes from `lane:list`. Post the progress comment naming **every lane in flight and the path each
  records**, name `pnpm josh run:event --watch` for a pane, and end the turn — nothing is relayed (#2492).
  `backlogrun-steps.md` → "The session cut is inside the invocation" is the single source of the
  carry; this reading is only where the cut is *taken*.
- **`capped`** — the invocation has taken its `MAX_CUTS` cuts (joshuafolkken/kit#2346), so `--cut`
  refused and left the record un-handed-off. **Do not `run:wake` or hand off.** Carry **this** session on
  uncut and re-ask at the next merge.

Rationale for handing lanes over: `docs/maintainers/backlogrun-progress-rationale.md` → "Why lanes are
handed over rather than drained".

**A lane is handed over only where the next session can actually poll it.** A lane whose state is
`open` **and** whose recorded path is not `-` is handed over. A **`stranded`** lane has no work tree and
so no running child — `pnpm josh lane:prune` closes it. An **`unreadable`** one cannot be told apart
from a running child, and an `open` lane recording **no path** is the same: **the cut does not happen**,
the lane is named in the epic progress comment, and the run goes back to step 1. **Never assume idle.**

**The hand-off report belongs to the stop, not to the reading.** For the one reading that does not stop —
an `unreadable` lane, or an `open` one recording no path — the run goes back to step 1 and writes no
hand-off report; the epic progress comment is the record. `report-format.md` → "区切りの報告" states it
from the format's side.

**This is not a failure and not a park.** No child needs a decision; the run is either handing its lanes
on or standing at the seam. `needs-decision` is not applied, nothing is stashed, and no Issue is filed.

### Picking the lanes up in the fresh session

**The resumed session does not start a child again, and does not open a lane that is already open.** Its
first reading is `pnpm josh lane:list`: every line with a recorded path is a child that was handed over,
polled exactly as the session that dispatched it polled it (the two-line form above, same answer table
and same two-`undetermined`-in-a-row rule). **The `--process` argument is the one thing that changes** —
a fresh session did not start those processes, so it reports `none` unless it has looked itself.
**`pnpm josh lane:open <N>` re-attaches to a lane whose branch is already pushed**, which a handed-over
lane needs when its child has to be finished by hand.

**Restart the progress watcher by name** — `pnpm josh run:progress --wait --output <handed-over paths>`
in the background, in the same turn as that first `lane:list`. The wired `run:watcher:guard` stops a resume that skips this (joshuafolkken/kit#2353).

**A session woken by the driver's hand-off does neither**: with `Driver
result:` in its prompt, the `run:wake` driver watches the lanes, so it acts on its branch and cuts as
its `Next:` line says. The watcher guard and the headless stop rule stand aside for it.

### A carried-over merge does not stand in front of the next lane

**A carried-over child finishes in its own detached unit, and the resumed parent does not stand in front
of its merge.** A lane handed over at the cut is still running its own `fullrun` — the foreground
`pnpm josh followup` and the CI wait included — in a process of its own (`background-commands.md` →
"Background the gate and push": foreground is *within the unit*, the background from the parent).
**So the parent never runs a carried-over child's `followup` itself**: it polls the handed-over lane and
opens new work beside it. **The reads and the dispatches go out together, in one turn** — `pnpm josh lane:list`,
`pnpm josh run:liveness`, `epic:next --lanes`, and opening a lane for a child it offers take none of each
other's results (the turn-batching rule this file states for a merge event, applied at the resume).
**Independence is the offer command's answer**: a new child `blocked-by` a carried-over Issue is
withheld, one that is not is dispatched into a free lane beside it. **A carried-over child that did not
survive the cut is re-dispatched, never adopted** — `pnpm josh lane:open <N>` then
`pnpm josh lane:dispatch <N>`, never picked up into the parent's own context.

### The counters live in the record

**The single source of the run's counters is the carry record (`pnpm josh run:carry`), and the epic
progress comment is generated from it** (joshuafolkken/kit#2024) — children run, Issues filed,
**consecutive failures**, and the time the run started. `pnpm josh run:merge` writes the merge into
the record and mirrors the counters onto the epic comment at every child's merge. **The
consecutive-failure count is the one that matters**, and a merge resets it. Rationale:
`docs/maintainers/backlogrun-progress-rationale.md` → "Why state lives in records, not the
conversation".

### What carries over, and where it lives

**Nothing is carried in the conversation.** Everything the next session needs it reads back:

| What the next session needs | Where it reads it |
| --- | --- |
| Which children remain, and which is runnable | `pnpm josh epic:next <E>` |
| The order and the dependencies | the epic body |
| What each remaining child is | the child Issue body |
| What already merged | the epic's task list, and the closed children |

**A resumed session is a new session**, so it asks `pnpm josh latest:scope` once before its first child.

## Waiting, and never waiting forever

| Setting | Value | Meaning |
| --- | --- | --- |
| Polling interval | 60 s | **A floor between two asks, never a clock the parent sets.** It bounds a re-ask made while the parent is *already awake*; what wakes it is "The parent keeps no clock of its own" below. |
| `backlogrun` idle-watch poll | 5 min | Not the interval above, and a floor in the same sense. |
| Silent delegated unit | 30 min | Not the child's duration — the time its output has gone **unchanged**. Past it, run the traces above and book a stopped unit as a failure. |
| Stale `in-progress` | 90 min | Past it, the other session is gone. |
| Publish wait | 10 min | `josh propagate`'s own budget. A failed publish never appears. |
| Whole run | 8 h | Past it, the run needs a person. |

Each timeout **ends the wait and reports** — none is retried indefinitely. Rationale for the figures:
`docs/maintainers/backlogrun-progress-rationale.md` → "Why the parent waits on classification, not a
clock". A stale child's label is
removed first, so the next poll can offer it. **A graph that has deadlocked on a cycle is not this loop's
to untangle**: `epic:next` detects it and exits with an error.

### The parent keeps no clock of its own — a child's completion or an arrival is the wake

**After hand-off, the supervisor's driver owns the mechanical clock.** `backlog:drive` polls lane
completion and the backlog inside the detached process, without waking an AI parent; the parent-turn
instructions below apply only to a returned judgment branch. `run:progress --wait` stays the heartbeat
source and `run:report` the final report.

**The numbers above are floors between asks, not a timer the parent sets.** Rationale:
`docs/maintainers/backlogrun-progress-rationale.md` → "Why the parent waits on classification, not a
clock".

The watcher reports on its own interval to the event stream and exits only on an arrival, so a judgment
session takes that exit — or a `lane:await` completion — as its prompt to act, never a report.

#### The wake exists only while something is in flight

`lane:await` wakes on a child's completion and `run:progress --wait` on an arrival; its reports wake
nobody. With no child in flight it may decline; the driver still polls for new work and enforces the
idle and whole-run bounds. A GitHub
listing failure stays a retry or unreadable answer from the offer command, never an empty backlog.

`epic:next` does not report when a label was applied, so read that from the issue's timeline:

```bash
gh api "repos/{owner}/{repo}/issues/<N>/timeline" \
  --jq '[.[] | select(.event == "labeled" and .label.name == "in-progress") | .created_at] | last'
```

An empty answer means the label predates what the timeline returns, which is itself past the window —
treat it as stale.

Waiting is decided by `epic:next`'s classification, never by reading labels:

| `epic:next` says | `backlogrun` does |
| --- | --- |
| Something is runnable | Run it |
| Nothing runnable, something resolves on its own | **Wait** |
| Nothing runnable, nothing resolves on its own, children remain | **Stop and report the parked children** |
| No open child | Post the epic summary and finish |

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
