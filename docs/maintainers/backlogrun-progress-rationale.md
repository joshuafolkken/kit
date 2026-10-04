# Rationale behind the `backlogrun` progress and hand-off procedure

This document is maintainer-only: it holds the reasons, measurements and history behind
`.claude/skills/workflow-commands/backlogrun-progress.md`, so that the procedure document can stay a
list of triggers, actions and answers. It is never read during a run — every rule it explains is stated
in full in the procedure document, and a change to a rule is made there first.

## Why the heartbeat reads as it does

**Why `--wait` no longer exits on a report** (joshuafolkken/kit#3102). It used to print one line and
exit, because a harness that delivers a background command's output _when that command exits_ — Claude
Code is one — relays nothing from a watcher that never exits. But every such exit woke the parent for a
turn that asked it for no judgement: relay the line, start the next one. The report's reader is the
event stream and the ambient log, never the parent's turn, so the watcher writes there and keeps
running; it exits only where the parent has something to decide — an arrival — or nothing left to do.
The eight-hour bound for `--wait` is `run:hold`'s expiry, so it bounds a run rather than adding a wake
an hour.

**Why a sleep-only `Bash` call is refused.** A call that only sleeps adds a second clock nobody
reconciles with the watcher's, which is why `scripts/rules/early-heartbeat.ts` → `decide` refuses it on
its three tests: `scripts/rules/early-heartbeat.ts` → `decide` refuses a sleep-only `Bash` call when a
timer it already allowed is still live, when the report it would produce would land before the interval
is up, or when the wait runs longer than the interval — so a single correctly-spaced arm is allowed. A
live timer is counted from the record the guard writes when it allows one, never from the machine's
`sleep` processes.

**Why nothing in flight keeps the watcher waiting.** Otherwise each exit, and the restart the parent owes
it in the same turn, would make it a poll.

**Why `--mark` at every real report.** Restarting the silence clock keeps a heartbeat from landing
immediately behind a real report.

**Why the default interval is twenty minutes.** Twenty rather than ten, because a child measures 20–46
minutes. The `package.json` setting exists so a cadence set once holds on every machine and cloud
session; `--interval` moves the watcher alone because a hook has no command line.

**Why an explicit ask is exempt.** What the hook refuses is arming a _timer_, and a person asking "how is
it going" arrives with no timer in front of it.

**Why a checkout with no run stays silent.** It keeps an ordinary conversational session outside the
heartbeat.

**Why every report carries an absolute instant.** A relative figure means something only while the
reports keep coming, and unattended execution is made of the events that break that — a suspend, a rate
limit, a restart. The date is part of it, and the local clock leads with UTC beside it and the offset
that ties them, because the line is relayed to other machines and read in cloud sessions.

## Why the signal tiers are split this way

**Why no session relays the event stream.** A relaying session re-read its whole history per event, so
the reader became a script in a pane of the person's own (#2492).

**Why the heartbeat never reaches the interrupt tier.** `confirmation` and `completion` are what
interrupt a person, and a line every fifteen minutes is the fatigue that stops them being read.

**Why a stop is pushed to the interrupt tier.** The heartbeat says a run is still going; a run that has
_stopped_ is the event the ambient tier was hiding, because after a cut "quiet" and "stopped" look
identical until a person reads for it (joshuafolkken/kit#2136).

**Why the event stream is keyed to the run.** It survives the cut because it is the run's and not any
one session's.

**Why a stop and a park need no new mechanism.** Nothing new carries either one — both ride the
existing notification types and the record the watcher already keeps.

## Why the watcher runs where it does

**Why `halfrun` starts a watcher.** The trigger is silence rather than command identity — `halfrun`
still implements, runs the whole gate, both review rounds and `pnpm josh test:e2e`, most of the 20–46
minutes.

**Why a lane child's reporting forms exit at once.** The `JOSH_LANE_CHILD` mark makes a child that
misreads the prose harmless: it cannot start a second watcher beside the parent's.

**Why a single-issue run starts it right after `run:hold`.** The hold is itself the record that says
the run has started.

**Why the watcher starts in the target repository's checkout.** A cross-repository run is implemented
in that repository's checkout, and a watcher started in the session's own tree would read the wrong
`in-progress` listing.

**Why a tool result only you read is not a real report.** Marking on a gate run, a `gh` read or an edit
would hide the silence the interval measures.

**Why `--output` is omitted in a single-issue run.** There is no delegated unit to name (a batch's unit
changes every issue), so a fixed path would age a finished unit's file; `unread` is the command's
defined answer for "no path was given".

**Why a run that merges needs no teardown.** The issue leaves the `in-progress` listing at the merge, so
whatever is waiting prints nothing and `--hours` ends it. A stop keeps that label, which is why a stop
has to end the reporting itself.

## Why a named epic's children run in lanes

**Why `--lanes` is the form to use.** A lane's branch is `<N>-lane`, which `pnpm josh git` commits from,
so a child handed a lane runs the whole `fullrun` procedure inside it.

## Why a child's ending is classified at once

**Why a `lane:await` wake skips the silent-unit window** (joshuafolkken/kit#2277). `lane:await` exits
only after the child's process has disappeared and stayed gone across its re-confirm delay, which is the
definitive end signal. A child that died reaching the API wrote its last line — an `API Error` — just
before it went, so a `run:liveness` poll would read that fresh output as `alive` and sit for the whole
30-minute silent-unit window before it ever said `stopped` (the measured 402- and 52-minute waits).
`lane:await` itself exists so the parent wakes at the actual completion rather than at the next
heartbeat interval (joshuafolkken/kit#2113).

**Why `issue:state` prints state, labels and `human_review` together.** Three outcomes — parked,
stopped before commit, failed — look alike from the parent, so one command prints all of them. The
`human_review:` line is read rather than `labels:` because GitHub keeps the spelling a label was created
with, so matching the lowercase string by eye drops the child into the failure branch. A failed child is
parked because parking is what stops the next `epic:next` from handing the same child straight back.

**Why `epic:next` is never asked in place of the GitHub read.** A child that did not finish still
carries `in-progress`, which `epic:next` classifies as waiting on time — the loop would poll to the
90-minute stale window and learn nothing.

**Why a merge is one composite call** (joshuafolkken/kit#2024). What was a reading turn and an acting
turn became one command; a turn whose whole content is one read, or one two-line progress report, is the
shape this collapses.

## Why the hand-off check is asked at every merge

**Why the cost is read off a line.** A session pays for every child it has already run, on every later
turn, because every turn re-reads the accumulated preamble. The threshold is passed explicitly so a run
cannot drift it by remembering it wrong.

**Why delegation does not excuse the check.** Most of a delegating parent's billed input is conversation
history rather than resident preamble, and the cost is not linear — n requests bill about n²/2, so a
condition that delays the first cut multiplies a cost rather than deferring it. `pnpm josh delegate
epic-child` is a static policy lookup answering `delegate` on every machine forever, so a gate built on
it never fires.

**Why an unmeasurable session is read as `over`.** Reading "could not measure" as "still cheap" is the
same mistake as reading an unreadable comment listing as "no findings".

**Why the check is asked immediately after the merge.** That is the only moment where the child's work
is all written down: the PR is merged, the working tree is clean on the default branch, and the epic's
state on GitHub is complete.

**Why a lane child reuses the measurement mid-implementation.** The pre-gate cut fires only once
implementation is done, so it never caps the thinking a child accumulates while implementing.

## Why lanes are handed over rather than drained

**Why the hand-over replaced the drain.** `epic:next --lanes` keeps the seats full, so a cut gated on an
idle pool that merely happened would read `over` at every merge and cut at none; the drain it replaced
cost the pool. Recording each lane's output path removes that cost, and is what makes the cut reachable:
the reference to where each unit writes lives in the lane, so a session that never dispatched the child
can poll it.

**Why `over` waits for nothing.** Nothing has to finish, because nothing is being abandoned: each child
is an operating-system process of its own (`pnpm josh lane:dispatch`).

**Why `capped` never wakes or hands off.** A wake over an un-handed-off record recovers as a crashed
owner into a fresh cold session — the churn the `MAX_CUTS` cap prevents (joshuafolkken/kit#2346).

**Why never assume idle.** A wrong cut abandons a child; a missed cut only costs tokens.

**Why the resumed session restarts the watcher by name.** The cut session's watcher exited with it.

**Why `--process` comes from `pgrep` on the command line.** The child's command line holds no path, so a
`pgrep` on the lane's directory never matches a live child; the trace is the deciding input, because a
log that has stopped moving is a session thinking rather than one that died.

**Why the resumed parent does not finish carried-over merges first.** Each carried-over child runs its
own foreground `followup` in its own process, so finishing them one after another before a single new
lane opens would idle every free lane for no gain.

## Why state lives in records, not the conversation

**Why the counters are the carry record's.** Held in one place rather than counted twice, the
human-readable epic comment and the guard the run reads can never disagree. The consecutive-failure count
matters most: the stopped-unit section leans on it to notice the environment is at fault, and lost, a
run keeps feeding children into a broken environment and never reaches three. The
record survives a session cut and a compaction alike, so the counters the run's guards rest on are never
taken by the moment the context is dropped. This does not contradict "Nothing is carried in the
conversation": that is about the state a _next session_ needs, all of it on GitHub, while the record is
about _this_ run's own guards.

**Why the hand-off needs no new mechanism.** What the next session reads back is the same state a
resumed run has always used. A planned hand-off is strictly more certain than an interruption: an
interruption can land mid-child with a dirty tree and a stale `in-progress` label, and a hand-off cannot,
because it is only taken when a child has just closed.

**Why the completion summary comes from `run:report`.** Passing its output to `pnpm josh notify
--body-file` makes the summary a session shows and the message off-screen one text from one generator.
It renders by reusing `format_event`, the stream's own event formatter.

## Why the parent waits on classification, not a clock

**Why the parent sets no timer.** One tick per turn, at the largest context, is the cost `run:progress`
removed; the waiting numbers are floors between asks.

**Why the driver's own waits cost nothing.** The driver checks lane completion every five seconds and
makes a new backlog offer no sooner than one minute after the previous offer, except after collecting a
child — waits that cost no AI turns.

**Why the stale window is 90 minutes.** It is longer than any single child has taken.

**Why the whole run is bounded at 8 hours.** An unattended run that has not finished overnight needs a
person, not more waiting.

**Why the idle-watch poll is five minutes.** What a watch waits on happens on human timescales, and every
ask bills the parent session's whole history.

**Why a silent unit is measured by unchanged output.** A working unit rewrites its transcript
continuously, so unchanged output — not the child's duration — is the signal.

**Why waiting is decided by `epic:next`, never by labels.** When kit's child has closed and app-kit's
child is waiting for the release to publish, there is no runnable child, nothing carries `in-progress`
and nothing carries `needs-decision` — a label-based reading calls that "done" and stops, in the one
moment it must wait.
