# `backlogrun` — progress, the hand-off, resume and waiting

**Read this file in full before the progress watcher starts** (`pnpm josh run:progress --wait`) and
before the hand-off check at a child's merge (`pnpm josh cost --cut`). It is a point-of-use
document, never an entry read: the entry procedure is `backlogrun.md`, which points here at those
steps (joshuafolkken/kit#2010). This file is the single source of the heartbeat, the session hand-off
and cut/resume, waiting without waiting forever, and the end-of-run summary and propagate.

## Progress while the run is quiet

**Start the progress step before step 1 of the loop, and do it without being asked.**

```bash
pnpm josh run:progress --wait --output <the transcript path of each delegated unit>   # in the background
```

**`--wait` waits one silence interval out, prints one line and exits — and the exit is what makes the
line arrive.** A harness that delivers a background command's output *when that command exits* — Claude
Code is one — relays nothing from a watcher that never exits; the long-running form (no `--wait`) is
right only where output is streamed. The parent changes no value on the line. **Every interval is three
moves and no fourth:**

1. Start `pnpm josh run:progress --wait --output <transcript paths>` **in the background**.
2. When it exits, **present what it printed as-is** — the command prints the five labelled lines and the
   next report time itself.
3. **In that same turn, start the next one.** The interval is measured from the last report.

**`pnpm josh run:watcher:guard` detects a missed restart** (joshuafolkken/kit#2113): it exits
non-zero when lane children are in-flight but the watcher's life record has not been refreshed
within the staleness threshold. Wire it as a PreToolUse hook or call it before step 1 of each
loop iteration.

**`run:progress` prints the five labelled lines itself now (joshuafolkken/kit#2026); present them
as-is.** It emits the observation instant (`at`, local first and UTC beside it), the elapsed figures
(`quiet` and `unchanged`), the children in flight, the run state (`lanes`, `load`, `record`), and the
scheduled `next`, each behind its own label and on its own line — so relay the output verbatim and
round, rephrase or re-label nothing. How each field reads when it has nothing to report (`record
unread`, `no in-progress child yet`, `lanes none`, an absent `next`) is fixed by the command's own unit
tests. **A value said that way is still an observation, never a state**: `record unread` means no
`--output` path was given, not *not stalled*; `lanes none` is *no lane is open*, not *nothing is
running*; and the `next` line is a schedule — the time *if the silence continues*, superseded when a
real report resets the clock through `--mark`.

**It exits only when it has a line to hand over**, or when `--hours` runs out having never gone quiet for
a whole interval (that exit says so on standard error). **Nothing in flight keeps it waiting**, or step
3 would make it a poll. **It starts by itself** — a run that has to be asked has not removed the polling.

**`--mark` at every real report.** Whenever this loop reports something of its own — a child merged,
parked, a stop — run `pnpm josh run:progress --mark` in the same turn to restart the silence clock, so a
heartbeat does not land immediately behind a real report. The clock is silence, never a timer
(`docs/josh-commands.md` → "`josh run:progress`").

**Do not keep a progress clock of your own, and the hook refuses an arm rather than asking you not to.**
A `Bash` call that only sleeps adds a second clock nobody reconciles, so the refusal is in front of the
**arm** — a report is prose no hook can see coming. `scripts/rules/early-heartbeat.ts` → `decide`
refuses a `Bash` call whose every segment is a `sleep` on three tests — a timer it already allowed is
still live, the report that timer would produce would land before the interval is up, or the wait runs
longer than the interval — so **a single correctly-spaced arm is allowed**. **The allowance is still not
the way to report**; the step above prints without arming anything, and `--wait` is not a wait timer.

**The default interval is twenty minutes, overridable — by the person, not the run.**
`JOSH_PROGRESS_INTERVAL_MINUTES` moves both sides (the guard reads it through the same reader the watcher
does); `josh` → `progress_interval_minutes` in `package.json` is read one step below the variable, so a
cadence set once holds on every machine and cloud session. **`--interval` moves the watcher alone** — a
hook has no command line — so it can only make the watcher quieter than the floor, never the guard
stricter. Twenty rather than ten because a child measures 20–46 minutes.

**An explicit ask is not a heartbeat, and it is exempt by construction** — what is refused is arming a
*timer*, and a person asking "how is it going" arrives with no timer in front of it.
**Every unscheduled progress statement is answered by `pnpm josh run:progress --once`** — presented in
the same five field lines, the reply to an explicit ask and the note just after a run starts alike.
**Never write a clock time the command did not print** (not an approximation, not a placeholder — where
a field is missing, say so). **`--once` records the report**, so no `--mark` beside it. **A live timer
is counted from the record the guard writes when it allows one**, never from the machine's `sleep`
processes.

**Every report opens with the time the observation was taken** — not only how long it has been quiet: an
absolute instant, `at YYYY-MM-DD HH:MM±HH:MM / YYYY-MM-DDTHH:MMZ`. A relative figure means something
only while the reports keep coming, and unattended execution is made of the events that break that — a
suspend, a rate limit, a restart. **The date is part of it**, and **the local clock leads with UTC
beside it and the offset that ties them** (the line is relayed to other machines and read in cloud
sessions). **It is added, never substituted for the elapsed figure**, and **the presented line needs no
stamp computed for it** — the command prints the `at` stamp and the `next` field.

**The line carries observations, never "still running", and nothing in it is a verification result** —
no gate, no CI, no check rollup, because the command reads none of them.

**The invariant is a tier, not a mechanism** (joshuafolkken/kit#2156). Three tiers say how much of a
person's attention a signal takes: **interrupt** reaches for it now (a Telegram — `confirmation`,
`completion`, `warning`), **ambient** is seen without being asked for (a line that is simply there), and
**requested** is read only once a person thinks to type for it. **The heartbeat sits at the ambient
tier, and stays there across a `backlogrun` session cut — never promoted to interrupt, never demoted to
requested.** Writing this as a *mechanism* ("a pull, not a push") is what let the ambient surface vanish
at the cut with the words still reading as kept: a pull is still a pull once the terminal it was seen on
is gone.

**Interrupt is withheld on purpose**: no Telegram, because `confirmation` and `completion` are what
interrupt a person, and a line every fifteen minutes on a phone is the fatigue that stops them being
read. **Ambient is realized differently either side of the cut, and both are the same tier.** Before the
cut the session is the person's, so the terminal is the ambient surface. After it the parent is a
headless `claude -p backlogrun` the `run:wake` supervisor started, so the watcher mirrors every line
into a plain-text log beside the report record — `pnpm josh run:progress --path` names it — and a person
keeps it open with `tail -F` to watch the run stream on without asking. The record still holds the last
line, which `pnpm josh run:wake --list` relays and names the ambient log beside; that relay is the
requested tier, the floor the ambient surface is not allowed to fall to, which is why `--mark` keeps
rather than blanks the line.

**A stop is an interrupt, and only a stop** (joshuafolkken/kit#2136). The heartbeat says a run is still
going; a run that has _stopped_ — every remaining child blocked behind a parked one, the backlog drained
of anything runnable, the failure streak tripped — is the event the ambient tier was hiding, because
after a cut "quiet" and "stopped" look identical until a person reads for it. So the terminal stop is
pushed to the interrupt tier: `pnpm josh run:carry --end --stopped "<reason>"` sends one ⏸️ confirmation
as it ends the record, and because the record is gone by the second `--end` the same stop never notifies
twice. A parked child is pushed by the child itself, which records the park and sends its own
`confirmation` before it stops (`backlogrun-park.md`). **Nothing new carries either one** — both ride the
existing notification types and the record the watcher already keeps.

**A heartbeat is emitted from the moment a run has started, even before any child carries
`in-progress`** — "a run has started" is read from a mechanical record (a registered lane, a held work
tree, or a carried budget), and the line names that stage as an observed fact (`no in-progress child
yet`). **Only a checkout with no run recorded at all stays silent**, which keeps an ordinary
conversational session outside the heartbeat.

**The scope is every implementing run, not this command alone.** `fullrun`, `halfrun` and `backlogrun`
start the same watcher under the same rules, and this section is the single source for all four; `kickoff`
starts none. **`halfrun` is included** because the trigger is silence rather than command identity — it
still implements, runs the whole gate, both review rounds and `pnpm josh test:e2e`, most of the 20–46
minutes.

**One watcher per run, and the outermost invocation is the one that starts it.** A `fullrun` running as
a `backlogrun` named issue or an `backlogrun` child starts none: the brief names the invocation it descends
from. `backlogrun` starts one for the whole batch. **A dispatched lane child is refused a watcher by its
`JOSH_LANE_CHILD` mark** — it still runs `--mark` for the parent's clock, but every reporting form
(`--wait`, `--once`, the default watch) exits at once with a notice, so a child that misreads the prose
is harmless.

**In a single-issue run it starts immediately after `pnpm josh run:hold` succeeds** — the hold is itself
the record that says the run has started. **It is started in the target repository's checkout, and
`--mark` is run there too** — a cross-repository run is implemented in that repository's checkout, and a
watcher started in the session's own tree would read the wrong `in-progress` listing.

**What counts as a real report when the run has one issue.** A `fullrun` has exactly one child, so the
unit is **any turn that puts a progress statement in front of the person** — four of them, `--mark` run
in the same turn as each: **the Step 0 work summary, the pull request opening, each review round's
verdict, and any `confirmation` / `failure` / `completion` notification or stop.** **A tool result only
you read is not one** — a gate run, a `gh` read, an edit — and marking on those would hide the silence
the interval measures.

**On a quiet tick the turn is the relayed line plus at most two lines of the run's own prose**, saying
only what changed stage and what is being waited on. **A tick is quiet when none of the real reports
happened since the last one**; a gate that went green, a review round, a file edited, a poll answering
`wait` are the run working, not a report. **No table, no re-listing of children, no restating of the
plan** — `epic:next`, the epic body and the progress comment hold all three. **A real report is not
bounded by that**: `--mark` restarts the clock, so a merge, a park or a stop is where the run may be
long.

**`--output` is omitted in a single-issue run, and `record` reads `unread`** — there is no delegated
unit to name (a batch's unit changes every issue), so a fixed path would age a finished unit's file;
`unread` is the command's defined answer for "no path was given".

**A run that merges needs no teardown; a run that stops has to end the reporting itself.** The issue
leaves the `in-progress` listing at the merge, so whatever is waiting prints nothing and `--hours` ends
it. **A stop keeps that label on purpose** — so **no further `--wait` is started** after the stop
notification, and any long-running watcher still in the background is stopped in the same turn. That
covers `halfrun`'s stop before commit, a `needs-human-review` stop, a split or prerequisite stop, and
a `backlogrun` named issue's failure stop.

### Running a named epic's children

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

**`--lanes` is the form to use.** A lane's branch is `<N>-lane`, which `pnpm josh git` commits from, so
a child handed a lane runs the whole `fullrun` procedure inside it. Read a line per child, and treat a
single non-numeric line as the verdict.

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
   lane — and in the same turn start `pnpm josh lane:await <N...>` in the background** (joshuafolkken/kit#2113).
   `lane:await` watches local process presence and exits when any named child confirms-complete,
   waking the parent at the actual completion rather than at the next heartbeat interval. **The
   re-confirm delay and poll interval are the command's, not the agent's** — pass only the issue
   numbers. On that wake ask `pnpm josh run:liveness <N> --output <path> --process <what
   `pgrep -laf "fullrun #<N>$"` found>` where that file has been unchanged for the silent-unit
   window. **The flag is what you saw, never what kind of child it is.**

   When the unit reports back, **confirm the child from GitHub before believing it**:

   ```bash
   pnpm josh issue:state <N>                          # a child in this repository
   pnpm josh issue:state <N> --repo <owner/repo>      # a child in another one
   # state: CLOSED
   # labels: (none)
   # human_review: no
   ```

   **`--repo` is not optional for a cross-repository child.** Without it the read resolves `<N>` against
   the repository this session runs in.

   `state: CLOSED` is the only answer that means the child finished. **Read the `human_review:` and
   `labels:` lines before calling anything else a failure** — three outcomes look alike from here, which
   is why one command prints all of them. **A non-zero exit is not `OPEN`**: the command exits non-zero
   without a state when the number resolves to nothing (`does not resolve`) or the read failed (`could
   not read`, a rate limit or expired auth). Re-read before deciding.

   - **Open, carrying `needs-decision`** — the unit **parked** it. Not a failure: leave the label on, do
     **not** count it against the consecutive-failure guard, and go back to step 1.
   - **Open, and `human_review: yes`** — the child **stopped before its commit**, the run's own ending
     (§2z). **`Open` is part of the test** — a CLOSED child carrying the label finished and merged.
     **Read that line, not the `labels:` one**: GitHub keeps the spelling a label was created with, so
     matching the lowercase string by eye drops the child into the failure branch below. Leave
     `in-progress` **on**, do not park it, do not count it, and do **not** go back to step 1. Finish the
     session and report. **Do not send a second `confirmation` Telegram** — the unit already sent one.
     Where the child ran in this session's own context, that first notification is yours to send.
   - **Open, without `needs-decision`** — it failed. Remove the stale `in-progress` here (Tier A), count
     it against the consecutive-failure guard, and **park it**. Parking is what stops the next
     `epic:next` from handing the same child straight back.

   **Never ask `epic:next` in place of this read.** A child that did not finish still carries
   `in-progress`, which `epic:next` classifies as waiting on time — the loop would poll to the 90-minute
   stale window and learn nothing.

   **A merge is one event, and one call of the parent's — `pnpm josh run:merge <N>`**
   (joshuafolkken/kit#2024). What was a reading turn and an acting turn is one composite command: it
   confirms the child from GitHub, does the post-merge steps, folds in the hand-off check, and prints
   the next child number — or a control verdict — for the parent to read. Pass the merged child's
   number and the offer's source — `--epic <E> --repo <owner/repo>` for a named epic,
   nothing for the opted-in backlog — with `--owner "$PPID"` so it counts into the carry record under
   the ownership guard.

   ```bash
   next=$(pnpm josh run:merge <N> --epic <E> --repo <owner/repo> --owner "$PPID")
   # a child number (or several, one per free lane) to run next, or a verdict token
   ```

   **What the one call does is decided by what the child turned out to be** — read from its GitHub state,
   never from a log: a **merged** child (CLOSED) is counted into the carry record (which resets the
   failure streak), then `pnpm josh ms`, `pnpm josh lane:close <N>`, and the counters mirrored onto the
   epic comment; a **parked** child (OPEN, `needs-decision` or `already-done`) is left alone and not
   counted; a **failed** child (OPEN, neither label) has its stale `in-progress` dropped, is parked with
   `needs-decision`, and is counted against the consecutive-failure guard. **A turn whose whole content
   is one read, or one two-line progress report, is the shape this collapses.**

   **Beyond the offer `epic:next` prints** (`run` becomes numbers; `wait` / `stop` / `complete` /
   `error` pass through), the composite adds four verdict tokens: `over` — the merge crossed the budget,
   so hand the lanes over and take the cut ("The hand-off" below); `human-review` — the child stopped
   before its commit, the run's own ending (SKILL.md → §2z), so stop; `stop` — the consecutive-failure
   guard tripped; and `retry` — the child's state could not be read, so re-read before deciding.

   **The counters are the carry record's, and the epic progress comment is generated from it** (see "The
   counters live in the record" below). **The hand-off check is folded into the merge branch of the one
   call** — `pnpm josh cost --cut`, run after `pnpm josh ms`; `under` offers the next child,
   `over` prints `over` so the parent hands its lanes over and takes the cut ("The hand-off" below), and
   a session that cannot measure is read as `over`. **Never read the condition off `pnpm josh delegate
   epic-child`** — a static policy lookup that answers `delegate` everywhere, so a gate built on it never
   fires.
3. **`wait`** — go back to step 1. **With something of this run's own in flight, that happens on the
   wake the progress watcher's exit delivers** and the parent starts no sleep of its own; the 60 s
   figure bounds how soon the ask may be repeated. **With nothing in flight the watcher declines and
   never exits, so the parent keeps the interval** — the case for "another repository has work but this
   one does not", and for a cross-repository publish wait. The table in "The wake exists only while
   something is in flight" below decides which.
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

**A session pays for every child it has already run, on every later turn**, because every turn re-reads
the accumulated preamble. **So the run reads the marginal cost off a line rather than feeling for it** —
at **every** child's merge, and crossing it **hands the session off to a fresh one, carrying the budget
with it** (`backlogrun.md` → "The session cut is inside the invocation"). The cut is where a `backlogrun` spans several
sessions; it is not a stop.

```bash
pnpm josh cost --cut
```

It prints `over` or `under` on standard output and the measured figure on standard error. `over` means
the next turn of this session costs more than the threshold in billed input, and the number is passed
explicitly so a run cannot drift it by remembering it wrong.

**200,000 is shared by the scheduler entry, scheduler hand-off and lane worker implementation cut.**
The value is `CONTEXT_CUT_THRESHOLD` in `scripts/cost-runtime/context-cut-threshold.ts`; `cost --cut`,
`run:merge` and `run_cut.IMPLEMENTATION_CONTEXT_THRESHOLD` all read it rather than carrying separate
numbers. The 150,000 output ceiling and the 150,000 entry-read character figure are separate systems.

### The check is asked at every merge, and delegation does not excuse it

**A delegating parent reaches the threshold too**, because most of its billed input is conversation
history rather than resident preamble, and the cost is not linear — n requests bill about n²/2, so a
condition that delays the first cut multiplies a cost rather than deferring it. **So there is no
condition: `pnpm josh cost --cut` is asked after every child's merge**, delegated or not.
**Never wire the question to `pnpm josh delegate epic-child`** — a static policy lookup answering
`delegate` on every machine forever, so a gate built on it never fires.

`over` and `under` are not the only answers: the command **exits 1 with empty standard output** when
there is no transcript, or no request in it. **Neither is `under`.** Reading "could not measure" as
"still cheap" is the same mistake as reading an unreadable comment listing as "no findings" — report that
the check could not answer, and take `over`'s branch at that child.

### When to ask, and what to do

**Ask once per child, immediately after its merge and `pnpm josh ms`** — never mid-child. That is the
only moment where **this** child's work is all written down: the PR is merged, the working tree is clean
on the default branch, and the epic's state on GitHub is complete.

### The lane child reuses this measurement mid-implementation

**The same `pnpm josh cost --over` measurement bounds a lane child's context _during_ implementation, not
only the parent's between children** — the pre-gate cut fires only once implementation is done, so it
never caps the thinking a child accumulates while implementing. The child measures its own per-request
context with **this command** at the shared `CONTEXT_CUT_THRESHOLD`, 200_000, and cuts with
`pnpm josh run:cut --impl <N>`. **The measurement and threshold are single-sourced**:
`cost_verdict.per_request_cost` is what both seams compare, and `cost --cut` selects the same constant
for the parent and child. The boundary and the resume are `pre-gate-cut.md` → "The
implementation-phase cut", its single source.

**A merge is not by itself a safe seam, because another lane may still be running.** The reference to
where each unit writes lives in the lane, so a session that never dispatched the child can poll it and
the pool is handed over instead of drained. **Read the lanes rather than judging them:**

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
`pgrep -laf "fullrun #<N>$"` first and pass `alive` where it found the child and `none` where it did not
— **never `alive` because the child was dispatched.** The child's command line holds no path, so a
`pgrep` on the lane's directory never matches a live child; the trace is the deciding input, because a
log that has stopped moving is a session thinking rather than one that died.

**The `&&` is load-bearing.** A lane that records nothing prints `none` and exits non-zero; substituted
straight into `--output`, that `none` is a relative path and `run:liveness` answers `undetermined` for
ever.

- **`under`** — go back to step 1 of the loop and run the next child.
- **`over`** — **the run hands its lanes over and takes the cut at once.** Open no new lane and take no
  new child. Confirm every lane still in flight records an output path — one missing is filled in with
  `pnpm josh lane:output <N> <path>` — then take one of the next two bullets in the same turn. **There
  is no waiting here at all**: nothing has to finish, because nothing is being abandoned. The child is
  an operating-system process of its own (`pnpm josh lane:dispatch`), so the lanes keep running.
- **A lane nobody could poll** — `unreadable`, or `open` with no recorded path and none that can be
  supplied — **and the cut does not happen.** Name that lane in the progress comment and go back to
  step 1 of the loop; the reading is asked again at the next merge.
- **Every in-flight lane records a path** — **record the cut and hand the session off.** `backlogrun`
  declares a budget — `--max`, `--idle` and the 8-hour bound — so the cut is an execution detail of
  spending it, not a stop: count everything the session has, then run
  `pnpm josh run:carry --cut --owner "$PPID"`, and `pnpm josh run:wake` starts the next session from
  outside the conversation with nobody retyping the keyword. The lanes keep running and the resumed
  session polls them from `lane:list`. Post the progress comment naming **every lane still in flight and
  the path each one records** so the resumed session can find them. `backlogrun.md` → "The session cut is inside the
  invocation" is the single source of the carry; this reading is only where the cut is *taken*.

**The hand-over is what makes the cut reachable, and the drain it replaced cost the pool.** `epic:next
--lanes` keeps the seats full, so a cut gated on an idle pool that merely happened would read `over` at
every merge and cut at none of them. Recording the path removes that cost without giving the moment back
up: the cut is taken at the reading itself, the lanes keep running, and the next session picks them up
from `lane:list`.

**A lane is handed over only where the next session can actually poll it, and that is read rather than
assumed.** A lane whose state is `open` **and** whose recorded path is not `-` is handed over. A
**`stranded`** lane has no work tree and so no running child — `pnpm josh lane:prune` closes it. An
**`unreadable`** one cannot be told apart from a running child, and an `open` lane recording **no path**
is the same case: in both, **the cut does not happen**, the lane is named in the epic progress comment,
and the run goes back to step 1. **Never assume idle** — a wrong cut abandons a child, a missed cut only
costs tokens.

**The hand-off report belongs to the stop, not to the reading.** For the one reading that does not stop —
an `unreadable` lane, or an `open` one recording no path — the run goes back to step 1 and writes no
hand-off report; the epic progress comment is the record. `report-format.md` → "区切りの報告" states the
same boundary from the format's side.

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

### A carried-over merge does not stand in front of the next lane

**A carried-over child finishes in its own detached unit, and the resumed parent does not stand in front
of its merge.** A lane handed over at the cut is still running its own `fullrun` — the foreground
`pnpm josh followup` and the CI wait included — in a process of its own (background-commands.md →
"`pnpm josh followup` — foreground": foreground is *within the unit*, the background from the parent).
**So the parent never runs a carried-over child's `followup` itself**: it polls the handed-over lane and
opens new work beside it, rather than finishing carried-over merges one after another before a single
new lane opens. **The reads and the dispatches go out together, in one turn** — `pnpm josh lane:list`,
`pnpm josh run:liveness`, `epic:next --lanes`, and opening a lane for a child it offers take none of each
other's results (the turn-batching rule this file states for a merge event, applied at the resume).
**Independence is the offer command's answer**: a new child `blocked-by` a carried-over Issue is
withheld, one that is not is dispatched into a free lane beside it. **A carried-over child that did not
survive the cut is re-dispatched, never adopted** — `pnpm josh lane:open <N>` then
`pnpm josh lane:dispatch <N>`, never picked up into the parent's own context.

### The counters live in the record

**The single source of the run's counters is the carry record (`pnpm josh run:carry`), and the epic
progress comment is generated from it** (joshuafolkken/kit#2024) — children run, Issues filed,
**consecutive failures**, and the time the run started, held in one place rather than counted twice.
`pnpm josh run:merge` writes the merge into the record and mirrors the counters onto the epic comment at
every child's merge, so the human-readable comment and the guard the run reads can never disagree. **The
consecutive-failure count is the one that matters** — it is what the stopped-unit section leans on to
notice the environment is at fault, and a merge resets it; lost, a run keeps feeding children into a
broken environment and never reaches three. **The record survives a session cut and a compaction
alike** — that is what it is for — so the counters a run's own guards rest on are never taken by the
moment the context is dropped. **This is not what "Nothing is carried in the conversation" denies**:
that is about the state a *next session* needs, all of it on GitHub, while the record is about *this*
run's own guards.

### What carries over, and where it lives

**Nothing is carried in the conversation.** Everything the next session needs it reads back:

| What the next session needs | Where it reads it |
| --- | --- |
| Which children remain, and which is runnable | `pnpm josh epic:next <E>` |
| The order and the dependencies | the epic body |
| What each remaining child is | the child Issue body |
| What already merged | the epic's task list, and the closed children |

That is the same state a resumed run has always used, which is why the hand-off needs no new mechanism.
**A planned hand-off is strictly more certain than an interruption**: an interruption can land mid-child
with a dirty tree and a stale `in-progress` label, and this cannot, because it is only taken when a child
has just closed.

**A resumed session is a new session**, so it asks `pnpm josh latest:scope` once before its first child.

## Waiting, and never waiting forever

| Setting | Value | Why |
| --- | --- | --- |
| Polling interval | 60 s | **A floor between two asks, never a clock the parent sets.** It bounds a re-ask made while the parent is *already awake*; what wakes it is "The parent keeps no clock of its own" below. |
| `backlogrun` idle-watch poll | 5 min | Not the interval above, and a floor in the same sense. What a watch waits on happens on human timescales, and every ask bills the parent session's whole history. |
| Silent delegated unit | 30 min | Not the child's duration — the time its output has gone **unchanged**. A working unit rewrites its transcript continuously. Past it, run the traces above and book a stopped unit as a failure. |
| Stale `in-progress` | 90 min | Longer than any single child has taken; past it, the other session is gone. |
| Publish wait | 10 min | `josh propagate`'s own budget. A failed publish never appears. |
| Whole run | 8 h | An unattended run that has not finished overnight needs a person, not more waiting. |

Each timeout **ends the wait and reports** — none is retried indefinitely. A stale child's label is
removed first, so the next poll can offer it. **A graph that has deadlocked on a cycle is not this loop's
to untangle**: `epic:next` detects it and exits with an error.

### The parent keeps no clock of its own — the watcher's exit is the wake

**The numbers above are floors between asks, not a timer the parent sets.** A parent that sets one spends
a turn per tick at the point its context is largest — the exact cost `run:progress` was built to remove.
The watcher took the *reporting* out of the parent; the parent must not go on keeping the clock anyway,
or the two run side by side and the run pays for both.

**The two are separated by arithmetic, not by inspection.** At the default twenty-minute interval the
watcher can exit no more often than once an interval, so any parent call more frequent than that is a
turn the parent woke itself for. That needs no second reading of the transcript — which matters, because
the transcript parsing is what run measurement must avoid, and the re-measurement belongs to
`pnpm josh cost` and the run-timing report.

**So the parent starts no wait of its own.** While something of this run's own is in flight, the next
turn is the one the **watcher's exit delivers** — a background command's completion is what re-invokes
the session (`background-commands.md`). **A `Bash` call that only sleeps is the spelling this forbids**,
and so is a turn whose whole content is asking `epic:next` again to see whether anything has changed.

**The wake is used for both halves at once.** The turn that relays the line is the turn that acts on what
the line says: a free lane is the ask for the next child, and every lane still busy is not an ask at all.

**The cost is latency, and it is named rather than hidden.** A lane that frees just after a line can sit
idle until the next one — **up to one interval**. **A person who wants the latency back shortens the
interval** — `--interval`, or `progress_interval_minutes` in the repository's configuration.

**What is not dropped.** Every timeout in the table above still ends its wait, and the silent-unit
liveness check is still asked — on the wake the watcher delivers rather than on a clock of the parent's
own.

#### The wake exists only while something is in flight

**`--wait` ends at the first line it *prints*, and it prints only where there is something to report.**
With no child in flight it **declines**, and a `gh` listing it could not read declines the same way. **A
declined watcher does not exit until its `--hours` bound, an hour by default.** So the wake above is not
available in every state, and where it is unavailable **the parent keeps the interval after all**:

| The parent is waiting on | What wakes it |
| --- | --- |
| A child of this run's, in flight | **The watcher's exit.** Start no wait of your own |
| A blocker that resolves elsewhere with nothing of this run's in flight — a cross-repository publish, another repository's work | **The polling interval, kept by the parent.** The watcher declines and will not exit |
| GitHub not answering (`retry`) | **The polling interval, kept by the parent.** The outage that produced `retry` stops the watcher reading too, so it declines |
| An empty backlog during `backlogrun`'s idle watch | **The 5-minute idle poll, kept by the parent.** Nothing carries `in-progress`, so the watcher declines for the whole watch |

**This boundary is a table because reading the rule past it is expensive and silent.** A `backlogrun`
idle watch has a 30-minute budget, and a parent waiting for a wake that cannot arrive before the
watcher's one-hour bound would end that watch having polled the backlog **zero** times. The saving comes
from the in-flight row, which is where a run spends nearly all of its waiting.

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

The distinction is not academic. When kit's child has closed and app-kit's child is waiting for the
release to publish, there is no runnable child, nothing carries `in-progress` and nothing carries
`needs-decision` — a label-based reading calls that "done" and stops, in the one moment it must wait.

## Who sends the summary, and who propagates

With several sessions on one epic, **exactly one does the end-of-epic work: the session standing in the
repository that owns the epic.** It sends the epic completion summary and runs `josh propagate` — which
itself refuses to run outside the supplier repository. Every other session finishes quietly when its own
repository has no children left.

Per-child completion notifications are unchanged: `pnpm josh followup` sends one each. Send an epic
**start** notification when the run begins, and an epic **completion** summary at the end naming what was
merged, what was parked and why, and what was filed.

**That same session asks `pnpm josh release:scope` once, after the last child has merged** — in the
primary checkout, after the last lane is closed, and never once per child. `followup-reference.md` →
"When `pnpm josh release` runs" is the single source for the position and the three answers. On
`required` the epic completion summary closes with the request and the exact command; on `unknown` it
says `unknown`, never `skip`.
