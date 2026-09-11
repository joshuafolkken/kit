# `epicrun` — Unattended execution of an epic's children

`epicrun #<E>` runs an epic to completion without a person watching it, and `epicrun #<E1> #<E2> …`
runs several of them through one lane pool ("Several epics in one run" below). Read `fullrun.md`,
`chain-rule.md` and `followup.md` as well — each child is a `fullrun` — and read this file for what
running many of them unattended changes.

**What it changes about `queue` is the blast radius of a stop.** `queue` makes each issue's explicit
invocation its safety valve, so **a decision needed mid-implementation stops the whole session** —
and because nothing predicts *when* a child will need one, a person has to stay at the machine for
the length of the run. `epicrun` **sets aside only the child that needs the decision and moves on to
the others** (see "park and continue" below). That is what the keyword buys: the same guards, with
the blast radius of a stop reduced from the session to one issue. What each keyword *authorizes* is
a separate axis, and it is "What one invocation approves" below.

It also accepts an Issue that is **not** an epic; see "When `#N` is not an epic" below.

**An epic in another repository must be referenced as `owner/repo#E`** — `epicrun
joshuafolkken/kit#858` from an app-kit checkout. A bare `#858` resolves to *this* repository's issue
858, a different issue entirely, so the qualification is required rather than optional
(joshuafolkken/kit#864).

That qualification is not a form of its own: it is the `owner/repo#` prefix every entry point takes, and the definition is the same at every entry point — `SKILL.md` → "2c. The `owner/repo#` prefix". What it names here is where the *epic* lives; how the children are divided between sessions is "Concurrency" below.

**The working-tree hold is claimed per child, never per batch.** This command does not call `pnpm josh run:hold` itself: each child runs the `fullrun` procedure, so it claims the tree on entry and `pnpm josh followup` releases it at that child's merge — the tree stays free for the next child and held against anything else for the whole time a child is in flight. `SKILL.md` → §2f is the single source.

## Several epics in one run — `epicrun #E1 #E2 …`

**More than one epic can be named, and their children share one lane pool**
(joshuafolkken/kit#1493). `pnpm josh epic:next` takes the same list — every leading argument is an
epic reference — so `epic:next 858 909 --repo <this repository> --lanes` answers with children from
both, up to the number of free lanes. Before this, a repository with six free lanes could only fill
them from whichever epic was named first, which is the whole reason for having six.

**It is not a second spelling of `queue`, and reading it as one gets the blast radius wrong.**

| | `queue #N1 #N2 …` | `epicrun #E1 #E2 …` |
| --- | --- | --- |
| What is named | The **issues** to run | The **epics** whose children to run |
| What the order means | The schedule — issue 1 finishes before issue 2 starts | A tie-break — whose candidate takes the next free lane |
| How they run | Serially, one at a time | Concurrently, one per free lane |
| A stop | Ends the whole session at the first failure | Parks that child; the run continues |

So `epicrun #858 #909` is **not** "run 858 to completion, then 909". Both graphs feed the pool from
the first round, and a child of 909 can merge before a child of 858 does.

**The priority order is the order the epics were named**, and it is a decision rather than a
fallback. Dependency depth was the alternative and it does not compare across graphs: depth is
measured inside one epic, so a depth-2 child of a five-deep epic and a depth-2 child of a two-deep
one make the same claim about entirely different amounts of remaining work, and there is no relation
between two epics to normalize against. Argument order is the one ranking a person typed and can
change, and it is readable from the output because `epic:next` heads each epic's block with its own
reference. **Inside one epic the order is that epic's own task list** (joshuafolkken/kit#1583): its
declared chain still decides which children are *runnable*, and among those the task-list order
decides which is offered first — so an epic says "this one first" by moving the row rather than by
declaring a chain, which would stop every child behind a stuck one. This argument order only decides
whose candidate takes a free lane when two epics both have one.

**A child two epics both track is entered once.** One issue is one lane; entered twice it would open
two work trees on it, two branches and two pull requests, the second merging over the first. Identity
is `owner/repo#number` rather than the number alone, because a bare number names a different issue in
another repository. The
epic named **earlier** keeps it, which also settles what happens when that epic withholds it: it
stays withheld, because a `blocked-by` relation belongs to the issue rather than to the epic that
lists it.

**Everything else is unchanged, and that is the point of merging at the pool rather than at the
entry point.** Park and continue, the stopping conditions, the guards and the `needs-human-review`
stop all read a child, never an epic, so none of them learns how many epics were named — the
per-run guards below count the run, so 30 children and 10 filings are the ceiling across the whole
pool rather than per epic. **`pnpm josh latest` still runs once**: its hoist is keyed to the session
and the checkout, never to an epic ("`josh latest` runs once per session" below), so five epics
still mean one dependency update, asked the first time the loop hands back any child.

**The end-of-epic work is per epic, and the pooled token does not say when.** `--repo` answers about
the *pool*, so it prints `complete` only once every named epic is — read as one epic's signal, it
would delay each epic's summary until the last of them finished. An epic's own completion is read
from the aggregate form instead: `pnpm josh epic:next 858 909`, no `--repo`, which prints each epic's
block and its own verdict. Ask it once the pooled answer stops offering that epic's children, send
that epic's summary then, and run `josh propagate` unchanged.

**A childless epic is skipped rather than refusing the command** — the one read failure that does not
stop the run. An epic whose task list is not filled in yet is a valid epic of ours, and refusing for
it would stop every other named epic's children being offered on every polling round; it is named on
standard error and the run carries on. A reference that does not parse, or one naming another owner's
tracker, still stops everything.

## When `#N` is not an epic

`epicrun` accepts an ordinary Issue as well as an epic. `epicrun #<N>` on an Issue with no task list
runs `#<N>` as a `fullrun` — the same plan, verification gate, PR and merge — and then finishes.

The point is *when* the person is involved. Typing `epicrun` up front is the batch authorization
given once, before anything is known; `fullrun` is the authorization for one Issue, which is why a
`fullrun` that discovers a split has to stop and ask for the batch one. Both amount to a single
human action — this one just spends it at the start, for work already expected to grow
(joshuafolkken/kit#892).

So inside `epicrun #<N>`, a prerequisite or a split found mid-run does **not** stop the run:

1. File the new Issue(s) with the matching route label — `route:split` for a split, `route:tier-a` for a prerequisite (joshuafolkken/kit#1083) — no confirmation; the batch was already approved by the keyword.
2. **Stash the work in progress and remove `in-progress` from `#<N>`**, exactly as steps 2 and 4 of
   "A prerequisite discovered mid-run" do — `git stash push -u -m "..."` with the `-u` (a new
   `*.test.ts` is untracked), the `gh api repos/{owner}/{repo}/issues/<N>/comments` post that records the stash so whatever resumes
   `#<N>` knows to pop it, and `gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/in-progress 2>/dev/null || true`. The reasons are the
   same two: the tree is dirty on the default branch and the next child begins with `git switch main
   && git pull`, and `epic:next` classifies a child carrying `in-progress` as waiting on time
   **before** it consults any blocker, so `#<N>` would never be offered again and the epic would
   stall. **The path is new; the mechanics are not, and none of them is optional here.**
3. **Ask `pnpm josh epic:bundle <N>` whether an epic already tracks `#<N>` before creating one.** It
   names the epic (`#893 already tracks this issue`) rather than only reporting that one exists. A
   bare Issue handed to `epicrun` can already be somebody's epic child — nothing stops
   `epicrun #943` on a child of `#893` — and creating a second epic over it gives the auto-close two
   task lists to disagree about, on the entry point that runs with nobody watching
   (joshuafolkken/kit#943).

   | Answer | What to do |
   | --- | --- |
   | An epic `#<E>` already tracks `#<N>` | `pnpm josh epic --add <E> <P> --before <N>` for a prerequisite, or `--add <E> <N1> ...` for a split. **Do not create a second epic.** Continue the loop against `#<E>` |
   | No epic tracks it | Create one — the command depends on what was found (table below) |
   | **The command could not answer** — a non-zero exit, `Could not confirm which epic already tracks these — do not place this issue in one.` (every placing verdict is withheld when the epic listing was cut short — joshuafolkken/kit#1697), or a ⚠ warning about a truncated listing above a `Nothing to bundle.` verdict. The truncation warning is the one beginning `⚠ The epic listing …`, in either of two forms — `hit its …-epic cap` and `stopped at the …-issue page ceiling` — both saying the listing was not read to the end (joshuafolkken/kit#1067); `⚠ Could not read #N.` is one failed relation read and voids nothing. A definitive answer stands even beside a warning | Park `#<N>` with `needs-decision` and report. "Could not tell" is not "no epic tracks it", and reading it as such recreates the duplicate this step prevents |

   When creating one, `#<N>` is being implemented, so it is itself one of the deliverables — which is
   why this path always takes the keep-as-a-child arm of `split-assessment.md`'s promote-or-create
   branch, rather than choosing between the two. **Which command depends on what was found**, because
   `--ordered` makes the argument order the dependency chain:

   | Found | Command |
   | --- | --- |
   | A prerequisite `<P>` | `pnpm josh epic "<title>" <P> <N> --ordered` — the prerequisite comes **first**; reversing them records the inverse `blocked-by` and the run implements the deliverable before the thing it needs |
   | A split into independent children | `pnpm josh epic "<title>" <N> <N1> ...` — **no `--ordered`**, which would serialize children that have no order and record `blocked-by` relations nobody declared |
   | A split whose children do have an order | `pnpm josh epic "<title>" ... --ordered`, arguments written in that order |

4. **Run `pnpm josh epic:audit <E>` now**, not earlier. The audit below is written for a run that
   starts from an epic; on this path there is no epic until step 3, and `epic:audit` refuses an
   Issue with no task list exactly as `epic:next` does — running it against the bare `#<N>` would
   stop the run at its first step, which is the opposite of what this entry point is for.
5. **Do not stop.** Continue into the loop below against the new epic `#<E>`.

**Nothing found means no epic.** If `#<N>` reaches its merge without a prerequisite or a split
turning up, the run finishes there. An epic is created only when there is a second child to put in
it — an epic holding one closed Issue is noise that the auto-close then leaves open.

**Every guard below applies on this path unchanged** — 30 children, 10 Issues filed, 3 consecutive
failures. They are the run's limits, not the epic's, and the whole reason this entry point removes a
confirmation is that the guards are what remain.

**This does not let `fullrun` promote itself.** The widening belongs to `epicrun` alone, because
`epicrun` is where the batch was authorized. A `fullrun` that discovered a split and built an epic
around itself would merge a batch on one Issue's authorization — it still files the children and the
epic and then **stops** (`split-assessment.md` → "Finding a split mid-run stops the run").

**`josh epic:next` is not changed by any of this.** It still refuses an Issue with no task list, and
still prints `#<N> tracks no children in a task list.` — the acceptance of a bare Issue belongs to
`epicrun`, which has not built an epic yet at that point and therefore never asks `epic:next` about
one.

**Naming a bare Issue *beside* an epic is the one thing that does change, and it is a mistyped
command rather than a second entry** (joshuafolkken/kit#1493). Where one reference is named, that
refusal is the whole answer and the sentence above stands unqualified. Where several are, a
task-listless reference is **skipped** so the other epics keep running — so `epicrun #<E> #<N>` with
`#<N>` an ordinary Issue exits 0, notes the skip on standard error, and **never runs `#<N>`**.
`epicrun` is what accepts a bare Issue, and it accepts one only when it is the *sole* reference: a
run that means to do both types `epicrun #<N>` on its own after the epic. Read the stderr notice —
an epic listed there that you expected to have children is either that mistake or an epic nobody has
filled in yet.

## What one invocation approves

**One `epicrun` approves every merge in the epic**, plus pushes to more than one repository and the
issues the run files itself. That is the point of the keyword: `queue` re-asks for authorization
every child, which is what forces a person to stay at the machine.

It does **not** approve anything outside the epic, **except the issues a person has opted in with
`auto-ok`** — that label is the person's act, not the run's, which is what keeps the widening an
authorization rather than a self-authorization (see "After the epic" below). A Tier C action still
stops — for that child.

## Each child runs in a delegated unit

**A child is not run in the parent loop's context.** One child goes to an isolated execution unit,
and only its summary comes back (joshuafolkken/kit#984). The measurement is why: across one
`epicrun` that ran seven children in one context, the context averaged 99,789 over the first twenty
requests and 698,928 over the last twenty, and the same 490 requests broken every 50 — about one
child — would have billed 33% of what they did.

**The mechanism is not new.** It is the one joshuafolkken/kit#969 defined — the enumeration plus
`pnpm josh delegate` — with the unit changed from one step of a run to one child of an epic.
Building a second is the clone `CLAUDE.md` prohibits. Ask the command rather than deciding:

```bash
pnpm josh delegate epic-child   # → delegate
```

**The parent reads GitHub, never the summary.** That is `epic-child`'s verifier, and it is the whole
reason the unit may be delegated at all: a unit that reports a child finished without its PR merged
leaves that child open, and `pnpm josh issue:state <N>` says so in one call. The child's own
gate, `/code-review` and CI run inside the unit, and `pnpm josh followup` will not touch the
PR until they are green. **Never advance the loop on the summary alone** — that discards the
verifier, and without it `epic-child` is not a delegatable unit.

### What the summary carries, and how long it may be

**The summary's only job is to carry what GitHub does not.** The parent reads the verdict from
`pnpm josh issue:state <N>` and the work from the pull request, so anything already on GitHub is sent
twice — once to the record, where it stays for free, and once into the parent's context, where it is
re-billed on every remaining turn of the run. joshuafolkken/kit#1567 measured what that costs: one
day's twenty children averaged **240,000 tokens each**, some of their reports ran to several hundred
lines, and `tool_result` was **25.2%** of everything accumulated in the parent's conversation.

**"Make it shorter" is not the rule, because it deletes the wrong half.** A report cut by feel loses
the observation nobody else recorded and keeps the file list anyone could have fetched. So both lists
are written out, and the brief hands them to the unit.

**Always kept — five things, because none of them is anywhere else:**

1. **`Cause` / `Fix` / `Result`**, the three plain lines — the parent's orientation, so it does not
   have to open the pull request to know what happened.
2. **Every verification result the run did not close in the ordinary way**, and **`josh eval`
   answering `skip`, `unmeasured` or `unreachable` is one of them**, named as such. A measurement
   nobody made must never reach the parent as a run that passed.
3. **Observations that could bite later** — something noticed and not filed, a flaky check, a
   surprising diff, work a later child will collide with. **This is the only route a child's
   discretionary observation has** (joshuafolkken/kit#1698): a child files `route:tier-a` and
   `route:interrupt` only, and the parent files what survives — `SKILL.md` → §2i, the single source,
   carries the depth test it is filed under and why a child cannot count the ceiling. **What the
   parent does with the rest is append it, not drop it**: an observation that cannot cite the depth-0
   work it blocked becomes one line in `docs/observations.md`, and a second line under the same key
   is what files it. **The child never writes that file** — it cannot tell its observation from the
   sibling lane's, so parallel children would write one phenomenon under several keys and every one
   of them would read as a first sighting (joshuafolkken/kit#1728).
4. **Decisions taken and why**, where the decision was not already logged as an Issue comment.
5. **What was left undone**, and under whose authority — a dropped review finding, a skipped step, a
   scope a comment moved to another Issue.

**Always cut — three things, because GitHub already holds them:**

1. **The changed-file enumeration.** It is the pull request's own file list.
2. **The per-round review detail.** Each round's verdict is one line; the findings are on the pull
   request.
3. **Restatements of rules the parent already holds** — the gate's order, the round cap, what
   `followup` does. The parent is running the same procedure.

**The bound is 25 lines, and it is a number so that it is not a judgement.** A summary that cannot be
said in 25 lines is describing the work rather than reporting it, and the description belongs on the
pull request, where the parent can go and read it if the state it read back disagrees. **The brief
states the bound**, because a unit never told it writes to the length its own report format suggests.

**This does not shorten the person-facing completion report.**
`prompts/collaboration-workflow/report-format.md` → 「完了報告（セッション向け）」 is unchanged, its
changed-file list included: a person reading a finished run has no pull request open beside them, and
that report is written once rather than re-read on every later turn. What is bounded here is the
child's hand-back to the parent, and the reason is exactly that the hand-back is re-read.

**Read the state directly rather than asking `epic:next` again.** A child that did not finish still
carries `in-progress`, and `epic:next` classifies such a child as waiting on time before it consults
any blocker — so it answers `wait`, not the number, and a loop that took that as its check would
poll to the 90-minute stale window instead of learning that the child failed.

**The merge authorization reaches the unit.** The batch a person approved by typing `epicrun` covers
the unit that runs each child (joshuafolkken/kit#986 → `## Decisions`). Delegating changes which
context spends that authorization, not how far it reaches.

**So does the explicit invocation, and the brief is what carries it.** `CLAUDE.md` → "Explicit
invocation required" forbids starting a `fullrun`-shaped run that was never typed, and a unit
holding that rule with nothing to point at would refuse, return the child open, and be booked as a
failure. What the rule forbids is **inferring** a workflow from the shape of a request; it is not
a requirement that the keystroke land in the unit's own transcript. **The brief therefore names the
invocation it descends from** — `epicrun #<E>`, the child number, and that the child is to be run as
`fullrun #<N>` under that authorization. Written that way there is nothing to infer, which is the
whole of what the rule asks. A brief that omits it is the defect: the unit is then guessing, and
refusing is the correct answer to a guess.

**Where no isolated unit exists, run the child in the parent's context.** The hand-off below covers
that case — and, since joshuafolkken/kit#1567, every other case as well: it is asked at every merge
rather than only where delegation is unavailable. Delegation keeps each child's own context small
and the hand-off bounds the parent session's length, so it is not an alternative to it.

## A delegated unit that stopped without reporting

**A unit can be stopped from outside, and a stop leaves no notification behind.** The parent then
waits on a report that is never coming. Measured on joshuafolkken/kit#1176: one child's unit was
stopped externally, the loop went on calling that child in progress for **1 h 45 min**, and what
ended the wait was a person asking whether anything was still moving (joshuafolkken/kit#1212).

**Being slow and having stopped look identical from the parent, and only one of them is survivable.**
A slow run finishes if it is waited on; a stopped one never does. **Every guard in this file assumes
the unit is running** — three consecutive failures counts results the unit reports, and the
eight-hour timeout ends the session rather than the child — so **a unit that is not running trips
none of them**, which is why an unnoticed stop breaks the premise of unattended execution in a way
that mere slowness does not.

**So the parent checks rather than waiting — which means it must not be waiting.** **Hand the child to
the unit without blocking on its return, and poll.** A parent that blocks is waiting for exactly the
report a stopped unit never makes, so it has no turn in which to run the check below; written
that way the detection would be present in the document and unreachable in the run, which is
joshuafolkken/kit#1176 reproduced unchanged. Poll at the loop's polling interval, and ask once the
unit's output has been unchanged for the silent-unit window —
`| Silent delegated unit | 30 min |` in the waiting table below.

**Note where the unit writes at hand-off; the modification time is read from the file, not carried.**
The path is the one thing the parent cannot recover afterwards, so it is written down the moment the
child is handed over. The timestamp is not — a value copied down forty minutes earlier is a value
that was read once, and reading it from the file each time is both cheaper and correct across a
parent that restarted.

**Where the child runs in a lane, that note goes into the lane rather than into the conversation** —
`pnpm josh lane:output <N> <path>`, in the same turn as the dispatch (joshuafolkken/kit#1713). Written
down only in the conversation, the path is lost with the session that took it, which is what made a
session boundary drain the pool before it could be cut; recorded in the lane it comes back from
`pnpm josh lane:output <N>` in any session, including one that never opened that lane. It is the same
note either way — the recording is what makes it durable, not a second reading.

**Ask the command rather than combining the traces yourself.** It reads the output, the checkout and
the child's state, and answers one verdict. Traces are read **in the checkout the unit was given** —
this session's own unless the unit was handed a separate work tree, in which case run it there, and
the stash in the recovery below is taken there too. Read against the parent's checkout while the unit
worked in a work tree and everything comes back clean, the stop goes undetected, and the stash saves
nothing while the half-written work stays in the abandoned tree.

```bash
pnpm josh run:liveness <N> --output <path> --process none    # alias: josh rv
pnpm josh run:liveness <N> --output <path> --process alive
pnpm josh run:liveness <N> --output <path> --process none --window 45 --repo <owner/repo>
```

| Answer | What it found | What the parent does |
| --- | --- | --- |
| `alive` | The output moved, or a process of the child is running | Keep polling; touch nothing |
| `stopped` | The output has been frozen past the window and no process of the child is alive | The recovery below |
| `settled` | The child closed, or the unit parked it with `needs-decision` | Re-read it with `pnpm josh issue:state <N>` and take the branch its state says |
| `undetermined` | A trace could not be read | Read the trace that failed and ask again — and see the two-in-a-row rule below |

**Two `undetermined` answers in a row is a fault in the check, not a slow unit.** The path noted at
hand-off can be wrong, or rotated, or never created; read that way every poll answers `undetermined`
forever and the stop is never detected — which is the failure this whole section exists to remove,
reappearing one layer up. So the second consecutive `undetermined` on the same child ends the polling:
send a `confirmation` Telegram naming the trace that failed, and stop. **It is never escalated to a
`stopped`** — nothing was read, and inventing a verdict from that is exactly the error the design
forbids.

**Silence and no process, together — never either one alone.** Each has an innocent reading by
itself: a unit inside a long check writes nothing for as long as the check runs — `pnpm josh
followup` waits on CI for up to 32 minutes, which is longer than the window — and a unit that is
only reading has no check process at all. Together they have no innocent reading. **Which way an error
falls is the whole design**: a live unit booked as stopped has its working work killed, while a
stopped one booked as alive costs waiting — so **a trace that could not be read answers
`undetermined`, never `stopped`**, and a process trace nobody gave is an unasked question rather than an
answer of "no process".

**Output that moved answers `alive` on its own; a live process does not.** Growth in the transcript
needs nothing else to mean what it says. A live process is weighed only once every trace has answered,
because a `pgrep` scoped a shade too wide — the thing this section already warns about — would
otherwise answer `alive` on every poll over an output path that resolves to nothing, and no poll would
ever say `undetermined` for the rule below to count.

**The path passed to `--output` is absolute.** A relative one resolves against whatever directory the
parent happens to run from, which for a unit given its own work tree is rarely the one meant, so the
command refuses it rather than resolving it.

**The process trace is the one the command does not read for itself.** Run it in the checkout the unit
was given and pass what you saw. Read the command lines rather than the names — `pgrep -laf vitest`,
`pgrep -laf playwright`, `pgrep -laf 'josh gate'` — and look for one naming **that checkout's path**.
**A bare command-name match is not the test**: several kit projects are meant to run at once
(`PORT_SEED` exists for that), so one unrelated watcher anywhere on the machine would answer `alive`
forever and no stop would ever be detected.

**Read the file the path points at, not the link.** A unit's transcript path is a symlink, and a
link's own modification time never changes after it is created — so the shell's `stat`, which does not
follow a link by default on macOS, reports that creation time whether the unit is alive or dead. Both
errors follow from it, and the costly one is the second: this parent twice reported a dead unit as
alive on such a read. `run:liveness` follows the link and compares the size as well as the timestamp,
across two samples a few seconds apart; a `stat` typed by hand needs `-L`.

**A clean checkout is not evidence that the unit is alive.** The detection this replaces required a
dirty one, on the reasoning that a unit which died mid-implementation leaves exactly that — and the
stop that actually happened came seven minutes in, while the unit was still reading the skill and the
issue, so the tree was clean and the test could never become true (joshuafolkken/kit#1485). The
checkout is still read, for one thing only: whether there is work to stash before the child is parked.

**"Nothing was ever opened for the child" is not part of it either.** It is equally the normal state of
a unit that has not reached its commit yet, so it separates nothing — and that question already has an
owner: `pnpm josh run:preflight` asks it at the start of the next child, which is where the answer is
acted on.

**What follows is what a failed child already gets.** Re-read the child first with
`pnpm josh issue:state <N>`, in case the unit finished between the traces and this read; then, while
it is still `state: OPEN` and not carrying `needs-decision`. **A re-read carrying `needs-decision`
needs nothing from this section** — the unit parked the child and then stopped, so fall through to the
loop's park branch: leave the label on, count nothing against the consecutive-failure guard, and go
back to step 1.

1. **Stash the half-finished work** — `git stash push -u -m "epicrun: stopped unit for #<N>"` — and
   record it on the Issue with `gh api repos/{owner}/{repo}/issues/<N>/comments`, exactly as a paused
   child's stash is recorded. `-u` is not optional, and the comment is what gets the stash popped.
2. **Remove `in-progress`** — `gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/in-progress 2>/dev/null || true`.
   Left on, it holds the whole repository under the per-repository exclusion below.
3. **Count it against the consecutive-failure guard and park it** with `needs-decision` and a comment
   naming what `run:liveness` answered and what it read. This is the Guards table's "a failure that is not
   consecutive parks its child", applied to a child whose unit stopped.
4. **Go back to step 1 of the loop.**

**It is booked as a failure rather than restarted.** A silent retry re-runs a child whose tree may be
half-written, and the consecutive-failure guard is the only thing that notices the environment rather
than the children is at fault — a stall the parent quietly restarts is a stall nothing ever counts.

## Concurrency: as many children per repository as it has free lanes

Execution state lives on GitHub and nowhere else (`epic:next`, joshuafolkken/kit#860), so **an
`epicrun` need not be a single session.** One session per repository; each calls
`josh epic:next <E> --repo <owner/repo>` and runs only its own repository's children.

```bash
# In the kit checkout
pnpm josh epic:next 858 --repo joshuafolkken/kit
```

A child in another repository is read against that repository through `gh api`, so no clone is
needed to learn its state — only to implement it. `epic:next` prints the local checkout for each
repository's candidates, from joshuafolkken/kit#869's map; a repository with no checkout here says
so rather than being cloned.

**A dependency that crosses a repository is not satisfied when the blocking issue closes.** Merging
kit's issue does not publish kit, so a consumer child told it may start at that moment installs the
previous release, or fails outright. Such a dependency resolves only once the blocker is closed *and*
its release has appeared in the registry — and while the blocker is still open the registry is never
consulted, so a run never sits waiting on a publish from the moment it starts.

**Unless that repository publishes nothing** (joshuafolkken/kit#1129). A repository with no
`package.json` on its default branch, or one declaring `private`, ships no release for the check to
wait on — so a closed blocker there resolves rather than waiting until the run's own eight-hour
timeout with nothing an operator can edit to clear it. The answer is read from the blocker
repository's own manifest and never from the registry: a registry 404 also means "this token may not
see it", so resolving on one would start a consumer child before its blocker's release existed.

**The lane count is per repository, and `epic:next` is what applies it.** When
`josh epic:next --repo <owner/repo>` has a child to offer, it first asks that repository **how many
of its lanes are already running something**: every open issue carrying `in-progress` and not parked
counts for one — whichever epic that issue belongs to, and whether or not this epic tracks it at
all (joshuafolkken/kit#925, counted rather than excluded since joshuafolkken/kit#1491). What is left
of `JOSH_LANE_LIMIT` (**default 6**) is what gets offered, and at zero the answer is `wait`. Two
limits are part of the definition rather than gaps in it. It is
asked **only when there is a candidate**, so `stop` and `complete` are still answered while
something is in progress — neither of them is about to start anything. And a **parked** issue does
not hold a lane: `needs-decision` outranks `in-progress` here exactly as it does in the
classification, or `park and continue` would spend a lane on the child it just set aside. A child
stopped by `needs-human-review` is deliberately not parked and goes on holding its lane, because its
uncommitted work is still sitting in that checkout.

**It is advisory and it is not atomic.** The label is applied by whoever is about to implement a
child, *after* this read — so two sessions starting in the very same instant can both read the same
free lane and both be handed a child for it. What the check closes is the window that actually
occurs: a lane already running a child holds the label for the whole of it, which is minutes,
against a race measured in seconds. Treat it as a guard that makes the invariant mechanical, not as
a mutex.

**It is scoped to the resource, not to the epic.** What two children contend for used to be one
working tree, one `main` and one `pnpm-lock.yaml` that `josh latest` rewrites; since
joshuafolkken/kit#1490 a lane is its own checkout with its own branch and its own ports, so the
contended resource is the lane and the repository-wide number is a **ceiling on how many of them run
at once**. Either way it does not care which epic a child belongs to. **How a session opens a lane
and drives more than one child at a time is "Lanes — running more than one child at a time" below**;
what this section decides is only what `epic:next` answers.

**A stale label holds a lane, so the stale rule reaches past this epic's own
children.** An interrupted run leaves `in-progress` behind, and that label holds a lane rather
than one child —
so "`in-progress` is removed by whoever finds it stale" below applies to **any** open issue in the
repository, not only to this epic's children. `epic:next` names the issues holding the repository on
standard error for exactly that reason, and the 90-minute stale window bounds the wait.

**A listing it could not read is not an idle repository.** `epic:next` answers `wait` there rather
than offering the child — reading a failed read as "nothing is running" is the one direction this
guard may not fail in, because that answer *starts* work. It is not an error either: the listing
swallows a passing rate limit into the same failure, so an exit would end an unattended run over a
blip, while a persistent failure is already caught by the unreadable-child anomaly before this read
happens. So the loop polls, and the reason is on standard error. **A listing that was *cut short* is
the same answer** (joshuafolkken/kit#1067): the paging bounds every listing now, and a short one with
no visible holder is still not "nothing is running" — `wait`, with its own message, since clearing a
stale label would not change it.

**Two children of one repository may run at once, and the section below is how.** This paragraph
used to say the opposite, and the three reasons it gave have each been answered rather than waived
(joshuafolkken/kit#1492). They are recorded here because a reader who finds only the new procedure
cannot tell which of them was solved and which was merely stopped being mentioned:

| The premise this section used to assert         | What replaced it                                                                                                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two children would collide over the version     | **Gone.** A child no longer picks a version at all — `pnpm josh release` decides it from main's own history (joshuafolkken/kit#1169, joshuafolkken/kit#1486), so there is nothing to collide over |
| One checkout cannot hold two branches           | **Gone.** A lane is its own linked work tree with its own branch, its own `.env` and its own ports (joshuafolkken/kit#1490), and `josh latest` runs once before any of them opens        |
| Two children touching one file need prediction  | **Not built, deliberately.** Overlap is surfaced at the merge, where GitHub already reports it, and the child that loses the race resolves it in its own lane — "Conflicts are not predicted" below  |

**So the guard is a ceiling rather than a prohibition.** It was always scoped to the resource rather
than to the epic — `epic-classify.ts` sorts only the children the epic tracks, so a second `epicrun`
in the same checkout answered "nothing of mine is in progress" and both ran, and what actually
serialized them was a person typing the runs one after another. What changed is that the resource is
now a lane rather than the one working tree, and `JOSH_LANE_LIMIT` is how many of them may run at
once. **Do not read any of this as "concurrency needs no coordination"**: the coordination exists, it
is this section plus the one below, and switching the guard off is still not one of the ways to get
parallelism.

**Across repositories nothing changed.** The manifests are different files, the checkouts were
already separate and Actions runs are independent, so cross-repository parallelism was in scope
before lanes existed and is unaffected by them.

Parallelism only helps children that do not depend on each other. When app-kit's child needs kit's
new feature, that is recorded as `blocked-by` and `epic:next` makes it wait. That is the dependency,
not a limit of the model.

## Lanes — running more than one child at a time

`pnpm josh epic:next <E> --repo <owner/repo> --lanes` answers with **one issue number per line**, up
to the number of free lanes, and each of those children runs in a **lane** of its own: a linked git
work tree with its own branch, its own `.env` and its own dev and preview ports
(joshuafolkken/kit#1490, `docs/josh-commands.md` → "`josh lane:open` / `josh lane:close` /
`josh lane:list` / `josh lane:prune`"). **Implementation, the verification gate and the review run in
parallel; the merges stay serial** — not because this procedure serializes them, but because each one
lands on the `main` the next one is then measured against.

**One kind of child takes no lane beside anything: an interrupt whose subject is a defect in the
verification path itself.** It runs alone, and the batch resumes only once it has merged. **Decide it
from the enumeration, never from how serious it looks** — does the defect reach the verification gate
(lint / type check / spell check / unit tests), the code review, the pre-push hook, or the merge
checks? One of those, and the offered children wait; none of them, and it fills a lane like any other
child. Two reasons, either sufficient: six lanes running on a broken verifier produce six results
nobody can trust, and the interrupt's own verification is subject to the very defect it is fixing —
the trap joshuafolkken/kit#1515 and joshuafolkken/kit#1517 both hit. **Ask it of what
`epic:next --lanes` just offered, before opening a second lane**; the rule and the failure it was
written after are `prompts/collaboration-workflow/wip-cap.md` → 「実行のしかた」, which is its single
source (joshuafolkken/kit#1518).

**A lane's review does not inherit the lane, and `pnpm josh review:brief` is what closes that**
(joshuafolkken/kit#1522). `/code-review` is forked by the harness into the **session's** working
directory, which during a lane run is a different tree — usually the default branch, with the
previous child already merged into it. Reading that, the review finds nothing wrong and reports no
findings, and **the failure arrives as approval**: the child counts the round as clean and commits a
diff nobody read. Measured across the seven children `epicrun #1474` merged, twelve of fifteen review
rounds named the lane's absolute path in the invocation and cited files that were in their own diff;
the one round whose invocation named no path is the one that reviewed a different pull request
(joshuafolkken/kit#1517, round 1). **So the path is no longer something a brief has to remember to
carry**: `pnpm josh review:brief` prints the lane's absolute root, branch and HEAD, hands over targets
written `git -C <root> …`, and prints a nonce the review attests with
`pnpm josh review:attest <nonce>` from the checkout it actually read. **The child asks
`pnpm josh review:attest --check` before it counts a round**, and `pnpm josh followup` asks
again before it merges; `missing` and `mismatch` are both refusals, because the defect's own signal
is silence. A clean round is therefore the case to check hardest, not the case to skip the check on.

**A lane's branch is `<N>-lane`, and the issue number leads it so that the commit path accepts it**
(joshuafolkken/kit#1497). `pnpm josh git` refuses to commit from a branch that is neither the default
branch nor one sharing the child's `<N>-` prefix (`scripts/git/git-branch.ts` →
`has_same_issue_prefix`, `/^\d+-/`); the original `lane/<N>` matched neither, so a child implemented
in a lane exited 1 at its commit with "Branch mismatch detected" and no lane could ship anything.
**Switching the lane to another branch is not the way round it, and reaching for one is the failure
this paragraph exists to stop.** `lane-registry.ts` → `branch_issue` identifies a lane **by** that
branch name, so a switched lane drops out of `list_lanes()` altogether: `lane:open` re-issues its
seat to the next lane and the two bind the same dev and preview ports, `lane:list` and
`lane:close --all` stop seeing it, and `lane:prune` cannot reach it — the port isolation that is the
whole reason a lane exists, lost to work around a branch name. **The rename is what makes the
workaround unnecessary rather than merely forbidden**: `lane_paths.lane_branch` and
`lane_registry.branch_issue` read the same name from one constant, and it is a name `pnpm josh git`
already commits from. So `epic:next` is asked **with** `--lanes`, and everything below runs as
written.

**Running unattended gets harder, not easier, and that is the honest trade.** Six lanes make the overlap
between children real — two open issues touching `scripts/git/git-epic-*` and two touching
`scripts/eval/*` are very likely to be in flight together — and every overlap that becomes a conflict
costs the child that loses the race a resolution, a re-run gate and a review it would not otherwise
have paid ("Conflicts are not predicted" below), and parks it outright under that section's four
conditions. The run finishes more work per hour **and** spends more of each child's budget on merge
races. Do not report the first without the second.

### Once per repository, before the first lane opens

In the **primary checkout**, in this order, and never again per lane:

1. `git switch main && git pull` — every lane is branched from this ref.
2. `pnpm josh latest:scope`, and the update on `required` — "`josh latest` runs once per session" above.
3. `pnpm josh lane:prune` — closes the lanes an interruption left registered without a work tree.

**`pnpm josh latest` is never run inside a lane, whatever `latest:scope` answers there.** The
elapsed-time window that makes that answer meaningful is keyed to the project root —
`latest-stamp.ts` → `stamp_path(STAMP_PREFIX, PROJECT_ROOT)` — and a lane's project root is its own
directory, so a fresh lane has no stamp, is told `required`, and six lanes run six dependency
updates. That is the failure the hoist above exists to prevent, reappearing one layer down. **Ask it
in the primary checkout; in a lane, do not ask at all.**

**The rewritten lock file still has to reach a pull request**, and with lanes no child runs in the
primary checkout to carry it. `git stash` is a repository-level ref shared by every work tree, so the
change moves without being copied:

```bash
git stash push -u -m "epicrun: josh latest before lanes"   # primary checkout, only if the update rewrote anything
git -C "$dir" stash pop                                    # the first lane opened, after `lane:open`'s own install
```

Record it on that first child's Issue as any other stash is recorded — the comment is what gets it
popped if the run dies in between. "The lock file the update rewrites lands with the first child"
above is unchanged; only where the first child stands has moved.

### Opening one lane

```bash
dir=$(pnpm josh lane:open "$n") || exit 1   # the directory on stdout, nothing else; alias: josh lno
git -C "$dir" stash pop || exit 1           # the first lane only, and only if `josh latest` stashed
pnpm --dir "$dir" install --frozen-lockfile                 # only after a pop, which changed the lock
```

- **A refusal is an empty capture beside a non-zero exit**, with the reason on standard error:
  `full` (every seat taken), `already-open` (a lane for this child exists) and a **failed install**
  are the three (joshuafolkken/kit#1554). **The third is not like the other two**: `full` and
  `already-open` create nothing, while a failed install leaves a real work tree behind, registered
  and holding its seat, so the next `lane:open` for that child answers `already-open` and never
  retries the install. **Park that child and name `pnpm josh lane:close <N>`** — the message on
  standard error carries pnpm's own reason, and a lock the lane cannot build is a state a person
  fixes, not one a retry loop resolves. **The
  guard is in the snippet rather than left to the reader** — without it the next two lines run
  `--dir ""` in whatever directory the parent happens to stand in.
- **`lane:open` installs; the third line is a *re*-install, and only the popping lane needs it**
  (joshuafolkken/kit#1554). A lane comes back with its dependencies already in it, built against the
  lock as committed on the ref it was cut from — an install left to the caller was a step nothing
  enforced, and every lane opened without it failed on its first `pnpm josh …` with
  `tsx: command not found`. **A failed install fails `lane:open`**, so a directory on standard output
  is already the guarantee that the lane runs; there is nothing to check afterwards.
- **What the pop changes is the lock, which is why that one lane installs twice.** The pop brings in
  the `pnpm-lock.yaml` that `josh latest` rewrote, and that is the lock this child's gate has to build
  against: left at what `lane:open` installed, the first child runs its whole verification gate
  against `node_modules` from the *previous* lock while committing the new one — a gate that cannot
  see the regression it exists to catch. The second install is a few seconds from a warm store, and
  **it runs only where a pop actually happened**; every other lane is finished when `lane:open`
  returns. **A pop that fails stops the lane** rather than re-installing anyway, which is the same
  failure by a different route.
- **A `<N>-lane` that already exists is attached to, and `lane:open` says so on standard error**
  (joshuafolkken/kit#1627). That is what makes `lane:open <N>` the way back to a child parked after
  it pushed: a local branch of that name gets the work tree put on it, and where there is none the
  **remote itself** is asked — `ls-remote`, not the remote-tracking refs, which nothing prunes — and
  the lane is cut from `origin/<N>-lane` only where the branch is still there, fetched first so it
  starts at the tip. With the branch gone from origin, or never there, the lane is cut from the
  default branch as any new one is. **A reused branch is not a fresh lane** — it starts on commits
  somebody already pushed, which is why the reuse is printed rather than left to be noticed. Nothing
  deletes a branch to open a lane, so a reopen cannot cost the pushed work.
- **Nothing switches the lane's branch.** The reason is at the top of this section: the registry
  identifies a lane by that branch, so a switch costs the lane its seat, its listing and its
  isolation. **Nor is there anything to switch it for** — `<N>-lane` is already a name
  `pnpm josh git` commits from (joshuafolkken/kit#1497), so the child commits, pushes and opens its
  pull request from the branch `lane:open` created.
- **`pnpm josh run:preflight` is not asked in a lane; `lane:open`'s own answer replaces it.** A lane
  that opened a moment ago was created from the default branch and is clean by construction, and the
  command could not answer usefully anyway: its `reclaim` arm tests `HEAD != default branch`, which
  is true of **every** lane, and the recovery it prints — `git switch <default>` — cannot run in a
  linked work tree, because the default branch is checked out in the main one. What a leftover looks
  like here is `lane:open` answering `already-open`, and the branch for that is in the table below.
- **`pnpm josh run:hold` is unchanged, and is claimed inside the lane.** It keys on
  `git rev-parse --absolute-git-dir`, which is `.git/worktrees/<name>` in a linked work tree, so each
  lane holds independently and the child's own `fullrun` claims it exactly as it always did.

### Handing the child over

The child runs as `fullrun #<N>` in a delegated unit, per "Each child runs in a delegated unit"
above, with two additions to the brief: **the lane directory every command is to run in**, and that
neither `josh latest` nor a progress watcher is to be started there. Everything else — the plan, the
gate, `/code-review`, `pnpm josh git`, `pnpm josh followup` — is unchanged, and
`pnpm josh followup` releases that lane's hold at the merge as it always has.

**Start each unit without blocking on it, and poll them all.** That is "A delegated unit that stopped
without reporting" above applied N times rather than once, and
`pnpm josh run:liveness <N> --output <path>` is read **in that child's lane** — the case that section
already names when it says the traces are read in the checkout the unit was given.

**`git switch main && git pull` is the parent's now, not the child's.** No lane can switch to the
default branch, because it is checked out in the main work tree, so the refresh moves to the primary
checkout and happens **before each `lane:open`** — which is where it does the same job, since that is
the ref the lane is cut from.

### Conflicts are not predicted

**Nothing here forecasts which children will overlap.** A forecast is wrong often, and when it is
wrong it is wrong silently. The overlap surfaces where GitHub already reports it: a pull request that
conflicts with its base comes back `mergeStateStatus: DIRTY`, which `git-pr-checks-eval.ts` reads as
a **failure** rather than polling through it (joshuafolkken/kit#1232) — so `pnpm josh followup` ends
that child with a named conflict in about ten seconds rather than running its 32-minute budget out.

**That child does not stop: it resolves the conflict in its own lane** (joshuafolkken/kit#1623).
Parking is the exception now, not the answer. It is **not** counted against the consecutive-failure
guard either way — a lost merge race is an ordinary outcome of running six lanes, and counting it
would abort the run for working as designed.

**Nothing is at risk while it resolves, because the work is already committed and pushed.** That is
the premise the whole procedure rests on: the pull request holds the branch whatever the resolution
does to the work tree, `git merge --abort` puts that tree back, and no step below rewrites a commit
that has been pushed. **The merge direction is `origin/main` into the lane's branch, never a rebase**
— a rebase would rewrite pushed commits and need a force push, which this package denies.

1. **Resolve in the lane.** `git fetch origin main`, merge `origin/main` into the lane's branch, and
   resolve in place. Do not close the lane, do not open another, do not switch its branch — reopening
   costs the re-install and the seat, and a switched branch drops the lane out of the registry
   entirely. **`pnpm josh lane:open` can now reattach to a pushed branch** (joshuafolkken/kit#1627),
   so a lane closed by mistake here is recoverable rather than lost; staying put is still what keeps
   the run clear of the question.
2. **Re-run the whole gate.** The tree changed, so the green recorded before the conflict is void:
   `pnpm josh lint:related` and `pnpm josh test:related`, then `pnpm josh gate`.
3. **Review the resolution, one round.** Brief it with `pnpm josh review:brief` and run
   `/code-review` over the resolution diff, then require `pnpm josh review:attest --check` to answer
   `ok`. That round is a different subject from the change under review and does not spend one of the
   two the cap allows — `prompts/review.md` → "Review round cap" carries the exception.
4. **Conclude the merge and push it, with `pnpm josh git -y`.** Without this step nothing changes on
   `origin`: GitHub still returns `mergeStateStatus: DIRTY`, step 5 reports the same conflict, and
   condition 3 reads that as a second one and parks the child for good. Nothing else can do it either
   — the distributed `.claude/settings.json` denies `Bash(git commit*)` and `Bash(git add*)`, so the
   only sanctioned way to conclude a merge is the node script. **Record the resolution on the Issue
   in this same step** — a comment naming the conflicting paths — because condition 3 counts
   resolutions and a merge commit on a lane branch is not something a later poll, or a session
   resuming after an interrupt, can count. Recording it *here* rather than at step 1 is what keeps an
   attempt that ended in a park from leaving a count behind.
5. **Merge**, by re-running `pnpm josh followup` exactly as before.

**The safeguard is the re-run verification, not who holds the pen.** What is dangerous about a
resolution is unreviewed code merging onto a branch whose review has already converged, and that
happens identically whichever hand did the work — so routing the decision to a person does not
address it, while re-running the gate and the review does. **In this repository routing it to a
person does not even resolve it**: the user does not read code, so a code-level conflict handed over
is a deferral rather than a decision, and the same steps get run later anyway.

**The run steps back under these four conditions, and under no others. The list is exhaustive and
carries no judgement.**

1. **The resolution requires deleting the other side's change.** Keeping one side and discarding the
   other decides intended behavior, not text. It goes to the user as a **specification** question —
   "behavior A or behavior B" — never as a diff.
2. **Both sides rewrote the same lines** — overlapping, not adjacent. This is read off the structure
   of the conflict hunks, so it needs no interpretation.
3. **A second conflict on the same child.** One resolution per child; `main` keeps moving, and
   without this bound the child could retry without end. The count is read off the Issue comments
   step 4 writes, never off memory, so it survives an interrupt.
4. **The re-run gate did not come back green, or the resolution review returned a High.** Not only a
   High: a lint error, a failing test or a spell-check hit that merging a moved `main` introduced is
   this condition too. Fixing one would be writing new code after the review had converged, which is
   the thing this section exists to keep out of a merge.

Meeting any of the four, the child is parked — `needs-decision` plus a comment naming which of the
four it was, exactly as "park and continue" below — and its lane is **kept**, because the pushed
branch is the resume path and nothing rebuilds it (the table below).

**Leave the tree clean before parking: `git merge --abort` precedes a park under conditions 1, 2 or
4.** Which of them fired does not change the answer, because none of the three has reached step 4 —
conditions 1 and 2 are read mid-merge with conflict markers still in the tree, and condition 4 is
read after a merge that is resolved but not yet committed. Condition 3 is the one exception, and it
is mechanical rather than a judgement: it fires before any merge is started, so there is nothing to
abort. The pushed branch is untouched by the abort, and the table row these parks take justifies
itself on the tree being clean — parked mid-merge, the lane hands the next poll a half-merged tree,
which is exactly the hazard that made this section refuse to resolve at all.

### What happens to a lane

| When | The lane | Why |
| --- | --- | --- |
| The child **merged** | `pnpm josh lane:close <N>` | `followup` released the hold and the branch is on `main`; nothing in that tree is wanted |
| The child was **parked before its commit** | `git -C <dir> stash push -u -m "epicrun: parked #<N>"`, record it on the Issue, then `pnpm josh lane:close <N>` | The stash is a repository-level ref, so it outlives the work tree — and `lane:close` is a **forced** removal that would otherwise take the work with it. Closing is what keeps the seat free, and it has to happen: `epic:next` already counts a parked child's lane as released, so a lane left open would hold a seat the count believes is free |
| The child was **parked after its commit and push** | **Left open**, its directory and its held seat recorded on the Issue | The stash step is a **no-op**: the tree is clean because the work is already committed. What `lane:close` would take is the **local branch**, and that branch is the resume path — the two sentences under this table are why |
| The child hit a **merge conflict** | **Left open** — the resolution happens in it | The child resolves in place rather than parking ("Conflicts are not predicted" above), so the lane is the one place the work can be finished. Closing it would delete the local branch the pull request already carries, and cost the re-install and the seat to get back — **`lane:open` does now put that branch back** (joshuafolkken/kit#1627), so a lane closed here by mistake is recoverable rather than lost. A park under one of that section's four conditions takes the row above, unchanged |
| The child stopped on **`needs-human-review`** | **Left open and untouched** | The uncommitted work *is* the artifact a person has to look at, so nothing is stashed and nothing is closed. Name the lane directory in the stop report and in the Telegram, or the person is told to look at a tree and not told where it is |
| The child **failed** | Whichever of the two parked rows applies, plus the consecutive-failure count | Same reasoning; only the counter differs. **A merge conflict is not this row**, though `followup` reports it as a failed check: it takes the row above, and it is not counted ("Conflicts are not predicted") |
| **`lane:open` failed on the install** | `pnpm josh lane:close <N>`, then park the child | The work tree was created and its seat allocated before the install ran, so a lane exists that no `pnpm josh …` runs in and the next `lane:open` answers `already-open` rather than retrying (joshuafolkken/kit#1554). Closing frees the seat; parking is right because the causes — an outdated lock, an unreachable registry — are ones a person fixes. Carry pnpm's reason, printed on standard error, into the park note |
| The run was **interrupted** | Nothing to do — the work tree survives on disk | The next session's `pnpm josh lane:prune` closes what git no longer has a tree for, and `lane:open` answers `already-open` for what is still there. **Park that child**, naming the lane and `pnpm josh lane:close <N>` as the way out: resuming somebody's half-finished lane unattended is the judgement `run:preflight` refuses to make on its own, and in a lane there is no command to make it |

**A committed child's lane is kept because it is the cheapest resume, not because closing it is
final** (joshuafolkken/kit#1587, corrected by joshuafolkken/kit#1627). Two mechanics decide it, and
neither is a judgement. `lane:close` does not stop at the work tree: `remove_lane` follows the
removal with `git_worktree.branch_delete(targets.branch)`, which runs `git branch -D <N>-lane`
(`scripts/lane/lane-close.ts` → `remove_lane`, `scripts/git/git-worktree.ts` → `branch_delete`) — the
force flag is there precisely so an unmerged lane branch, which is every parked one, goes too.
Resume for this child is a re-run of `pnpm josh followup`, and that reads the branch **locally**:
`read_branch_paths` is `changed_paths.to_paths(await git_command.diff_main_names())`
(`scripts/git/git-pr-managed-config.ts`), a `git diff` against the merge base in the work tree, so
with no local branch the gate cannot be re-evaluated at all. **Keeping the lane is therefore worth a
seat**: the tree, the branch and its `node_modules` are all still there, and the resume is one
command.

**What is no longer true is that closing it is unrecoverable** (joshuafolkken/kit#1627). Until then
`pnpm josh lane:open <N>` hardcoded `['add', '--no-track', '-b', branch_name]` off `origin/<default>`
and would cut a **fresh, empty** branch of that name over the pushed one — silently, once
`branch_delete` had removed the local branch. It now attaches to a `<N>-lane` that exists locally and
creates one from `origin/<N>-lane` where only the remote has it, saying on standard error which it
reused ("Opening one lane" above). So a lane closed by accident after a push is reopened rather than
lost, and what closing it costs is the re-install and the seat rather than the work. **The branch
still has to have reached the remote for that to hold** — a child parked before its commit has
nothing on `origin`, which is why that row stashes first and this one does not.

**Which of these rows a child takes is decided by what `followup` printed, not by reading the
situation.**
**What it prints is `PR checks failed (merge conflict)`** — that string, and nothing else, is what
reaches you; `mergeStateStatus: DIRTY` is the internal spelling `git-pr-checks-eval.ts` compares
against and the one "Conflicts are not predicted" above uses, never an output line to search for.
**What that string names is no longer a park at all** (joshuafolkken/kit#1623): the named failure
sends the child to resolve the conflict in the lane it is already standing in, so the pushed branch
is precisely the resume path and the lane is kept — the row for it above. Do not grep the output for
`mergeable_state`: that is the REST field name, normalized away by `git-gh-pr-snapshot.ts` before
anything prints it. **Every after-commit park now keeps its lane, with no exception left in this
table** — one of the four conditions in that section, a gate this run may not waive, a standing High
finding, a Tier B or Tier C decision: each resumes from the branch exactly as it stands.

**A kept lane holds its seat, and that is the price rather than an oversight.** Seats are not kept in
a ledger; they are read back out of the live work trees (`scripts/lane/lane-registry.ts`), so the
allocator itself stays honest and `lane:open` answers `full` rather than handing out ports twice. The
optimism is `epic:next`'s alone — it counts a parked child as having released its lane — and what it
costs is one child offered that cannot get a lane, which is visible and recoverable. **Say it in the
park comment**: the lane directory, that its seat is held, and `pnpm josh lane:close <N>` as the way
to give the seat back once the child is finished or abandoned. A seat held by a lane nobody recorded
is the failure here, not the holding.

**Release the hold on either parked arm, and leave the lane before closing it.**
`pnpm josh followup` releases the working-tree hold at the **merge**, so a parked child's is still
held: run `pnpm josh run:release` in the lane, whether that lane is then closed or kept. **A
`needs-human-review` stop is not a park and keeps its hold** — the uncommitted work still in that
tree is exactly what a second run would trample, which is the rule `halfrun`'s stop before commit
already carries. `lane:close` does not do it for you — the record is a
file in the system temp directory keyed to the work tree's git directory
(`scripts/run/run-hold.ts` → `hold_path`), so removing the tree strands it, and the next run for that
issue is answered `busy` by a lane that no longer exists. And `cd` out of the lane **before**
`pnpm josh lane:close <N>`: the close removes the directory the shell is sitting in, and every
command after it fails with `getcwd: cannot access parent directories`.

**A `needs-human-review` stop ends the run, and the lanes already in flight are allowed to finish.**
No new lane is opened — "the remaining children are not started" is unchanged — but killing units
that are mid-gate would strand as many trees as there are lanes, which is the opposite of what that
stop is for. When the others have merged or parked, report and stop.

### CI concurrency — recorded as to-be-measured

Six lanes push six branches, and each push starts `playwright-image`, `checks`, `security` and
`e2e-detect` at once, with `e2e` behind two of them — so **the peak is about four jobs per run and
about twenty-four across six lanes**, not thirty: `e2e` never runs beside the two jobs it `needs`.
GitHub-hosted runners carry a per-account concurrency entitlement, and past it jobs **queue** rather
than fail — which lengthens CI waits and could cancel out what the lanes bought.

**This is recorded as to-be-measured rather than addressed, and the reasons are these.** The number
to compare against is the account's entitlement, which is not readable from this repository; the
arrivals are staggered rather than simultaneous, because children start minutes apart and reach CI at
different points; and the one lever that responds needs no code at all — `JOSH_LANE_LIMIT` lowers the
ceiling immediately. Building a throttle before the measurement would be sizing a solution against a
number nobody has.

**What settles it is already printed.** `pnpm josh followup` reports `followup stage: checks-wait` on
every run (joshuafolkken/kit#1349) and every merged run is appended to `.time-history.jsonl`
(joshuafolkken/kit#1471), so the comparison is `pnpm josh time --period <days>` before and after: a
`checks-wait` that grows with the lane count **is** the queueing, and one that does not is the answer
that no throttle is needed. **One thing about the workflow is already right** — `ci.yml`'s
concurrency group is keyed on `${{ github.ref }}`, with the commit sha appended on a push to the
default branch (joshuafolkken/kit#1481), so N lanes on N branches are N independent groups and no
lane cancels another's run — nor does one lane's merge cancel the main run of the merge before it.

### The wall-clock comparison, and the half of it that is still missing

**Baseline, measured on 2026-09-06 before any lane existed** (`pnpm josh time --period 1`): 6 runs
across 2 lanes over a 337-minute window — **1.3 effective of 2 lanes, 1.07 runs per hour** — with a
per-child wall clock of 20–46 minutes.

**The "after" is not in this document, and saying so is the point.** It needs a real multi-lane epic
run, which the single-lane run that wrote this procedure could not produce. **Take it with
`pnpm josh time --period <days>` after the first epic actually run through lanes** and put the two
side by side: runs per hour and effective lanes are the figures that answer whether this changed
anything, with `checks-wait` beside them answering the section above. Until that reading exists, no
claim about the speed-up is a measured one.

## Audit before the first child

Run `pnpm josh epic:audit <E>` before step 1 below. **When the run began from a bare Issue there is
nothing to audit yet** — it has no task list, and `epic:audit` refuses one just as `epic:next` does;
that path runs the audit at the moment it creates the epic instead (above). An epic whose children contradict each other —
an acceptance criterion that needs something built later, two children each waiting on the other —
stalls the moment the run reaches the contradiction, and unattended is the worst time to find that
out. Errors stop the run; warnings are read and carried on past. Fixing what it finds is Tier A
(joshuafolkken/kit#870).

## `josh latest` runs once per session, not once per child

`josh latest` belongs to the **session**, not to a child. Ask once, the first time the loop below
hands back a child number — before implementing that child — and never again:

```bash
pnpm josh latest:scope   # → required | skip ; the reason on stderr
git stash push -u        # only if the tree has staged or modified files — never conditional on the answer
git switch main && git pull
pnpm josh latest         # on `required` only
git stash pop            # only if you stashed above
```

On `required`, load the `dependency-update` skill and follow its procedure, exactly as `queue` does —
the overrides in **both** `pnpm-workspace.yaml` and `package.json`, and the one expected `devEngines`
pnpm bump. The stash is the same sanctioned one `queue` step 1 uses; without it `josh latest` runs
on a dirty tree. **The answer is the command's, never a judgement**, and `latest-gate.md` is its
single source — the session hoist here is preserved by it rather than replaced, because a second
child asking the same command is told `skip`.

**Session, not run** — the two differ whenever an epic spans repositories. Each session runs one
repository's children (above), so each one updates its own checkout: a second session that read
"once per run" and skipped it would merge that repository's children against stale dependencies and
never run `pnpm audit` there.

**Waiting until a child is in hand is what keeps the tree clean.** Run it before the first
`epic:next` instead and a run whose first answer is `wait`, `stop` or `complete` — an ordinary
outcome on a resumed run — leaves a rewritten `pnpm-lock.yaml` modified on the default branch with
nothing to commit it, which the next `git pull` then refuses to merge over.

A child's own `fullrun` asks `pnpm josh latest:scope` before implementing, so following the loop
literally asks it once per child — and before the elapsed-time window existed, ran the update every
time. That is what this section overrides, and the reason is not the seconds it
costs: **each run rewrites `pnpm-lock.yaml`, so every child's PR carries dependency updates that
have nothing to do with that child.** `/code-review` and CodeRabbit then read that diff, a CI
failure caused by an unrelated bump is attributed to the child — parking it, unattended, for a
defect it does not have — and the eslint cache key in `.github/workflows/ci.yml`
(`hashFiles('pnpm-lock.yaml')`) misses on every PR.

**The lock file the update rewrites lands with the first child.** `josh latest` leaves
`pnpm-lock.yaml` modified, and the first child's `pnpm josh git -y` commits it — so that one PR
carries the dependency bumps, exactly as the first issue of a `queue` does. What the hoist removes
is the other N-1 children carrying them; it does not make the first child's diff clean. Should the
first child then fail CI on a bump rather than on its own change, that is a dependency problem
found once — fix it forward before the child is parked for it.

**`git switch main && git pull` stays per child.** It is not hoisted with `josh latest`: it is what
brings the previous child's merge into the tree, and a child that skips it starts implementing on a
stale main. Only the dependency update moves to the run.

**In lanes it stays per child and changes hands.** No lane can switch to the default branch — it is
checked out in the main work tree — so the parent runs it in the primary checkout **before each
`lane:open`**, which is the ref that lane is cut from. Same job, same frequency, different context:
"Lanes — running more than one child at a time" above.

**And in a lane `josh latest` is not even asked.** A lane's `latest:scope` is keyed to its own
project root, so it has no stamp and always answers `required` — six lanes, six dependency updates,
which is this whole section's failure one layer down. The reason and the stash that carries the lock
file into the first lane are in "Once per repository, before the first lane opens" above.

This is the same rule `queue.md` step 1 already states — the dependency update once, before the
first issue, and asked of `pnpm josh latest:scope` rather than decided. Two entry points to the same
serial batch now read the same way; they disagreed before (joshuafolkken/kit#913).

**A resumed `epicrun` is a new session**, so it asks once again before its first child. The state
that decides which children remain lives on GitHub, and the tree the resumed session finds may be
days old — which is exactly what the window answers: a session resumed within it is told `skip`, and
one resumed a day later is told `required`.

## Preflight — reclaim what an interrupted run left, before the next child starts

**An unattended run ends abnormally.** A crash, a Ctrl-C, a laptop asleep, an expired token — and
what it leaves is not a stale label but a **working tree**: its feature branch, its open pull
request, its uncommitted changes. joshuafolkken/kit#920 covers the *planned* wind-down, and
"`in-progress` is removed by whoever finds it stale" covers the label. **Nobody was looking at the
tree**, and the loop below opens every child with `git switch main && git pull`, which refuses over a
dirty one — while an agent may not reach for `git stash` on its own judgement. So an unattended batch
could not recover from its own crash (joshuafolkken/kit#926).

**Ask, the moment `epic:next` hands back a number and before the child is started:**

```bash
answer=$(pnpm josh run:preflight 926)   # alias: josh rp ; one token on stdout, prose on stderr
```

| Answer    | What it found                                                         | What to do                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clean`   | Nothing left behind                                                   | Start the child. This is the ordinary answer and costs one command.                                                                                                                                                                                                                                                                                                                                                                                     |
| `reclaim` | Uncommitted changes, or HEAD off the default branch                   | Run what stderr printed: `git stash push -u -m "run:preflight reclaimed before #<N>"`, then `git switch <default> && git pull`. **`-u` is not optional** — the leftovers almost always include a new `*.test.ts`, which is untracked, and a stash without it leaves exactly the files the switch then refuses over. **Then record the stash on `#<N>` as a comment, and ask again**: the command is re-askable, and the clean tree gets its own answer. |
| `resume`  | A branch for `#<N>`, or an open pull request, is still here           | **Reuse it and run the whole verification gate from the start** — refactor, `pnpm josh gate`, `/code-review`, all of it — never only the part the interrupted run had not reached. The tools are already idempotent (`git-branch.ts` switches to an existing branch, `git-pr.ts` updates an existing pull request), so what was missing was never the tooling; it was that **nobody had verified what the dead run already committed**.                    |
| `park`    | The pull request for `#<N>` is **merged** or **closed**               | **Park the child** — `needs-decision` plus a comment naming what was found — and continue with the next one. Carrying on over a merged pull request duplicates work that already landed; carrying on over a closed one revives work somebody rejected. Which of those is happening is a person's read. Do not delete the branch, do not reopen the pull request, and do not commit on top of it.                                                          |
| `unknown` | The tree could not be read                                            | Stop the session and report. It is not "the tree is clean".                                                                                                                                                                                                                                                                                                                                                                                             |

**The rule answers, so the run does not judge.** "There is a branch already, I will carry on from it"
and "there is a branch already, I had better stop" are both defensible in the moment, which is
exactly why the choice is not left to the moment — the same reason `pnpm josh delegate` and
`pnpm josh review:level` refuse to leave their answers to an agent.

**The `git stash` above is one of the flows that authorizes automatic stashing**, enumerated in
`prompts/collaboration-workflow/operating-rules.md` → the `git stash` bullet. **It is the one entry
there that is not followed by `git stash pop`**: what is being stashed belongs to a run that is gone,
not to the run doing the stashing, so there is nothing to restore it into — **the Issue comment is
the only thing that can ever bring it back**, exactly as it is for a prerequisite stop.

**It is not `run:hold`, and neither replaces the other.** `run:hold` asks *whether another live run
owns this tree* and is claimed once, per child, by the `fullrun` procedure each child follows; this
asks *what a dead run left in it* and is a read that writes nothing, so it is **re-askable** — which
is what makes "reclaim, then ask again" a procedure rather than a `busy` answer. Ask this one first:
a tree still holding an interrupted run's uncommitted work makes `run:hold` answer `busy`, and the
preflight is what turns that into something the batch can act on.

**Report what was reclaimed.** A child that started from a `reclaim` or a `resume` says so in the
run's summary, with the stash reference where there was one — a reclaim nobody mentioned is
indistinguishable from a run that never crashed.

**It is not asked in a lane.** Every lane's HEAD is on `<N>-lane` rather than the default branch, so
the `reclaim` arm fires on all of them and the recovery it prints cannot run in a linked work tree.
What replaces it there is `lane:open`'s own answer, in "Opening one lane" above. This section is
unchanged for a child implemented in the session's own checkout.

**Asked in the primary checkout while a lane for that child is open, it answers `resume`, and that
is correct rather than a false positive.** The branch read is `git branch --list '<N>-*'`, which
`<N>-lane` now matches (joshuafolkken/kit#1497) — so the answer says a branch for this issue exists,
which is exactly true. The loop never reaches it that way, because `epic:next` does not offer a
child already carrying `in-progress`; a person asking by hand is being told where the work is.

## Progress while the run is quiet

**Start the progress step before step 1 of the loop, and do it without being asked.**

```bash
pnpm josh run:progress --wait --output <the transcript path of each delegated unit>   # in the background
```

**`--wait` waits one silence interval out, prints one line and exits — and the exit is what makes
the line arrive.** Standard output is relayed into the session as it appears **only where the
harness streams it**; a harness that delivers a background command's output *when that command
exits* — Claude Code is one — relays nothing at all from a watcher that never exits, so a run that
followed the earlier wording started a watcher and then went 2h36m without a single progress line
with children in flight (joshuafolkken/kit#1576). The long-running form, `pnpm josh run:progress`
with no `--wait`, is still the right one where output really is streamed; it is not the one to start
here. The parent changes no value on the line and asks nothing to produce it.

**The step the parent repeats, named so a session that has read only this can run it.** Every
interval is these three moves and there is no fourth:

1. Start `pnpm josh run:progress --wait --output <transcript paths>` **in the background**.
2. When it exits, **present what it printed in the labelled form below**, and close that
   presentation with the next report time.
3. **In that same turn, start the next one.** The interval is measured from the last report, so the
   next `--wait` waits a full interval from the line just relayed and nothing else has to be timed.

**The line is presented with a label in front of every field, never handed over as it was printed.**
What the command emits is one `·`-joined run of values with no labels on any of them — seven fixed
fields and one further segment per child in flight, so the count moves with the run —
`⏳ at 2026-09-09 13:27+07:00 / 2026-09-09T06:27Z · quiet 29m · #1631 in-progress,route:split PR:open · lanes none · load 4.7 · record unread · unchanged 0m · next 2026-09-09 13:47+07:00 / 2026-09-09T06:47Z` —
and a person reading that cannot say what `record unread` or `unchanged 0m` refers to
(joshuafolkken/kit#1650). The verbatim rule this replaces was protecting something real — that the
run must not dress up what it observed — but **handing over an unreadable line does not achieve
it**, because a report nobody can parse informs nobody. Presentation and content are two questions,
and only the second one the verbatim rule was ever about.

**Four field lines, in this order, and a fifth for the next report time.** The grouping is fixed so
that a reader who has seen one report can find a field in the next without re-reading it:

1. **the observation instant** — the `at` stamp, copied across exactly as printed, local first and
   UTC beside it;
2. **how long it has been quiet**, and **how long the observation has been unchanged**;
3. **the children in flight** — each one's number, its labels and its pull request state;
4. **the lanes, the load average, and the unit-output age** (the `record` field).

**The fifth line is the `next` field, copied across the same way** (joshuafolkken/kit#1726). It is
the one line that is about a moment yet to come, which is why it closes the presentation and carries
the schedule wording above rather than being read as an observation.

**Every value is carried across unchanged; the presentation adds a label and nothing else.** No
rounding, no rephrasing of a value into a state, no figure the line did not carry. **Naming a field
is not interpreting it**, and the boundary between the two is the whole of what the verbatim rule
was defending: `quiet 29m` may be labelled *quiet* and may not become *stalled*.

**Never present an unmeasured field as a measurement.** `record unread` means **no `--output` path
was given**, and it is presented as that — never as *not stalled*, which is a measurement the
command did not take. `lanes none` is *no lane is open*, never *nothing is running*. The section
already forbids printing a verification result the command never read, and this is that same rule
arriving at the fields it actually reads.

**The presentation closes with the next report time, written as an absolute instant in both
clocks** — `2026-09-09 13:42+07:00 / 2026-09-09T06:42Z`, the same form the stamp itself uses. What a
person wants from a heartbeat is when to look again, and a run that leaves it out is asked for it
every time. **It is printed, and the presentation copies it** (joshuafolkken/kit#1726): the line
carries a `next` field of its own, so this value is transcribed exactly as `at` is and **is never
computed, rounded or filled in**. It used to be derived — the `at` stamp plus the interval in force —
and a time worked out by hand is eventually worked out wrong: one report reached a person as `20:1x`,
placeholder digits and all, which is what filed the Issue. **Both inputs were already the command's**,
so the derivation was asking a run to redo arithmetic the printer could do once; this is the move
`run:preflight`, `delegate`, `review:level` and `latest:scope` each made for their own judgement.
**It stays labelled as a schedule rather than reported as a fact**, and the two conditions ride with
it in the same line: it is the time *if the silence continues*, and a real report arriving first
resets the clock through `--mark` and supersedes it. **A line with no `next` field on it gets no next
report time in the presentation** — say that the field was absent, never a time of your own.

**The presentation stands where the relayed line stood, and is not an addition to it.** Its five
lines are that one line rendered readably, and the two lines of the run's own prose that "What the
run itself writes on a quiet tick" allows below are counted separately and are unchanged. **The turn
does grow — about one line to about five — and the fixed shape is what stops it growing further**:
joshuafolkken/kit#1567 measured the *run's own* prose as the expensive half, and five lines with no
table and no re-listing of children is a cost that does not compound with the run's length.

**It exits only when it has a line to hand over**, or when `--hours` runs out with the run never
having gone quiet for a whole interval — and that second exit says so on standard error rather than
printing a progress line. **Nothing in flight keeps it waiting rather than ending it**, because
returning there would hand this loop an instant answer to restart, and step 3 would make that a poll
instead of a heartbeat.

**It starts by itself, and that is the requirement rather than a convenience.** Until
joshuafolkken/kit#1520 the person had to type "give me progress reports" at the start of every run,
which moved the polling this reporting exists to remove from the report to the report's *start* —
so the work was done and the person was still typing. A run that has to be asked has not solved it.

**`--mark` at every real report.** Whenever this loop reports something of its own — a child merged,
a child parked, a stop — run `pnpm josh run:progress --mark` in the same turn. That restarts the
silence clock, which is what keeps a heartbeat from landing immediately behind a real report, where
it would be noise rather than news. The clock is silence, never a timer; the command's own reference
is `docs/josh-commands.md` → "`josh run:progress`".

**Do not keep a progress clock of your own, and the hook refuses an arm rather than asking you not
to** (joshuafolkken/kit#1570). The step above owns the clock: it wakes on its own and prints when the
run has been quiet for the interval, so a `Bash` call that only sleeps adds a second clock nobody
reconciles. That is what happened — a timer was armed on the turn a timer fired **and** again on the
turn a delegated child's completion woke the run, so two ran at once and each produced a report the
other knew nothing about; the interval was set to fifteen minutes and reports arrived 3–5 minutes
apart. **The promise was kept and the interval was not**: `--mark` was called at every real report,
and nothing read the marked clock before the next report was written. So the refusal is put in front
of the **arm** rather than in front of the report — a report is prose and no hook can see it coming,
while the call that sleeps is a call. `pnpm josh rule:guard` refuses it when a timer it allowed is
still live, or when the report that timer would produce would land before the interval is up.

**What the hook refuses, written exactly as it decides** (joshuafolkken/kit#1576).
`scripts/rules/early-heartbeat.ts` → `decide` refuses a `Bash` call whose every segment is a `sleep`
on three tests — a timer it already allowed is still live, the report that timer would produce would
land before the interval is up, or the wait runs longer than the interval — so **a single
correctly-spaced arm is allowed**, where this section used to say that none ever was. The document
was the half that was wrong, and the cost of the disagreement was paid the obvious way: a run that
obeyed the sentence went silent, and a run that broke it reported. **The allowance is still not the
way to report** — it is what is left over after the three refusals, while the step above waits and
prints without arming anything, and `pnpm josh run:progress --wait` is not a wait timer and never
matches the trigger at all.

**The default interval is twenty minutes, and it is overridable — by the person, not by the run.**
Set `JOSH_PROGRESS_INTERVAL_MINUTES` and both sides move together: the guard reads that variable
through the same reader the watcher does, so the floor it enforces is the interval the run was told
to keep. **The interval travels with the repository too**: `josh` → `progress_interval_minutes` in
`package.json` is read by that same reader, one step below the variable, so a cadence set once is
the cadence on every machine and in every cloud session — which a non-committed `.env` can never be
(joshuafolkken/kit#1576). The variable still outranks it, because a person's own machine is allowed
to differ from what the repository asks for. **`--interval` moves the watcher alone** — a hook has no command line to read — so it can
only make the watcher quieter than the floor, never the guard stricter; a run that wants a different
cadence sets the variable rather than the flag. Twenty rather than ten because a child measures 20–46
minutes: one to two reports per child, each with a stage change in it.

**An explicit ask is not a heartbeat, and it is exempt by construction rather than by exception.**
What is refused is arming a *timer*. A person asking "how is it going" arrives as a turn with no timer
in front of it, and `pnpm josh run:progress --once` prints one line whatever the clock says — so there
is no exception to write and none to get wrong.

**It is answered with that line, in the presentation form above, and nothing else supplies a time**
(joshuafolkken/kit#1726). **The rule exists because the two reports that broke were the two nobody had
written a rule for**: on the run that filed the Issue all four periodic reports carried real clock
times, and the two that carried placeholder digits were the reply to "how is it going" and the
situation note written just after the run started. A format defined for one shape of report and not
for the other is not a narrower rule — it is a gap, and the violations collected in it.

- **Run `pnpm josh run:progress --once` and present what it prints**, in the same five field lines.
  The `at` stamp and the `next` field are both on that line, so neither is worked out.
- **Every progress statement this run makes takes this route** — the reply to an explicit ask, the
  note written just after a run starts, and any other unscheduled "where are we". The periodic report
  keeps its own step above, which already ends in this same presentation.
- **Never write a clock time the command did not print.** Not an approximation, not a rounded one, and
  above all not a placeholder — `20:1x` is not a time, and a reader has no way to tell one invented
  digit from an observed one. Where a field is missing, say it is missing.
- **`--once` records the report**, so the watcher does not repeat it moments later. That is the
  command's own behavior and needs no `--mark` beside it.

**A live timer is counted from the record the guard
writes when it allows one**, never from the `sleep` processes on the machine: a process count cannot
tell a heartbeat timer from a build step that sleeps, and a timer killed with its shell would leave
the count wrong for the rest of the run.

**Every report this run writes opens with the time the observation was taken.** Not only how long it
has been quiet: the heading carries an absolute instant, in the same form the watcher prints —
`at YYYY-MM-DD HH:MM±HH:MM / YYYY-MM-DDTHH:MMZ`. A relative figure means something only while the reports keep coming, and
unattended execution is made of the events that break exactly that assumption — a suspend, a rate
limit, a restarted process. `epicrun #1474` was suspended overnight, resumed, read its own
`quiet 11m` as if no time had passed and concluded the machine's clock was broken; it was correct to
the second against GitHub's own `Date` header, and an absolute time in the report would have settled
it at a glance (joshuafolkken/kit#1560). **The date is part of it**, because that confusion happened
across a day boundary and a bare clock time would have left the same hole open. **The local clock
leads and UTC is printed beside it, with the offset that ties the two together** — this line used to
carry UTC alone, and on a machine seven hours ahead every stamp in the report was a number the reader
had to convert before it meant anything, which is joshuafolkken/kit#1560's own failure arriving from
the other side: a stamp nobody can place is a stamp nobody reads. **UTC is kept rather than
replaced**, because the reason it was pinned is real and unchanged — the line is relayed to other
machines and read in cloud sessions, and joshuafolkken/kit#1245 already paid for a timestamp rendered
in the reader's zone making one process look like a stranger. Printing both costs twenty-five characters
and leaves neither reader guessing, which is why neither half is dropped. **It is added, never substituted for the elapsed figure**:
how long it has been quiet and when the observation was taken are two different facts, and neither
can be reconstructed from the other. **The presented line needs no stamp computed for it** — `josh
run:progress` prints this one itself, so the presentation's observation field copies that stamp
across rather than deriving a second one, and the rule above still holds exactly as written. **The
next report time is printed on the same line and copied across with it** (joshuafolkken/kit#1726) —
it used to be the one instant the presentation derived, and deriving it is what produced a report
carrying `20:1x`. It is still labelled as a schedule rather than as an observation, because it is the
one field about a moment that has not happened yet.

**The line carries observations, never "still running".** Children in flight with their labels and
their pull request state, the open lanes, the load average, how long the newest unit transcript has
gone without growing, and how long that whole set has been identical. **Nothing in it is a
verification result** — no gate, no CI, no check rollup — because the command reads none of them, and
a result nobody read must never be printed as one.

**It goes to the session only.** No Telegram: the existing `confirmation` and `completion` messages
are what interrupt a person, and a heartbeat every twenty minutes beside them would cheapen both.

**Nothing is reported while no child is in flight**, so a run parked on a decision goes quiet rather
than repeating itself, and the first child to start is reported at once.

**The scope is every implementing run, not this command alone** (joshuafolkken/kit#1546). `fullrun`,
`queue` and `halfrun` start the same watcher under the same rules, and this section is the single
source for all four entry points: what changes between them is only where the watcher starts and
what counts as a real report, and both are written here rather than in each command's own file,
because three copies of one procedure drift. `kickoff` starts none — it plans and stops, so there is
no silence to break.

**`halfrun` is included, and the reason is that the trigger is silence rather than command
identity.** It stops before the commit, so it never waits on CI and never merges — but it still
implements, runs the whole gate, takes both review rounds and runs `pnpm josh test:e2e` itself,
which is most of the 20–46 minutes a `fullrun` was measured at. It also ends by asking the person
for something, so a signal that the stop is coming is worth more there than less.

**One watcher per run, and the outermost invocation is the one that starts it.** A `fullrun` running
as a `queue` issue or an `epicrun` child starts none: the brief names the invocation it descends
from, so a unit can always tell that it is not the outermost, and a watcher started there would
print into the unit's context instead of the session the person is watching. `queue` therefore
starts one for the whole batch, before its first issue, and never one per issue.

**In a single-issue run it starts immediately after `pnpm josh run:hold` succeeds** — the first
point at which the run is committed to running, which is the same place in the order that "before
step 1 of the loop" is here. Nothing is reported until the issue carries `in-progress`, so the
window before the label costs nothing and needs no special case.

**It is started in the target repository's checkout, and `--mark` is run there too.** A
cross-repository reference — `fullrun joshuafolkken/app-kit#12`, `queue joshuafolkken/app-kit#12
#13` — is implemented in that repository's checkout, which is where a `fullrun` claims its hold and
where a `queue` runs every one of its issues. Started in the session's own tree instead, the watcher
would read *this* repository's `in-progress` listing, where none of the run's issues appear, and the
run would go silent for its whole length or report an unrelated issue that happens to carry the
label as its own progress. **`--mark` follows the watcher**, because the report record is kept per
work tree: a mark written in the session's own tree leaves the watcher's clock untouched, and the
heartbeat lands on the heels of the real report the mark exists to move it off. Starting it there
also points the lanes, the load average and the transcript sample at the tree the run is editing,
which `--repo` alone cannot do.

**What counts as a real report when the run has one issue.** A child merged or parked is this loop's
unit and a `fullrun` has exactly one child, so the unit there is instead **any turn that puts a
progress statement in front of the person**. There are four, and `pnpm josh run:progress --mark` is
run in the same turn as each: **the Step 0 work summary, the pull request opening, each review
round's verdict, and any `confirmation` / `failure` / `completion` notification or stop.** **A tool
result only you read is not one** — a gate run, a `gh` read, an edit — which is the same
discriminator this loop already applies, and marking on those would hide the silence the interval
exists to measure.

**What the run itself writes on a quiet tick.** The presentation of the line is already bounded at
five lines by the rule above; what costs beyond it is the prose the run writes around it. joshuafolkken/kit#1567 measured the executing side's own text at
**27.9%** of everything accumulated in a parent's conversation — the largest single source, ahead of
tool results and ahead of thinking — so a progress turn that reprints the epic's table of remaining
children pays for that table on every request the run has left.

**A tick is quiet when none of the real reports happened since the last one**, which makes "no
change" the complement of a set that is already enumerated — a child merged, a child parked, a stop,
and for a single-issue run the four named above — and so it needs no second definition of its own.
**Nothing else counts**: a gate that went green, a review round that ran, a file that was edited, a
poll that answered `wait`. Those are the run working, which is what the silence interval already
assumes.

**On a quiet tick the turn is the relayed line plus at most two lines of the run's own prose**, and
those two say only what changed stage and what is being waited on. **"The relayed line" there is the
presentation defined above**, whose four field lines and closing next-report line are that one line
rendered readably rather than an addition to it; the two prose lines are the run's own and are
counted apart from it. **No table, no re-listing of the remaining children, no restating of the
plan** — `epic:next`, the epic body and the progress comment hold all three, and a person who wants
them opens the epic. A tick with genuinely nothing to add presents the line and writes nothing at
all.

**A real report is not bounded by that**, and `--mark` is why: it restarts the clock at every one, so
a merge, a park or a stop is exactly where the run is allowed to be long.

**`--output` is omitted in those runs, and `record` reads `unread`.** The flag fixes one set of
transcripts for the watcher's whole life: a single-issue run in the session's own context has no
delegated unit to name, and a queue's unit changes with every issue, so a path fixed at the start
would go on ageing a finished unit's file and report a run that had long moved on as stuck.
`unread` is the command's defined answer for "no path was given" rather than a guess, and every
other field on the line is unaffected.

**A run that merges needs no teardown, and a run that stops has to end the reporting itself.** The
issue leaves the `in-progress` listing at the merge, so whatever is still waiting prints nothing by
the rule above and `--hours` ends it. **A stop keeps that label on purpose** — that is
what makes the stop resumable — so **no further `--wait` is started** after the stop notification,
and any long-running watcher still in the background is stopped in the same turn, or it reports for
up to eight more hours into a session that is waiting on a person. That covers
`halfrun`'s stop before commit, a `needs-human-review` stop, a split or prerequisite stop, and
`queue`'s failure stop.

## The loop

`josh epic:next <E> --repo <this repository> --lanes` prints **one issue number per line** on
standard output — as many as that repository has free lanes — or, when there is no child to run, the
verdict as a single token. Everything else goes to standard error, so what a shell captures is the
list. Without `--lanes` the answer is a single token either way, which is what a caller deliberately
running one child at a time still gets.

```bash
answers=$(pnpm josh epic:next 858 --repo joshuafolkken/kit --lanes)
# one issue number per line, up to the number of free lanes; a verdict token when there is none
answers=$(pnpm josh epic:next 858 909 --repo joshuafolkken/kit --lanes)
# every named epic, merged into the same pool — "Several epics in one run" above
```

**`--lanes` is the form to use.** A lane's branch is `<N>-lane`, which `pnpm josh git` commits from
(joshuafolkken/kit#1497), so a child handed a lane runs the whole `fullrun` procedure inside it —
there is nothing left to work around and no reason to drop back to one child at a time. Read a line
per child, and treat a single non-numeric line as the verdict.

1. Run the command above.
2. **One or more numbers** — where the child runs in this session's own checkout, **first ask
   `pnpm josh run:preflight <N>` and obey it** ("Preflight — reclaim what an interrupted run left"
   above): `reclaim` is recovered and the command asked again, `park` parks
   this child and returns to step 1, `unknown` stops the session, and `resume` starts the child on
   the branch that is already there with the whole verification gate re-run. **In a lane it is not
   asked at all**, and `lane:open`'s own answer replaces it — "Lanes — running more than one child at
   a time" above is where that lane is opened, installed and handed over. **Everything from here on
   is per child**: with several in flight each one is confirmed, counted and closed on its own, and
   step 1 is asked again once a lane comes free rather than once the last child returns. Either way
   the child then runs as `fullrun #<N>` does, through the verification gate and the
   merge, **in a delegated unit where one is available** (`pnpm josh delegate epic-child` →
   `delegate`; see "Each child runs in a delegated unit" above) and **in this session's own context
   where none is**, **except that `josh latest` is not run** and **no progress watcher is started** —
   the first runs once, before this session's first child, and not again (above); the second is this
   loop's, started before step 1, and a child that started its own would share this work tree's
   silence clock and mute the parent's line (joshuafolkken/kit#1546).
   `git switch main && git pull` runs per child in whichever context implements it, **and again in
   this session afterwards** when the child was delegated — otherwise the parent's checkout never
   receives that merge and the next child starts on a stale default branch. **In a lane the child
   cannot run it at all**, so it is the parent's, immediately before that lane's `lane:open`.

   **Start the unit without blocking on it, record where it writes — `pnpm josh lane:output <N> <path>`
   when the child runs in a lane — and poll.** Blocking on the return
   leaves the parent with no turn in which to notice that the return is never coming, which is the
   whole of "A delegated unit that stopped without reporting" above. Poll at the polling interval; ask
   `pnpm josh run:liveness <N> --output <path> --process none` (or `--process alive`) once that file has been unchanged
   for the silent-unit window.

   When the unit reports back, **confirm the child from GitHub before believing it**:

   ```bash
   pnpm josh issue:state <N>                          # a child in this repository
   pnpm josh issue:state <N> --repo <owner/repo>      # a child in another one
   # state: CLOSED
   # labels: (none)
   # human_review: no
   ```

   **`--repo` is not optional for a cross-repository child.** Without it the read resolves `<N>`
   against the repository this session runs in, and confirms a completely different issue that
   happens to carry that number — silently, because that issue usually exists.

   `state: CLOSED` is the only answer that means the child finished. **Read the `human_review:` and
   `labels:` lines before calling anything else a failure**, because three different outcomes look
   alike from here — which is why one command prints all of them rather than three reads being made.

   **A non-zero exit is not `OPEN`.** The command exits non-zero without printing a state when the
   number resolves to nothing (`does not resolve`) and when the read itself failed (`could not
   read`), and the second is a rate limit or expired auth rather than anything about the child.
   Treating it as an unfinished child would count an environment fault against the
   consecutive-failure guard. Re-read before deciding.

   - **Open, carrying `needs-decision`** — the unit **parked** it, exactly as this session would
     have. That is not a failure: leave the label on, do **not** count it against the
     consecutive-failure guard, and go back to step 1. Three parks in a row are an ordinary epic,
     and counting them would abort the run as an environment fault.
   - **Open, and `human_review: yes`** — the child **stopped before its commit**, which is the run's
     own ending rather than a failure (§2z). **`Open` is part of the test, as it is for the two
     branches below**: a CLOSED child carrying the label finished and merged, so it is `state:
     CLOSED` and nothing else — reading it as a stop would strand `in-progress` on a closed issue,
     end the epic without its remaining children, and report a stop that never happened over an
     artifact that has already shipped. **Read that line, not the `labels:` one**: GitHub keeps the
     spelling a label was created with, so `Needs-Human-Review` is the same label, and matching the
     lowercase string by eye drops the child into the failure branch below — the label is stripped,
     the stop counts against the consecutive-failure guard, and the next child starts on this one's
     uncommitted tree (joshuafolkken/kit#1132). Leave `in-progress` **on** — the uncommitted
     work is still in the checkout and the child must go on holding the repository — do not park it,
     do not count it against the consecutive-failure guard, and do **not** go back to step 1. Finish
     the session and report. **Do not send a second `confirmation` Telegram** — the unit that ran the
     child already sent one for this stop, and `CLAUDE.md`'s rule is one per stop, not one per
     context that notices it. Where the child ran in this session's own context, that first
     notification is yours to send.
   - **Open, without `needs-decision`** — it failed. Remove the stale `in-progress` here (Tier A,
     per "`in-progress` is removed by whoever finds it stale"), count it against the
     consecutive-failure guard, and **park it** — the Guards table's "a failure that is not
     consecutive parks its child" applies to a delegated child as to any other. Parking is what
     stops the next `epic:next` from handing the same child straight back, retried without limit
     because each success in between resets the counter.

   **Never ask `epic:next` in place of this read.** A child that did not finish still carries
   `in-progress`, which `epic:next` classifies as waiting on time *before* it consults any blocker,
   so it answers `wait` — the loop would poll to the 90-minute stale window and learn nothing.

   Then **write the run's counters into the epic progress comment** — children run, Issues filed,
   **consecutive failures**, `auto-ok` pickups taken, and the time the run started. This happens at
   **every** child's merge, not only when something is about to stop: see "The counters live in the
   conversation" below for why a session that carries on past a compaction loses them otherwise.

   Then **ask the hand-off check — at every child's merge, delegated or not**, immediately after the
   merge and `pnpm josh ms`: `pnpm josh cost --over 300000`, beside `pnpm josh lane:list` in the same
   turn. Go back to step 1 on `under`; on `over` **the run hands its lanes over and stops in that same
   turn** — no new child is taken, the lanes already in flight keep running, and the next session picks
   them up from `lane:list` and `pnpm josh lane:output` (see "The hand-off" below). The one reading
   that does not stop is a lane nobody could poll — `unreadable`, or `open` with no recorded path.
   **Never read the condition off
   `pnpm josh delegate epic-child`** — it is a static policy lookup that answers `delegate` everywhere,
   so a gate built on it never fires.
3. **`wait`** — sleep the polling interval and go back to step 1. This also covers "another
   repository has work but this one does not", which is a wait from here.
4. **`stop`** — report the parked children and finish.
5. **`complete`** — post the epic summary, then run the pickup in "After the epic — issues opted
   in with `auto-ok`" below, and finish.
6. **Exit code 1** — `epic:next` refused a cyclic or contradictory graph, or could not read a child.
   Report and finish.

## The rule-compliance measurement is per child, not per epic

Each child's verification gate runs `pnpm josh eval:scope` and, on `required`, `pnpm josh eval`
(`eval-gate.md`). **`complete` does not run the suite again**, and a drop from the run's starting
measurement is therefore not something this loop computes.

The reason is not the cost. Every child that touched the distribution ran **all** the scenarios and
blocked on a failure, so the gradual degradation an epic-completion run would look for has already
been measured — at `complete` the tree is the one the last document-touching child measured, and a
second measurement of the same state is all that would be bought. It would also need a baseline
carried across children and sessions, which this run keeps nowhere but GitHub, and two `n/m` figures
compared in a suite where `?` is routine would fail an epic on the shared budget rather than on a
regression (joshuafolkken/kit#907).

**So the answer to "an unattended run has no instrument for output quality" is that it has one, and
it fires per child** — on the whole distribution, at merge-blocking strength. An epic that never
touches a distributed document runs it at neither point, which is correct: nothing changed what an
agent reads.

## After the epic — issues opted in with `auto-ok`

An epic's task list is not the whole backlog. An Issue small enough to need no human judgment sits
there forever unless somebody puts it in an epic, and as execution capacity grows the entrance —
what is eligible to be run at all — becomes the bottleneck rather than the running
(joshuafolkken/kit#906). `auto-ok` is the opt-in that widens it.

**Only a person applies `auto-ok`. Never apply it on your own judgement.** `epicrun #<E>` approves
the merges inside `#<E>` and nothing outside it ("What one invocation approves"), and this label is
the only way a person extends that approval past the epic's edge. A label an agent could apply to
itself would let an unattended run widen its own authorization — the self-widening
`split-assessment.md` forbids when it stops a `fullrun` that discovered a split — which is not a
guard at all. **Typing the command for the person is not applying it**: an explicit instruction in
the current turn ("label #912 `auto-ok`") is their decision and yours only to execute. Everything
else, "this one is obviously trivial" included, is a proposal — written as an Issue comment and left
for them.

**The pickup happens once the epic's children are done, and nowhere else.**

| `epic:next` answered | What happens to the pickup |
| --- | --- |
| a number | Run the child. No pickup — the epic's own children come first |
| `wait` | Wait. No pickup: the epic is still resolving, and outside work would run ahead of the batch that was authorized |
| `stop` | Report the parked children and finish. **No pickup** — the epic needs a person, and doing unrelated work instead buries that |
| `error` | Report and finish. No pickup |
| `complete` | Post the epic summary, then pick up below |

A run that began from a bare, non-epic Issue reaches the same point when that Issue merges without a
prerequisite or a split turning up ("Nothing found means no epic"): its authorized work is done, so
the pickup applies there too. One keyword must not mean two things.

**Ask the command which Issue, never `gh` directly.** The label name is single-sourced in
`scripts/git/issue-labels.ts`; typing the string into a `gh` query of your own puts a second copy of
it somewhere nothing checks.

```bash
answer=$(pnpm josh auto-ok:next)                 # the first time
answer=$(pnpm josh auto-ok:next --exclude <N>)   # every time after, naming the one just merged
answer=$(pnpm josh auto-ok:next --exclude <N>,<M>) # or every one this session has already run
```

**`--exclude` is not optional after the first pickup.** GitHub applies the `closes #N` side effect
asynchronously, so for a few seconds after the merge the issue you have just finished is still
listed as open. Without the flag the loop can be handed that same number back and re-implement work
that already shipped; the `in-progress` label happens to exclude it too, but that label is removed
by whoever finds it stale, so it is not something to rely on.

| Answer | What to do |
| --- | --- |
| A number | Run it exactly as `fullrun #<N>` does — delegated unit, verification gate, PR, merge — then ask again. **Unless it carries `needs-human-review`**, which degrades it exactly as it degrades a child: the gate runs, nothing is committed, and the run ends there rather than asking again (§2z) |
| `none` | Nothing is opted in. Finish the run |
| **Exit 1** — the listing could not be read | Report that the pickup could not be attempted, and finish. "Could not tell" is not `none`; reporting it is enough here only because the mistake stops work rather than starting some |

**An issue whose prerequisite is unresolved is never handed over.** The pickup reads the same
GitHub-native `blockedBy` relations `epic:next` builds its dependency graph from, and drops any
candidate declaring a blocker that has not closed. `auto-ok` says "this issue needs no decision" and
says nothing at all about order, so without this an unattended run could start a deliverable before
the thing it needs (joshuafolkken/kit#996).

**The order is the one the person was just shown.** `auto-ok:next` ranks with the same function the
`🗒 Next issues (newest first)` display uses at the end of every workflow — newest first, skipping
`epic`, `in-progress` and `needs-decision`. A second ordering would have the run start something
other than what that list has just named.

**The same ordering, though, is not the same set.** The dependency check above exists only on the
pickup side, so `auto-ok:next` can refuse an issue that `🗒 Next issues` is showing at the top of its
list. That difference is deliberate: a person can see the issue is blocked and decide to start it
anyway, and an unattended run has no such judgement to exercise.

**An epic's child is never picked up standalone while that epic is the one offering it**, whatever
labels the child carries (joshuafolkken/kit#1633, narrowed by joshuafolkken/kit#1668). `auto-ok`
widens unattended execution past an epic's edge; it does not widen it past an epic's *order*, and an
epic carrying `auto-ok` is going to hand its children over in the order its `blocked-by` graph
declares. Offering one standalone as well would both skip that order and hand the same issue over
twice — one sentence:

> An issue is run through the epic that is going to offer it, and never beside it.

**An epic that did not opt in is offering nothing, and there the child's own `auto-ok` decides.** The
epic half never reads an epic without the label, so under the rule before that narrowing such a child was
withheld from every path at once: a person could label it, watch nothing happen, and be told the
listing cap was the reason (joshuafolkken/kit#1668). It is offered now, and the order it does have
still holds — `josh epic --ordered` records an epic's declared order as native `blocked-by`
relations on the children themselves, and the standalone path refuses a candidate whose prerequisite
is still open. That refusal is what makes the narrowing safe, and it is the half of
joshuafolkken/kit#1633 that did not change: **opting in says nothing about order.**

**It is decided by whether an epic's task list names the issue, not by the issue's own labels.** A
child carries none of `epic` / `in-progress` / `needs-decision`, which is exactly why the label set
never caught one. `auto-ok:next` reads the open epics for this, only when something is opted in, and
**refuses to answer when that listing cannot be read** — treating a failed read as "no epic tracks
anything" would hand back every tracked child at once. The epics themselves are still found by the
`epic` label, exactly as `epic:bundle` finds them, so an epic that never received it is invisible to
both and its children read as tracked by nothing at all; `pnpm josh epic:audit` is what surfaces
that. **That is a different case from an epic that has the label and not `auto-ok`** — the second is
seen, and its children are offered on their own labels rather than on nobody having noticed it.

**Everything a child gets, a picked-up Issue gets**: the split assessment, the two-layer work
summary, `josh latest` staying hoisted to the session, park-and-continue, and the hand-off check after
each merge — **on the same condition, which is that `pnpm josh delegate epic-child` answered `keep`**;
where it answers `delegate` a picked-up Issue measures nothing either. One that needs a decision is parked
exactly as a child is, and the run asks again — and one carrying `needs-human-review` stops the run
exactly as a child carrying it does, so the pickup does not ask again either.

**The cap is 5 per run**, in the Guards table below. These issues went through no split assessment
as a batch, no `epic:audit` and no dependency graph — the label alone is the whole authorization, so
the cap is the only structural guard on them, and it is deliberately tighter than the epic's 30. On
reaching it, finish and report; the person types `epicrun` again for more.

**The label has to exist before anyone can apply it**, and a missing one is not an error: `gh`
answers an empty listing, `auto-ok:next` says `none`, and the run finishes exactly as it did before
this section existed. Opting in is the default absence. Create the label once per repository that
wants it:

```bash
gh api repos/{owner}/{repo}/labels -f name=auto-ok -f color=0e8a16 -f description="Opted in to unattended execution outside an epic"
```

## The hand-off — one session does not have to run the whole epic

**A session pays for every child it has already run, on every later turn.** What a turn costs is
decided by the accumulated preamble, not by what the turn does: measured across one `epicrun` that
ran six children in one context, the billed input was 222k per request during the first child and
645k during the sixth — the same work at 2.9x the price (joshuafolkken/kit#968). The growth is not
linear in the number of children; the k-th child re-reads the wreckage of the k-1 before it on every
turn.

**So the run reads the marginal cost off a line rather than feeling for it** — at **every** child's
merge, and crossing it **stops the session and asks the person to cut it**. joshuafolkken/kit#1212
qualified both halves — the line was read only where delegation was unavailable, and crossing it
compacted rather than stopped — and joshuafolkken/kit#1567 removed both qualifications against a
measurement neither of them had. Both removals are argued in full below; a reader who stops at this
paragraph would otherwise leave with the rule as it stood before them.

```bash
pnpm josh cost --over 300000
```

It prints `over` or `under` on standard output and the measured figure on standard error. `over`
means the next turn of this session costs more than the threshold in billed input, and the number is
passed explicitly so a run cannot drift it by remembering it wrong.

**いま指示している 300,000 は一時的な実験値であり、撤退条件と、畳む判断をする時点を持つ（joshuafolkken/kit#1775）。** 下に続く導出は 150,000 のものであり、**実験だからこそ消していない** — 畳んだときに戻る先がそれだからである。300,000 がその導出のどこに位置するかを 3 点で言う。(1) 一度も区切りに到達しないセッションの割合は 150,000 の 33% に対して **81%** へ上がる。(2) 1 リクエストあたり課金入力の p95 は 336,569 なので、300,000 は **p95 のすぐ下**にあたる。(3) 下限（誤停止）の側には余裕が増えるだけで、危険は上限の側にしか無い。つまりこれは、下の段落が「発火しない閾値は引かれていないのと同じである」と退けた状態へ近づく方向であり、さらに下の費用計算が支持する向き（ほぼ即座に区切ること）とも逆である。**恒久の設定変更として読んではならない。**

**畳む判断をする時点は日付ではなく成果物である — 根本原因の側である joshuafolkken/kit#1776（手順書の本流読み取りが入口で閾値を超えさせる）が入ったときに判断する。** それまでに `pnpm josh time` で、1 実行あたりのリクエスト数の中央値、1 リクエストあたり課金入力、1 セッションで完了した Issue 数、区切りに到達した回数を、変更前と同じ定義で比べる。**セッションあたりの総費用が悪化していたら撤退する** — リクエスト数は n²/2 で効くので、区切りが減れば 1 セッションが長くなり単価の高いリクエストが増えるからである。**撤退はこの段落を消すだけでは終わらない**: 閾値を指示している箇所は複数の文書とマーカーテストに散っているので、`grep -rnE '\b300,?000\b' --include='*.md' --include='*.ts' .` で列挙し（語境界を付けるのは、付けないと `run:wake` の間隔 `3000000` まで拾うからである）、下の導出が示す 150,000 へ戻し、マーカーテスト 3 本の定数を同じ値に直し、この段落と各文書の「一時的な実験である」の断り書きを削る。**断り書きを削るときは、それを要求しているアサーションも同じコミットで削ること** — `scripts/epicrun-handoff-document-rule.test.ts` の `EXPERIMENT_MARKER` / `EXPERIMENT_ISSUE` / `RETREAT_MARKER` / `REVIEW_POINT_MARKER` を使う 4 ブロックと、`scripts/entry-session-boundary-document-rule.test.ts` の `EXPERIMENT_TITLE` の 2 ブロックである。断り書きだけ削ると `pnpm josh test:unit` が赤で残る。**出力上限の 150,000 と本流読み取りの文字数 150,000 は別系統なので、一括置換で巻き込まないこと。** 判断材料の背景は joshuafolkken/kit#1775 にある。

**閾値 150,000 は 223 セッションの実測から引いた。** joshuafolkken/kit#1605 が、このリポジトリに記録された 223 本のセッションを `josh cost` と同じ定義（課金入力 ÷ リクエスト数、`message.id` で重複を除く）で測り直した。常駐だけを載せた最初のリクエストは中央値 **54,974**、1 リクエストあたりの課金入力は中央値 **121,514**、p90 が 256,106、p95 が 336,569 である。**旧閾値 400,000 を超えたのは 223 本中 4 本（2%）**にすぎず、`run:hold` を含む 21 本に限れば **95% が一度も区切りに到達しない**。発火しない閾値は引かれていないのと同じである。

**150,000 は下限と上限を実測で挟んで決めた。** 下限は誤停止である — 候補を 130,000 や 110,000 まで下げると、測定した 21 本のうち 5% が**そのセッション最初のランが終わる前に**区切りへ落ちる。引き継ぐものが何も無い停止であり、それが 0% になる最小の候補が 150,000 である。上限は効きである — 一度も区切らないセッションの割合は 400,000 で 95%、300,000 で 81%、200,000 で 52%、150,000 で 33% になる。**区切りまでに終わるランの数は 400,000 の中央値 6 本に対して 150,000 で 5 本**であり、`epicrun` / `queue` のマージ後判定が子ごとに止まるようにはならない。joshuafolkken/kit#968 が 400,000 を引いた根拠である 6 子目の 645,000 は、新しい閾値でも当然 `over` に落ちる。

**それでも 150,000 は「計測が最も安いと言う点」ではない。** 計測が支持するのは**ほぼ即座に区切ること**である — 50 リクエスト（≒ 子 1 件）ごとに区切れば課金入力は実測の 33% に収まり、区切り 1 回の費用（新しいセッションで常駐を書き直す約 56,000 ＋ EPIC と子 Issue の読み直し約 15,000 で概ね 70,000 トークン）に対して 1 回あたりの節約は約 14,500,000 トークン、**およそ 200 倍**の開きがある。損益分岐は最初の子の途中で既に超えており、150,000 に達した時点でも既に割高な状態でしばらく走った後である（joshuafolkken/kit#984）。

**閾値が表しているのは、トークンと人の手数の釣り合いである。** 区切るたびに人がコマンドを打ち直すため、計測の答え（子ごとに区切る）をそのまま採ると無人性を失う。トークン対トークンではなく**トークン対人の手数**のトレードオフであり、joshuafolkken/kit#968 の時点ではそう書かれていなかった。joshuafolkken/kit#1605 が変えたのは、そのトレードオフを `epicrun` 1 本のスケールではなく、`fullrun` を含む 223 セッションの分布の上で引き直したことである。

### The check is asked at every merge, and delegation does not excuse it

**A delegating parent reaches the threshold too, and joshuafolkken/kit#1567 measured it doing so.**
`epicrun #1474` delegated every child and still billed **732 requests, $176, $0.241 per request**
against the children's $0.080 — **the parent's request costs three times the child's** — on a cache
read of **361,833 tokens per request** against the child's 93,657. Of the parent's billed input
**85.0% was conversation history** and 15.0% resident. So the sentence this section used to carry —
that a delegating parent's context "grew by that child's summary and nothing else" and would never
reach the limit — is false, and the run that most needed the check was the one exempted from asking
it.

**joshuafolkken/kit#1212 measured one contributor and concluded about the total.** Its figure was
right: across joshuafolkken/kit#1176 the parent went 128,675 to 155,069 over six delegated children,
**4,000 to 5,000 per child**, and the one child run in the parent's own context added about 120,000
in a single step, to 272,528. What it did not measure is everything the parent's own loop writes between those
merges. joshuafolkken/kit#1567 decomposed exactly that: of what accumulated in the conversation,
**the executing side's own prose was 27.9%**, tool_result 25.2%, thinking 21.6%, tool_use 14.4% and
Bash command bodies 10.8% — so **the child summaries are the smallest of the five sources**, and a
gate conditioned on them alone reads the one that moves the number least.

**And the cost is not linear in the number of requests.** Every request re-reads the whole
conversation, so n requests in one session bill about n²/2 — 732 requests in one session against
about 100 in each of seven is roughly **7x**. A condition that delays the first cut therefore does
not defer a fixed cost; it multiplies it.

**So there is no condition: `pnpm josh cost --over 300000` is asked after every child's merge**,
delegated or not. It is one command against a merge that took tens of minutes, and the row it
replaced was written to save that one command. **Never wire the question to
`pnpm josh delegate epic-child`** — that is a static policy lookup answering `delegate` on every
machine forever (`scripts/delegation/delegation-policy.ts`), so a gate built on it never fires; that
was the defect joshuafolkken/kit#1212's own table already warned about, and making the check
unconditional is what finally removes the surface it lived on.

`over` and `under` are not the only answers: the command also **exits 1 with empty standard output** when there is no transcript, or no request in it. **Neither is `under`.** Reading "could not measure" as "still cheap" is the same mistake as reading an unreadable comment listing as "no findings" — report that the check could not answer, and take `over`'s branch at that child. **A session whose own cost cannot be read is one that has been running long enough to be worth cutting**, and the cut costs about 70,000 tokens against the millions the reading was there to catch, so the asymmetry runs the same way an unmeasurable check does.


### When to ask, and what to do

**Ask once per child, immediately after its merge and `pnpm josh ms`** — never mid-child. That
moment is the only one where **this** child's work is all written down: the PR is merged, the working
tree is on the default branch and clean, and the epic's state on GitHub is complete. A hand-off taken
anywhere else would have to carry work that is not written down yet.

**A merge is not by itself a safe seam, because another lane may still be running — and until
joshuafolkken/kit#1713 that was a reason to wait.** The session held the reference to every unit it
dispatched, so cutting it while one was in flight did not pause that child: the work stayed in its
lane and the reference to it did not, and what a resumed session could do was start it again rather
than pick it up. **The reference was one fact — where the unit writes — and it now lives in the
lane**, so a session that never dispatched the child can poll it and the pool is handed over instead
of drained. **Read the lanes rather than judging them:**

```bash
pnpm josh lane:list   # `none`, or one line per lane with its state and its recorded output path
```

**Every lane in flight is handed over, and the last column is what makes that possible.**
`pnpm josh lane:output <N>` prints the same path on its own, so the next session polls a lane it
never opened with two:

```bash
unit_output=$(pnpm josh lane:output <N>) &&
  pnpm josh run:liveness <N> --output "$unit_output" --process none
```

**The `&&` is load-bearing.** A lane that records nothing prints `none` and exits non-zero, so the
chain stops there; substituted straight into `--output`, that `none` is a relative path and
`run:liveness` answers `undetermined` — "could not read" — for ever, instead of the missing record
being reported.

- **`under`** — go back to step 1 of the loop and run the next child.
- **`over`** — **the run hands its lanes over and stops at once.** Open no new lane and take no new
  child from `epic:next`. Confirm that every lane still in flight records an output path — the
  recording is made at dispatch, and one missing is filled in now with
  `pnpm josh lane:output <N> <path>` — then take one of the next two bullets in the same turn.
  **There is no waiting here at all**: nothing has to finish, because nothing is being abandoned.
- **A lane nobody could poll** — `unreadable`, or `open` with no recorded path and none that can be
  supplied — **and the cut does not happen.** Name that lane in the epic progress comment and go back
  to step 1 of the loop; the reading is asked again at the next merge. This is the `unreadable` lane's
  treatment, unchanged from the drain and stated in full below.
- **Every in-flight lane records a path** — **stop and ask the person to cut the session.** This is
  joshuafolkken/kit#1567's change and it replaces "compact and continue": a session that compacts
  still bills its whole history on every later request, which is how `epicrun #1474` reached $0.241 a
  request while every one of its children ran in a unit. The cut costs about 70,000 tokens — roughly
  56,000 to rewrite the resident documents in a fresh session plus about 15,000 to re-read the epic
  and the child Issue — against a saving measured at about 14,500,000 per cut, **some 200 times more**.
  Post the epic progress comment naming **every lane still in flight and the path each one records**,
  so the next session has the pool in writing rather than only in a context that may be compacted
  away. Send a **`confirmation`** Telegram with the resume command in its
  body — a hand-off waits for the person to type the next command, which is what `confirmation`
  means; `completion` would announce an epic that has not completed — and stop with:

  > Please run `epicrun #<E>` to continue this epic in a fresh session.

  **報告は完了報告の書式で書かない。** 区切りは完了でも park でも失敗でもない**第 4 の停止**であり、専用の書式が `prompts/collaboration-workflow/report-format.md` →「区切りの報告（完了報告と区別する・必須）」にある。`原因 / 対応 / 結果` の 3 行は使わない — それは finished なランの形であり、epic はまだ終わっていない。書くのは 4 つ、**終わったこと / 残っていること / 止めた理由 / 次に打つコマンド**である。Telegram 本文も同じ書式で書く。

**`backlogrun` is the one entry point where the cut does not stop the run** (joshuafolkken/kit#1714).
There the keyword declares a budget — `--max`, `--idle` and this same 8-hour bound — so the cut is an
execution detail of spending it, and the record `pnpm josh run:carry` keeps carries that budget into
the next session with nobody retyping the keyword — which `pnpm josh run:wake` then starts, from
outside the conversation, so the keystroke goes as well as the budget (joshuafolkken/kit#1719).
**Nothing above changes for an `epicrun`**: an
epic declares which children may run, never how much of a budget, so its cut still ends with the
resume line and waits for a person. `backlogrun.md` → "The session cut is inside the invocation" is
that reading's single source.

**The hand-over is what makes the cut reachable, and the drain it replaced cost the pool.**
`epic:next --lanes` keeps the seats full, so under parallel lanes a merge almost never coincides with
an idle pool — and `epicrun #1474`, the run joshuafolkken/kit#1567 measured, ran in lanes: gated on an
idle pool that merely happened, it would have read `over` at all seven merges and cut at none of them,
which is the never-fires failure this section already indicts `pnpm josh delegate epic-child` for. The
drain solved that by _making_ the moment — open no new lane, let the in-flight ones finish — and paid
for it with the whole pool: six seats decaying to zero over as long as the longest child still
running, at 12–28 minutes a child (joshuafolkken/kit#1477) and a reading roughly every 50 minutes at
the measured throughput of 6.1 children an hour (joshuafolkken/kit#1637). **Recording the path removes
the cost without giving the moment back up** (joshuafolkken/kit#1713): the cut is taken at the reading
itself, the lanes keep running, and the next session picks them up from `lane:list`.

**A lane is handed over only where the next session can actually poll it, and that is read rather
than assumed.** A lane whose state is `open` **and** whose recorded path is not `-` is handed over. A
**`stranded`** lane has no work tree and so no running child — `pnpm josh lane:prune` closes it, and
the reading is taken again. An **`unreadable`** one cannot be told apart from a running child, and an
`open` lane recording **no path** is the same case one layer up — nothing to poll, and no way to tell
a finished child from a working one: in both, **the cut does not happen**, the lane is named in the
epic progress comment so a person can see what is blocking it, and the run goes back to step 1.
**Never assume idle.** The asymmetry runs the way it runs everywhere else here — a wrong cut abandons
a child, a missed cut only costs tokens. **That treatment is unchanged from the drain**, deliberately:
what joshuafolkken/kit#1713 removed is the waiting, not the caution.

**The hand-off report belongs to the stop, not to the reading.** With the hand-over the stop is
usually the same turn as the reading, so the two rarely come apart — but the boundary stands for the
one reading that does not stop: an `unreadable` lane, or an `open` one recording no path, sends the run
back to step 1, and a run that has not stopped writes no hand-off report. The epic progress comment is
the record in that case.
`report-format.md` → "区切りの報告" states the same boundary from the format's side.

**This is not a failure and not a park** — neither the hand-over nor the cut is. No child needs a
decision; the run is either handing its lanes on or standing at the seam. `needs-decision` is not
applied, nothing is stashed, and no Issue is filed.

### Picking the lanes up in the fresh session

**The resumed session does not start a child again, and does not open a lane that is already open.**
Its first reading is `pnpm josh lane:list`: every line with a recorded path is a child that was handed
over, and it is polled exactly as the session that dispatched it polled it — the two-line form above,
with the same answer table and the same two-`undetermined`-in-a-row rule as "A delegated unit that
stopped without reporting" above. **The `--process` argument is the one thing that changes**: a fresh session did not
start those processes, so it reports `none` unless it has looked for one itself.

**`pnpm josh lane:open <N>` re-attaches to a lane whose branch is already pushed**
(joshuafolkken/kit#1627), which is what a handed-over lane needs when its child has to be finished by
hand rather than polled to a merge. Nothing else about the loop changes: `epic:next --lanes` is asked
as usual, and a lane still in flight is a seat that is taken.

### The counters live in the conversation

**Write the run's counters into the epic progress comment at every child's merge, and read them back
after a compaction.** Every guard in the Guards table is counted in the conversation and nowhere else
— children run, Issues filed, **consecutive failures**, `auto-ok` pickups taken, and the time the run
started.

**It is every merge and not only an `over` reading, because a compaction is not something the run
chooses.** It happens under context pressure, at whatever moment the pressure arrives — mid-child as
readily as at a merge — so counters persisted only where the run expected to stop are counters that a
compaction takes anyway. While `over` ended the session this cost nothing: the counters died with a
session that was over. A session that carries on loses them mid-run.

**The consecutive-failure count is the one that matters**, because it is what the stopped-unit section
above leans on to notice that the environment rather than the children is at fault. Lost, a run keeps
feeding children into a broken environment and never reaches three.

**This is not what "Nothing is carried in the conversation" denies.** That sentence is about the state
a *next session* needs — which child, in what order, what it is — and all of it is on GitHub. The
counters are about *this* run's own guards, they were never on GitHub, and nothing needed them to be
until a session could outlive its own context.

### What carries over, and where it lives

**Nothing is carried in the conversation.** Everything the next session needs it reads back:

| What the next session needs | Where it reads it |
| --- | --- |
| Which children remain, and which is runnable | `pnpm josh epic:next <E>` |
| The order and the dependencies | the epic body |
| What each remaining child is | the child Issue body |
| What already merged | the epic's task list, and the closed children |

That is the same state a resumed run has always used (joshuafolkken/kit#861), which is why the
hand-off needs no new mechanism — it makes deliberate what an interrupted run already did by
accident. **A planned hand-off is strictly more certain than an interruption**: an interruption can
land mid-child with a dirty tree and a stale `in-progress` label, and this cannot, because it is
only ever taken when a child has just closed.

**A resumed session is a new session**, so it asks `pnpm josh latest:scope` once before its first
child, exactly as the rule above says — and updates only if that answers `required`.

## `needs-human-review` — the one stop that is not a park

A child carrying **`needs-human-review`** is degraded to a `halfrun`-shaped stop and **the whole run
ends there** — implementation and the verification gate run, nothing is committed, the working tree
is left dirty and unstashed, a `confirmation` Telegram carrying the resume command goes out, and the
remaining children are not started (joshuafolkken/kit#1125).

**This is the exception to park-and-continue below, and it is not an oversight.** Parking works
because the parked child leaves the checkout clean; this child does not. Its uncommitted work is the
artifact a person has to look at, so there is nothing to hand the next child a clean tree with —
which is exactly why the alternative that kept the batch running (commit and open a pull request,
merge nothing) was rejected: it satisfies "a person approves publication" and fails "a person
chooses", and the choosing is what the label exists for on a candidate-selection issue.

**The child goes on holding its repository.** `needs-decision` outranks `in-progress` in the
per-repository exclusion so a parked child releases the checkout; this label deliberately does not,
because releasing it would start the next child on top of uncommitted work.

**Its lane is left open and untouched**, for the same reason and by the same specification: the
uncommitted work in that tree *is* the artifact a person has to look at, so nothing is stashed and
nothing is closed. **Name the lane directory in the stop report and in the Telegram** — a person told
to look at a working tree and not told which one has been told nothing. The lanes already in flight
finish; no new lane is opened.

**Never apply or remove the label** — `auto-ok`'s rule, at `auto-ok`'s strength. Full definition and
the `needs-decision` comparison: `SKILL.md` → §2z, which is the single source.

## park and continue

When a child hits something this run may not decide — a Tier B toss-up, a Tier C action, an upstream
defect, a split that needs a person — **park the child and keep going.**

```bash
gh api repos/{owner}/{repo}/issues/<N>/labels -f 'labels[]=needs-decision'
gh api repos/{owner}/{repo}/issues/<N>/comments -f body="<what needs deciding, and the options>"
```

`in-progress` is left as it is, and the parked child does **not** hold the repository under the
per-repository exclusion above — `epic:next` gives `needs-decision` precedence over `in-progress`
exactly as the classification does, so the next child is offered normally.

Then return to step 1. The other children are unaffected unless they depend on this one, and
`epic:next` works that out.

**What happens to a parked child's lane depends on whether it had committed, and the two answers are
opposite.** **Parked before its commit**, the lane is stashed and closed, never left open:
`epic:next` already counts a parked child as having released its lane, so a lane left standing holds
a seat the count believes is free — and `lane:close` removes the work tree by force, so the work goes
first: `git -C <dir> stash push -u -m "epicrun: parked #<N>"`, the stash recorded on the Issue, then
`pnpm josh lane:close <N>`. **Parked after its commit and push**, the lane is *kept*: there is
nothing to stash, and closing would delete the local branch the resume needs with no command able to
put it back. **A lost merge race is not one of these rows** — it resolves in its lane rather than
parking at all ("Conflicts are not predicted" above), and parks only under that section's four
conditions, which take the after-commit row unchanged. Both rows, the seat a kept lane costs and the
`pnpm josh run:release` every parked ending owes are "What happens to a lane" above, which is the
single source.

**Parking replaces stopping the session, not the rule that produced the stop.** An upstream defect
is still filed immediately and unconditionally (Tier A for a first-party target), and a workaround
is still forbidden. What changes is the blast radius: the child waits, the run continues.

**A placement choice is not one of the things this run may not decide.** `epic:bundle`'s `ask` — the
issues related to a newly filed one sitting in more than one epic — is Tier A: choose the epic you
recommend, add it with `pnpm josh epic --add <E> <N> --after <M>`, and record the decision on both
the new Issue and that epic's `## Decisions`. Parked instead, it stopped a batch over an Issue whose
implementation was finished, whose review had converged and whose pull request was mergeable — the
only open question being where a follow-up Issue was filed (joshuafolkken/kit#1339). What remains a
park is a genuine toss-up between two epics that are equally apt, and that is rare.

**Removing the label is Tier A — do it without asking.** When the decision is recorded (joshuafolkken/kit#862
writes it to the epic's `## Decisions`), remove the label and re-run `epicrun`; the state is on
GitHub, so the run picks up where it left off.

```bash
gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/needs-decision 2>/dev/null || true
```

Without this the parked child never runs again — it is the second half of the human-in-the-loop
cycle, not an optional tidy-up.

## `in-progress` is removed by whoever finds it stale

Nothing in the codebase removes `in-progress`; a normal finish closes the issue, so it never
mattered. An interrupted run leaves it behind, and a child that carries it is excluded from every
future `epic:next` — permanently. **A session that detects a stale child removes the label itself**
(Tier A) and reports it, before continuing the loop.

**It costs more than that one child now.** Since the lane count above, an open issue carrying
`in-progress` occupies one of the repository's lanes — whichever epic it belongs to — so a stale
label narrows every epic that touches that checkout, and enough of them make `epic:next --repo`
answer `wait` for all of them at once. **The rule therefore applies to any open issue in the repository, not only to this epic's
children**, and `epic:next` names the holders on standard error so there is something to go and look
at. **Age alone is not the test.** Check the 90-minute window below *and* look at what is holding it,
because three ordinary states hold the label legitimately for longer than that: a `halfrun` stopped
for manual verification, any run paused mid-child, and a child stopped by `needs-human-review` — that
last one waits on a person reading an artifact, which routinely outlasts ninety minutes, and the
label is carried alongside `in-progress` so the issue says plainly which state it is in. **All three
leave uncommitted work in the checkout** — the `needs-human-review` stop by specification, since it
commits nothing and stashes nothing — so `git status` there is the decisive read: a dirty tree means
the hold is real, and the answer is to leave the label alone and report, never to strip it and start
a second child on top of that work.

**A closed issue's labels are neither a finding nor something to clean up.** Everything above is
about an **open** issue, and the reason is mechanical rather than stylistic: a closed issue holds no
lane — `epic-busy.ts` counts holders from the open listing alone — and `epic:next` never offers it,
so `in-progress` left behind on one changes nothing about what any run can do next. **Do not report
it, and do not strip it** (joshuafolkken/kit#1649). Reporting it is worse than merely useless: a
report is read as something that needs attention, so a run that lists non-findings is a run whose
real findings are harder to see.

```bash
gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/in-progress 2>/dev/null || true
```

## Waiting, and never waiting forever

| Setting | Value | Why |
| --- | --- | --- |
| Polling interval | 60 s | A child's `fullrun` takes minutes; a shorter poll only spends API quota. |
| `backlogrun` idle-watch poll | 5 min | Not the interval above. What a watch waits on is a person filing an issue and applying `auto-ok`, which happens on human timescales — and every ask bills the parent session's whole history, so asking every minute spends thirty requests to learn nothing thirty times (joshuafolkken/kit#1676). |
| Silent delegated unit | 30 min | Not the child's duration — the time its output has gone **unchanged**. A working unit rewrites its transcript continuously, so half an hour of no movement is not a slow child; it is a child whose average end-to-end time on joshuafolkken/kit#1176 was 31 min producing nothing at all. Past it, run the four traces above and book a stopped unit as a failure. |
| Stale `in-progress` | 90 min | Longer than any single child has taken; past it, the other session is gone. |
| Publish wait | 10 min | `josh propagate`'s own budget (joshuafolkken/kit#863). A failed publish never appears. |
| Whole run | 8 h | An unattended run that has not finished overnight needs a person, not more waiting. |

Each timeout **ends the wait and reports** — none of them is retried indefinitely. A stale child's
label is removed first (above), so the next poll can offer it. **A graph that has deadlocked on a
cycle is not this loop's to untangle**: `epic:next` detects it and exits with an error, so `epicrun`
confines itself to ending the wait and reporting it.

`epic:next` does not report when a label was applied, so read that from the issue's timeline:

```bash
gh api "repos/{owner}/{repo}/issues/<N>/timeline" \
  --jq '[.[] | select(.event == "labeled" and .label.name == "in-progress") | .created_at] | last'
```

An empty answer means the label predates what the timeline returns, which is itself past the
window — treat it as stale.

Waiting is decided by `epic:next`'s classification, never by reading labels:

| `epic:next` says | `epicrun` does |
| --- | --- |
| Something is runnable | Run it |
| Nothing runnable, something resolves on its own | **Wait** |
| Nothing runnable, nothing resolves on its own, children remain | **Stop and report the parked children** |
| No open child | Post the epic summary, pick up the `auto-ok` issues ("After the epic" above), then finish |

The distinction is not academic. When kit's child has closed and app-kit's child is waiting for the
release to publish, there is no runnable child, nothing carries `in-progress` and nothing carries
`needs-decision` — a label-based reading calls that "done" and stops, in the one moment it must wait.

## A prerequisite discovered mid-run

Finding that something else in **this** repository has to land first is not a split, and not an
upstream defect. The child in hand is still one deliverable; it just needs another one before it.
It gets its own procedure because the two rules it sits between both end in a stop, and this one
must not (joshuafolkken/kit#891). The three-way distinction, the `route:tier-a` filing command and
the filing ceiling are `SKILL.md` → §2d, which is the single source; what follows is this entry's
branch.

`<M>` below is the child being implemented when the prerequisite turned up; `<N>` is the new Issue.

1. File the prerequisite Issue `<N>` with the `route:tier-a` label — Tier A for a first-party repository, no confirmation (joshuafolkken/kit#1083). It is
   filed **first** because the next step has to name it, and its number does not exist until it is.
2. **Stash the work in progress.** A child is implemented on the default branch with an uncommitted
   tree — `pnpm josh git` only creates the branch at commit time — so `<M>`'s half-finished edits are
   sitting there, and the next child's `git switch main && git pull` would either refuse or carry
   them into the prerequisite's branch and PR.

   ```bash
   git stash push -u -m "epicrun: paused #<M> for prerequisite #<N>"
   gh api repos/{owner}/{repo}/issues/<M>/comments -f body="<what was stashed, and that #<N> must land first>"
   ```

   **`-u` is not optional**: a child's work almost always includes a new `*.test.ts`, which is
   untracked, and a stash without `-u` leaves exactly those files behind — the failure this step
   exists to prevent. The comment is what makes the paused state auditable, exactly as the
   upstream-interrupt rule requires, and it is what tells the session that resumes `<M>` that a stash
   is waiting for it. `git stash pop` when `epic:next` offers `<M>` again, after its
   `git switch main && git pull` — the prerequisite has merged by then, so expect to resolve
   conflicts rather than to apply cleanly.

3. `pnpm josh epic --add <E> <N> --before <M>` — one command writes the task-list row, the
   declaration and the `blocked-by` relation together (joshuafolkken/kit#890). Never edit the body
   by hand: the declaration and the relations then disagree, `epic:next` returns `error`, and the
   unattended run stops outright.
4. **Remove `in-progress` from `<M>`.**

   ```bash
   gh api -X DELETE repos/{owner}/{repo}/issues/<M>/labels/in-progress 2>/dev/null || true
   ```

   This is not tidying — it is what lets `<M>` run again. `epic:next` classifies a child carrying
   `in-progress` as waiting on time **before** it looks at any blocker, so a child left labelled is
   never offered again however long the run waits, and the epic stalls the moment the prerequisite
   merges. Nothing in the codebase removes the label; the session that stopped working on the child
   is the one that has to.

5. **Do not park.** Go back to step 1 of the loop. `epic:next` classifies the original child as
   resolving on its own and hands back the prerequisite first, so the order is kept with no human
   input at all.

**Parking is only for a prerequisite that cannot be expressed as a dependency** — one that needs a
design decision nobody has made, or that is a Tier B toss-up or a Tier C action. Parking one that
*can* be expressed inverts the whole point: `needs-decision` is cleared by a person, so a park taken
in the name of unattended execution is what makes the run need a person.

## Splitting a child mid-run

Discovering that a child is really several is not a reason to stop. File the new children with the `route:split` label (joshuafolkken/kit#1083) (Tier A
for a first-party repository — no confirmation), then add them with `pnpm josh epic --add <E> <N...>
[--before <M> | --after <M>]` rather than editing the epic body by hand — for the reason above. Use
the same split criteria as `kickoff` (joshuafolkken/kit#865). If what remains of the original child
needs a person, park **that** child and move on.

## Guards

| Guard | Limit | On reaching it |
| --- | --- | --- |
| Children per run | 30 | Stop and report; an epic this large should be split. |
| Issues filed per run | 10 | Stop and report; a run filing more than this has lost the plot. |
| Consecutive child failures | 3 | Stop and report; something is wrong with the environment, not the children. |
| `auto-ok` issues per run | 5 | Finish and report; the epic is done, and the rest keeps until the person asks again. |

A failure that is not consecutive parks its child and the run continues.

## Who sends the summary, and who propagates

With several sessions on one epic, **exactly one does the end-of-epic work: the session standing in
the repository that owns the epic.** It sends the epic completion summary, and it runs
`josh propagate` (joshuafolkken/kit#863) — which itself refuses to run outside the supplier
repository, so the two rules agree. Every other session finishes quietly when its own repository has
no children left.

Per-child completion notifications are unchanged: `pnpm josh followup` sends one each, as in
any `fullrun`.

Send an epic **start** notification when the run begins, and an epic **completion** summary at the
end naming what was merged, what was parked and why, and what was filed.

**That same session asks `pnpm josh release:scope` once, after the last child has merged** — in the
primary checkout, after the last lane is closed, and never once per child: a release cut mid-batch
would ship a version while the remaining children are still moving main. `followup.md` → "When
`pnpm josh release` runs" is the single source for the position, the three answers and why the run
reports the release rather than cutting one (joshuafolkken/kit#1582). On `required` the epic
completion summary closes with the request and the exact command; on `unknown` it says `unknown`,
never `skip`.

## Stopping conditions

`epicrun` stops only here:

1. `epic:next` reports `complete`, the summary has been sent, and the `auto-ok` pickup has
   answered `none`, reached its cap, or reported that it could not read the listing.
2. `epic:next` reports `stop` — every remaining child needs a person; report them.
3. `epic:next` reports `error` — a cyclic or contradictory graph.
4. A guard above was reached.
5. A timeout above elapsed.
6. `pnpm josh cost --over 300000` answered `over` — or could not answer — just after a child merged,
   and every lane still in flight records the path the next session will poll it on. The run is then
   cheaper to continue in a fresh session, and the resume command is in the report. This is the one
   stopping condition that is not a problem: nothing is parked, nothing is filed, the epic is
   unchanged, and the lanes keep running. **The reading stops the run in its own turn**
   (joshuafolkken/kit#1713, which replaced joshuafolkken/kit#1567's drain) — with the one exception
   that a lane nobody could poll, `unreadable` or `open` with no recorded path, sends it back to step 1
   instead.

**A child that needs a decision is not on this list.** It is parked, and the run continues.

**Neither is a delegated unit that stopped without reporting.** That child is booked as a failure and
parked, and the loop goes on to the next one; only the consecutive-failure guard above can turn it
into a stop.

---

This file is the single source of the `epicrun` procedure; `prompts/collaboration-workflow/epicrun.md` is a pointer to it (joshuafolkken/kit#1188, the joshuafolkken/kit#1176 rollout of the joshuafolkken/kit#1174 pattern). That topic file used to open by declaring that the two had to agree, which is what made every rule here a rule to be written twice.
