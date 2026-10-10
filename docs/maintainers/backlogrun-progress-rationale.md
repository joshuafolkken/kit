# Rationale behind the `backlogrun` progress and hand-off procedure

This document is maintainer-only: it holds the reasons, measurements and history behind
`.claude/skills/workflow-commands/backlogrun-progress.md`, so that the procedure document can stay a
list of triggers, actions and answers. It is never read during a run — every rule it explains is stated
in full in the procedure document, and a change to a rule is made there first. The heartbeat's
rationale moved with its rules into `docs/maintainers/progress-watcher-rationale.md`
(joshuafolkken/kit#3172).

## Why a child's ending is read by `run:merge` alone

**Why the hand classification of `issue:state` was removed** (joshuafolkken/kit#3172). The procedure
used to have the parent read `pnpm josh issue:state <N>` and sort the answer itself — `CLOSED` merged,
open with `needs-decision` parked, open with `human_review: yes` stopped before its commit, anything
else failed. `pnpm josh run:merge` and `backlog:drive` compute exactly that from the same GitHub state
(plus the exit record that tells an outage from a failure), so the prose was a second copy of the
command's decision that could drift from it. The command is the single source; the procedure names it.

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

**Why `run:liveness` reads the process trace from the command line.** The child's command line holds no
path, so a probe on the lane's directory never matches a live child; it matches `fullrun #<N>` and the
detached ship instead (joshuafolkken/kit#3400). The trace is the deciding input, because a log that has
stopped moving is a session thinking rather than one that died.

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

## Where each rule came from

The procedure states these rules without their issue numbers; the provenance is kept here.

- `run:merge` is the only reading of how a child ended — joshuafolkken/kit#2024
- A `resumed` answer from `run:merge` is `lane:await`ed again — joshuafolkken/kit#2484
- The `run:wake` driver polls the handed-over lanes after a cut — joshuafolkken/kit#2492
- `--cut` answering `capped` (`MAX_CUTS`) carries the session on rather than handing off —
  joshuafolkken/kit#2346
- The `run:watcher:guard` enforces the background watcher in a resumed session —
  joshuafolkken/kit#2353
- A parent without a completion callback (Codex) dispatches the wave and ends the turn, with
  `run:step` printing the `--cut` — joshuafolkken/kit#2653
- The end-of-epic summary is generated by `run:report`, never composed by hand —
  joshuafolkken/kit#2249
