# Rationale behind the progress watcher

This document is maintainer-only: it holds the reasons, measurements and history behind
`.claude/skills/workflow-commands/progress-watcher.md`, so that the procedure document can stay a list
of triggers, actions and answers. It is never read during a run — every rule it explains is stated in
full in the procedure document, and a change to a rule is made there first. Both moved out of the
`backlogrun` progress documents in joshuafolkken/kit#3172, because the heartbeat binds every
implementing run, not the batch alone.

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
that ties them, because the line is relayed to other machines and read in cloud sessions. It is added
beside the elapsed figure, never substituted for it, and the command prints both the `at` stamp and
the `next` field, so the presented line needs no stamp computed for it.

**Why the five fields sit behind their own labels** (joshuafolkken/kit#2026). `run:progress` writes the
observation instant (`at`), the elapsed figures (`quiet`, `unchanged`), the children in flight, the run
state (`lanes`, `load`, `record`) and the scheduled `next`, each on its own line, so a session that
presents them has nothing to round or re-label. How each field reads when it has nothing to report —
`record unread`, `no in-progress child yet`, `lanes none`, an absent `next` — is fixed by the command's
unit tests. Each is still an observation: `record unread` means no `--output` path was given, not _not
stalled_; `lanes none` is _no lane is open_, not _nothing is running_; and `next` is the time _if the
silence continues_, superseded when a real report resets the clock through `--mark`.

**Why the line carries no verification result.** The command reads no gate, CI or check rollup, so
anything of that kind in the line would be a claim nobody observed.

## Why the signal tiers are split this way

**The invariant is a tier, not a mechanism** (joshuafolkken/kit#2156, joshuafolkken/kit#2207). Three
tiers say how much of a person's attention a signal takes: **interrupt** reaches for it now (a
Telegram), **ambient** is seen without being asked for, and **requested** is read only when a person
types for it. The heartbeat sits at the ambient tier and stays there across a `backlogrun` session cut —
never promoted to interrupt, never demoted to requested.

**Why the report surface belongs to the run, not to the session** (joshuafolkken/kit#2207). The run's
session-facing events — a plan posted, a child launched, a PR opened, a review round, a park, a cut, a
stop, a merge — are appended to one ordered stream keyed to the run's identity (`pnpm josh run:event`).
Every session is a writer; the reader is the same before and after a cut, because a cut moves who
executes, never where the stream lives. `pnpm josh run:wake --list` is the requested tier — the
last-event read of the same stream — and `tail -F` on the raw stream file is a recovery path for when
the watch pane has stopped, named for that role in `--list`'s own output, not the ambient surface.

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

## Where each rule came from

- The watcher as one point-of-use document binding every implementing run — joshuafolkken/kit#3172.
- `--wait` reporting by itself and exiting only on an arrival, a removed life record or `--hours` —
  joshuafolkken/kit#3102.
- `pnpm josh run:watcher:guard` detecting a missed restart — joshuafolkken/kit#2113, wired into
  `pretool-guard` by joshuafolkken/kit#2353.
- A stop as the only interrupt — joshuafolkken/kit#2136.
