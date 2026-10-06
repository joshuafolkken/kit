# `backlogrun` — the detailed procedure behind the manifest

**This is the detailed procedure behind `backlogrun.md`'s manifest, relocated here so the entry read
carries the manifest, not the prose** (joshuafolkken/kit#2190). This file is **reference-only** and is
read at its point of use — it is classified point-of-use in `entry-read-set.ts`, exactly as the four
`backlogrun-*.md` phase documents are, so a `backlogrun` entry never opens it whole up front. Each
section below is the single source of the rule it carries; `backlogrun.md` points here rather than
restating any of it.

## What one invocation approves

**One `backlogrun` approves every merge of every issue `pnpm josh backlog:next` offers** — the issues
carrying `auto-ok`, every child of an epic whose root carries it, **and an issue this run filed, once
it has become such a child**. A filing is placed into an epic by `pnpm josh epic:bundle`, which
`prompts/review.md` → "Review round cap" and `observation-filing.md` both make **Tier A rather than
optional**; where that epic's root carries `auto-ok`, the child is offered from the next ask onwards
without anybody having labelled it.

**Two repairs that would bound this the other way are prohibited** (joshuafolkken/kit#1675): dropping
a run's own filings from the pool, and requiring a person's `auto-ok` on a child as well. What
bounds it instead is "The brake that replaces the promise" below.

**`backlogrun` declares "everything opted in", and a named epic declares "the children of that
epic"** — what runs is stated by the keyword and its arguments, never inferred from the shape of a
request.

**An issue found by opted-in work is opted in by default** (joshuafolkken/kit#3213) — this file is
that rule's single source, and `pnpm josh issue:file` computes it (`scripts/issue/issue-auto-ok.ts`),
printing `auto-ok: applied` or `auto-ok: not applied` with the reason. It applies `auto-ok` while a
`backlogrun` carry record is live, or when the issue the current branch names carries `auto-ok`,
and never on a `--repo` filing to another repository. **Pass `--no-auto-ok` only when the new issue needs a person's judgement** — a Tier B toss-up or a
Tier C action inside it; a choice with a clear recommendation is Tier A and does not qualify.
Outside those signals `auto-ok` stays a person's to apply. **Which ones carry the label, that rule;
in what order and how many at once, the run** — the brake below bounds the quantity, not the
membership.

The end-of-run retrospective is no longer a separate carve-out: it files
while the carry record is live, so the same default opts its filings in, counted against every brake
in "The brake that replaces the promise" below.

A Tier C action inside a child still stops that child, exactly as it does for any batch child.

**A named issue is approved by the keyword and its number, not by `auto-ok`** (joshuafolkken/kit#1984).
`backlogrun #N1 #N2 …` runs those issues whether or not they carry the label. The pool that follows
is unchanged: still `auto-ok`, opted in as "Which ones carry the label" above says. "Named issues
run first, in order" below is the procedure.

Rationale: `docs/maintainers/backlogrun-steps-rationale.md` → "Why the authorization boundary is shaped this way"

### The brake that replaces the promise

**Every bound is counted in the carry record rather than in the conversation** ("The session cut is
inside the invocation" below):

| The bound | What it limits | Where it is counted |
| --- | --- | --- |
| `--max` | how many issues one invocation may merge — a run's own filing competes for that number rather than extending it | `run:carry --merged` |
| `--idle`, and the 8-hour whole-run bound | how long one invocation may go on looking for more | the record's `started_at` |
| **Ten filings per invocation** | how much one invocation may add to the pool at all, on **every** filing route (`prerequisite.md`) | `run:carry --filed` |
| The WIP cap on open issues | how large the pool may become, across invocations | `prompts/collaboration-workflow/wip-cap.md` |

One invocation may add at most ten issues to the pool and merge at most `--max` of them, after which
the run ends and the next one waits for a person to type the keyword.

**Two filing routes are exempt from the depth test (`observation-filing.md`), and the ten-filings ceiling
still covers them:**

- **`route:tier-a` and `route:interrupt` stay exempt.** **Their number is still capped**: `prerequisite.md`'s
  ten-filings ceiling is stated "at every entry point", and `run:carry --filed` counts it across
  session cuts.
- **A review branch-2 filing stays exempt** — a confirmed defect reaching a runtime path, with a
  written failure scenario.

**This section is the single source of how the `epic:bundle` obligation and this authorization
boundary meet.** `observation-filing.md` points here rather than restating it.

## Named issues run first, in order

**`backlogrun #N1 #N2 …` runs the named issues before it touches the pool** (joshuafolkken/kit#1984,
folding in the old `queue` keyword). They run in the order they were typed, **one at a time — no
lanes**, because the order is the point of naming them. Only once the named list is exhausted does the
loop below drain the opted-in backlog. A bare `backlogrun` names none and starts straight on the loop.

**`pnpm josh backlog:plan #N1 #N2 …` reports the whole plan** — the named prefix first, in order, then
the pool. `scripts/backlog/backlog-named.ts` is the single source of that order and of the failure
branch below; the plan renders it rather than restating it.

**Each named issue is a full `fullrun` in a delegated unit**, exactly as a backlog child is
(`backlogrun-child.md` → "Each child runs in a delegated unit"), and the once-per-session steps — `josh latest`
on `required`, the progress watcher — run once for the whole invocation, never per issue
("What runs once per session, not once per issue" below). Between issues, `pnpm josh ms`
brings the previous merge into the checkout the next one implements in. The parent reads each issue's
state back from GitHub — `pnpm josh issue:state <N>` — never the unit's summary.

**A named issue that cannot finish parks, and the rest of the named list is skipped.** **The run does
not stop there**: it goes on to drain the opted-in backlog, and the completion report lists the named
issues it did not start. `backlog_named.after_failure` is the single source.

- A named issue read back `CLOSED` — merged, or already `already-done` — is finished; continue with the
  next.
- A **`needs-human-review`** named issue stops the whole run before its commit (`needs-human-review.md`),
  exactly as any child does — the named issues after it are not started and neither is the pool.
- Everything else about running one — the verification gate, the hand-off, the guards — is
  this file's and is not restated here.

**`--only` runs the named list and stops there, draining no pool** (joshuafolkken/kit#1984).
`backlogrun #N1 #N2 … --only` runs the named issues in order and ends, and the completion report says
in one line that `--only` held it back from the opted-in backlog. A named issue that fails **under
`--only` ends the run** rather than falling through to a pool, and the issues after it are skipped as
ever. **`--only` with no named issues has nothing to run and is refused before anything starts.**
`backlog_named.startup` is the single source of both, and `pnpm josh backlog:plan #N1 #N2 … --only`
renders the named-only plan the run will take.

## The session cut is inside the invocation

**This section is the single source of the mechanism.** The record, the two commands, the answer table
and what each one means are all here. **A named-issue `backlogrun #N1 #N2 …` pins its list across the
cut**: the record keeps the **opening** list at every cut, and the issues it has finished live in the
record's `done` field rather than shrinking the string — a resumed session reads `remaining` from
`pnpm josh run:carry --json` and runs those, then drains the pool as ever. **`--only` rides in that
invocation string like every other token**, so a resumed session runs the remaining named issues and
**stops** rather than draining the pool the person excluded.

**Typing `backlogrun` once authorizes the declared budget, and a session cut does not end the run.**
`backlogrun-progress.md` → "The hand-off" stops the _session_ at the seam; under `backlogrun` that
seam does not stop the _run_. The next session picks the same invocation up and carries on with the
budget already partly spent.

**A resumed session's carried-over lanes are polled beside new work, never waited out** —
`backlogrun-progress.md` → "A carried-over merge does not stand in front of the next lane" is the
single source.

**The authorization boundary is carried by the budget, not by the keystroke**, so the budget is
carried in a record rather than in the conversation:

```bash
pnpm josh run:carry --begin "backlogrun --max 5 --idle 30" --owner "$PPID"
pnpm josh run:carry --json                                                   # read it back in a resumed session
```

**Always pass `--owner "$PPID"`** — the parent loop's own long-lived process. Left off, `busy` cannot
be answered and every standing record is refused rather than resumed. A live PID whose start token
the sandbox cannot read is held as `busy`.

**Ask it before the plan, in the same turn as the first `git switch main && git pull`.** The contract
is `docs/josh-commands-run.md` → "`josh run:carry`"; what this loop does with each answer is here:

| It answers   | What the run does                                                                                                                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `began`      | Nothing was carried. This is the invocation's first session: report the plan and run the decision pass as written below                                                                                                     |
| `resumed`    | **This session is continuing a run that was cut** — a `--cut` handed the record off, or a `--resume` adopted it. Read the record with `--json` and take the budget figures from it, never from this session's own zero. Report the plan again — the pool has moved — and skip nothing else |
| `busy`       | The record's **owner process is still running and no cut handed it off**: another parent is spending this budget right now. **Stop; do not open a lane.** (A record a `--cut` _did_ hand off answers `resumed` here even with its owner still alive.) Nothing here is yours to end — either that run finishes and ends its own record, or a person decides it is over |
| `over`       | This session is over the context-cut threshold, so it claims nothing (joshuafolkken/kit#2760). **End the conversation**; retype the invocation in a fresh session |
| `standing`   | A record is here that **no cut or supervisor handed off** — an unwatched crash, and the same command retyped over it. **Stop; do not open a lane**, and do not guess: the choice is the person's. Report the two commands the answer names — `pnpm josh run:carry --resume "<invocation>" --owner "$PPID"` to carry that budget on, or `pnpm josh run:carry --end` and begin again to discard it. Pass `--owner` to the resume as to the begin |
| `mismatch`   | A record is here for a **different** invocation — a run that never reached `--end`. **Stop; do not open a lane**, and never resume into it. End it deliberately, with `pnpm josh run:carry --end`, once you know that run is over |
| `expired`    | The 8-hour whole-run bound is spent. **Where a `--cut` handed the record off it is this run's own bound**, so this is the verdict on standard output and the run ends: report it and stop, and clear the record with `pnpm josh run:carry --end` once it is genuinely over. Where nothing handed it off it is printed on standard error ahead of a `began` instead — a person typing the keyword again over a spent record is starting a new run, and the record is replaced. A `--resume` over a spent record answers `expired` and adopts nothing |
| `unreadable` | Report what it printed and **stop before opening a lane**                                                             |
| `unknown`    | The same — the repository's git directory could not be read, so nothing was established                                                                                                                                    |

**The record is the parent loop's, and a lane never touches it.** A delegated unit is briefed with its
child and nothing about the invocation's budget. **`--begin` claims the record exclusively and names
the owning process, so a second parent is answered `busy`.**

**Count into the record rather than into your head** — `--merged 1 --owner "$PPID"` at every child's
merge, `--filed 1 --owner "$PPID"` at every Issue this run files, and `--cut --owner "$PPID"`
immediately before the cut. Every counter is an increment. **`--owner "$PPID"` is not optional on a
count**: a count that does not name the record's owning process is refused.

**`--cut` hands the record off, and so does `run:wake` for a dead owner** (joshuafolkken/kit#2437): the
next `--begin` naming the same invocation answers `resumed` — **even while the cutting process is still
running**.

**So `--cut` is the session's last write to the record**: count everything the session has, then cut.
A `--merged` or `--filed` issued after the `--cut` is **refused**.

**`backlog:budget` is then fed from the record, never from a count kept in the conversation:**
`--started` takes the record's `started_at` and `--merged` its `merged`, so `--max` and the 8-hour
whole-run bound count **across** cuts, as one invocation's worth. **The 10-filings-per-run ceiling is
counted the same way**, from `filed`. **`--idle` is the one budget that is not carried**, and a cut can
only reach a watch that opened while this run's own children were still merging. A resumed session
then states its resume moment as `--active` and the watch begins again at its full budget, bounded by
the 8 hours as everything else is: "The cost check is not asked during a watch" below.

**How many cuts the run crossed is named in the completion report**, read from the record's `cuts`.

**End the record when the run ends** — `pnpm josh run:carry --end`, **after the final report and never
batched with it**: `run:report` scopes by the record `--end` removes. The next `backlogrun` then begins
its own budget rather than resuming a spent one. **Where the run ends by _stopping_ rather than
finishing** — `backlog:budget` or `epic:next` answered `stop` (a parked backlog, an unreadable listing,
the maximum, the whole-run bound), or the consecutive-failure guard tripped — **end it with
`pnpm josh run:carry --end --stopped "<one-line reason>"` instead**. That pushes one ⏸️ confirmation as
it clears the record; the reason is the stop verdict's, in the session language. A clean completion
takes the bare `--end` and stays silent, having its own report; a parked _child_ is pushed by the child
that parked it (`backlogrun-park.md`). Because `--end` removes the record, a re-run's second `--end`
finds nothing and never re-sends that confirmation — `progress-watcher.md` →
"Progress while the run is quiet" is the single source of the pull-versus-push split.

**The record widens nothing but the default.** It carries a budget, and its being live is what
opts this run's filings in ("What one invocation approves"); no other label follows from it. A pool grown across the cut by this run's own bundled filings is "What one invocation
approves", its ceiling counted from the record's `filed`.

**Nothing waits for a person any more — `pnpm josh run:wake` supervises the driver**. After a cut or
dead-owner recovery, it adopts the carry record and runs `backlog:drive` itself. The driver dispatches,
collects, watches and reports without starting a parent AI session. Only a returned branch that needs
judgment starts an AI session, with the branch result and resume flags in its prompt.

**Start it in the same turn as `--begin`, and stop it in the same turn as `--end`:**

```bash
pnpm josh run:wake --start   # right after `run:carry --begin`
pnpm josh run:wake --stop    # in the same turn as `run:carry --end`
```

**It reads the same record this section already keeps.** A handed-off carry record, or one whose owner
died, starts the driver. The supervisor adopts that record before the driver counts a merge; a live
owner prevents a second driver from taking it over. On `none`, `expired` or `unreadable` it stops. The
8-hour whole-run bound therefore still comes from the carry record. **A new authorization is still a
person's**: the supervisor spends the declared budget and never declares another.

**What may be run is untouched.** The driver takes named issues from the invocation and pool issues
from the existing offer command. The supervisor writes no label of its own; `auto-ok` arrives only
through `issue:file`'s default. A judgment session receives
the original invocation plus the driver's reason and resume state.
For a named epic, the driver hands off `epic #N` with the original invocation. The judgment session
follows the named epic procedure and dispatches its children; the epic root is never launched as a
standalone `fullrun` child. Once every child has merged or parked, record the root with
`pnpm josh run:carry --done <E> --owner "$PPID"` before continuing the invocation. This removes it
from the carry record's remaining named list, so the next driver pass can advance. The named prefix
also consults the carried maximum and whole-run bound
before each launch, and a failed named issue skips the remaining named prefix.

**A person keeps control of it** — `pnpm josh run:wake --list` names the running supervisor and `--stop`
ends it. Its failure warnings, log file, progress relay and the provider / model / effort each
unattended role runs with are `docs/josh-commands-run.md` → "`josh run:wake`".

**The completion report names how many sessions were woken beside the record's `cuts`** — one wake per
cut is the invariant, and what counts is a carry record actually claimed, never a process started.

**The reading is scoped to `backlogrun`.** A `fullrun` cut still waits for a person's keystroke.

Rationale: `docs/maintainers/backlogrun-steps-rationale.md` → "Why a session cut does not end the run"

## The plan, before the first child starts

**A `backlogrun` reports its plan before it starts anything.** Nothing is dispatched, no lane is
opened and no issue is picked up until the plan has been reported and the decision pass below has
run.

**The plan is one command's output, not an assembly of several:**

```bash
pnpm josh backlog:plan
```

**It renders the same classified pool `backlog:next` answers from**, so **the plan cannot promise an
order the run does not take**. Its four sections are:

- **Ready now** — the runnable children, grouped by repository. **The grouping is the parallelism**:
  a lane is per repository, so the bundles are how wide this run can go.
- **Waiting** — every withheld child, each naming **what it is waiting on**: the blocking issue
  numbers, a run that already has it, or that it is ready but past the offer this ask could make.
- **Waiting on a person** — the `needs-decision` children, which is the next subsection's input.
- **Out of scope** — every open issue the backlog will **not** run, with the reason, so "not opted in"
  is distinguished from "not reached yet".

**Report all four to the person, in the session language, before the first child starts.** Epic
children are enumerated individually rather than summarized under their root. Report a truncated-listing
`⚠` with them: the plan is then partial.

### Resolve what the plan can resolve, before starting

**Every `needs-decision` issue the plan listed is settled in one pass at the start, rather than one
stop at a time.**

- **Decide everything decidable from the issue itself.** Read the issue's body **and its comments**
  (`issue-comments.md`), and where the answer is already there, record it as an Issue comment and
  **remove the label** — `CLAUDE.md` → "Decision autonomy" already makes that Tier A. **Read them all in
  one `pnpm josh issue:read <N> <N> …` call**, not a `gh api` pair per issue.
- **Never measure in order to decide.** A question needing a benchmark, a profile, or a run of the
  thing itself is not settled here: it stays labelled and the plan says so.
- **Label what you find.** An issue needing a person's judgement gets `needs-decision`, applied as
  `backlogrun-park.md` → "park and continue" does. **The next plan classifies it by the label alone**,
  never the body.
- **Order and isolate the pool in the same pass** (joshuafolkken/kit#2776), from the same
  `issue:read`: an issue that must land first (it builds what another reuses, or both edit one code
  path) becomes a native `blocked-by`; an issue meeting all three of the `backlogrun-lanes.md` →
  "Lanes — running more than one child at a time" conditions gets `run:solo`, **every other one `run:lane`**. Comment the reason; the offer commands enforce all
  three, answering `triage` while an issue has neither.
- **`priority:high` puts an issue first** (joshuafolkken/kit#2928; ranking: `docs/josh-commands-automation.md` →
  `josh backlog:next`). Apply it only on a cited ground — a stated deadline or urgency, or a person's
  written policy — commenting the ground; **never remove it**.
- **Report the order those labels produce — `pnpm josh backlog:plan --waves`** (joshuafolkken/kit#2778),
  `backlog:next` played forward wave by wave. Report it with the plan, never an order derived by hand.
- **Then start the loop.** Whatever is still labelled is reported as parked and left standing; the
  run does not wait on it.

**`needs-decision`, `run:solo`, `run:lane` and `priority:high` are the workflow labels a run may
apply by hand, and none is `auto-ok` or `needs-human-review`.** `needs-human-review` stays a
person's alone (`needs-human-review.md`); `auto-ok` reaches only a run's own filing, through
`issue:file`'s default ("What one invocation approves"). A run parks with `needs-decision` and a
person clears it.

Rationale: `docs/maintainers/backlogrun-steps-rationale.md` → "Why the plan and the decision pass come first"

## The loop

**The loop is computed, not walked by hand.** The `run:wake` supervisor runs `pnpm josh backlog:drive`,
whose head is `pnpm josh backlog:offer`: the answer-to-budget mapping, the retry count, the `--exclude`
feedback and the lane count are its own (`docs/josh-commands-automation.md` → "`josh backlog:offer`"
and "`josh backlog:drive`"). **An AI session reaches this section only when the driver hands a branch
back** — the `Driver result:` line names it, and its `Next:` line is the order: claim the record with
`pnpm josh run:carry --resume "<invocation>" --owner "$PPID"`, act on the branch, then hand the loop
back with `pnpm josh run:carry --cut --owner "$PPID"`:

| Handed back | What the session judges |
| --- | --- |
| `triage` | Label each issue stderr names `run:solo` or `run:lane` (with `blocked-by` where one must land first), as "Resolve what the plan can resolve" does; running children continue |
| `offer` | `backlog:offer` itself could not answer. Report what stderr printed; **never pick an issue by hand** |
| `launch #N` | A lane failed after it opened. Read the lane's log and park `#N` (`backlogrun-park.md` → "park and continue") |
| `merge [<token>] #N` | `run:merge` stopped on `environment`, `busy`, `retry` or `over`, or printed nothing: `environment` ends the run, the others re-read the child (`backlogrun-progress.md` → "Running a named epic's children") |
| `watch` | The backlog drained with nothing in flight; the retrospective is owed (`run:step`) |
| `window` | The driver's wait window ran out with nothing to judge; hand the loop back as is |

**`window`, `merge busy` and `merge retry` reach a session only after the supervisor's own re-runs run
out** (`run-wake-driver.ts`).

**A candidate only in another repository is never a token** — report it with its checkout and leave it
to a session running there (`backlogrun-lanes.md` → "Concurrency").

Rationale: `docs/maintainers/backlogrun-steps-rationale.md` → "Why the loop's contract is shaped this way"

### The two budgets

**A `backlogrun` may declare how long it will watch an empty backlog and how many issues it may
take.** Both are written on the keyword, and **the idle watch is on by default while the maximum is
not**:

```
backlogrun               # watches for 30 minutes after the backlog empties
backlogrun --idle 0      # finishes the moment the backlog empties
backlogrun --idle 0 --max 5
```

| Budget | Written | Default | What it does |
| --- | --- | --- | --- |
| Idle watch | `--idle <minutes>` | **30 minutes** | After the candidates run out, keep polling this long for a new one. A candidate that appears restarts the watch from that moment |
| Maximum issues | `--max <count>` | unlimited | How many issues this invocation may take. On reaching it the run reports and finishes |

**`--idle 0` is how the watch is turned off, and it is the only way**: `backlogrun --idle 0` finishes
at the first empty backlog. The default's single source is `scripts/backlog/backlog-budget.ts` →
`DEFAULT_IDLE_MINUTES`. **A watch is polled every 5 minutes, not at the loop's 60-second interval** —
read the interval from the reason `backlog:budget` prints rather than remembering it.

**To become a candidate an issue needs `auto-ok`** — applied by a person, or by `issue:file`'s
default to an issue this run filed ("What one invocation approves") — or to be a child this run
filed and bundled under an already opted-in epic. Either is bounded by the brake there, never the
watch. No issue that neither a person nor that default opted in is ever picked up during a watch.

**`backlog:offer` asks `backlog:budget` for you on every iteration** — it maps `backlog:next`'s answer
to the word "The loop" points to and hands it over, so the loop makes the one call and reads back the
verdict:

```bash
offer=$(pnpm josh backlog:offer --started "$started" --active "$active" \
  --merged <count> --running <count> --retries <count> [--idle <minutes>] [--max <count>])
```

**`--active` is required of every ask, because the watch is on unless it was turned off** — an
invocation whose watch is on and that carries no `--active` is **refused** by `backlog:budget`. Only
`--idle 0` excuses it. **`--running` also decides `wait` and `--retries` decides `retry`** — the two
context branches that mapping carries, applied inside the command from the counts the loop already
tracks.

| Verdict | What the loop does |
| --- | --- |
| `run` | Start what `backlog:next` offered, up to the free lanes. The reason names how many more the maximum still allows; start no more than that |
| `watch` | Ask both commands again — at the 5-minute idle poll while the backlog is empty **and** nothing of this run's is in flight, and at the 60-second polling interval in every other case (a blocked backlog, a drain, or a watch that opened while children were still merging). *Whether the parent keeps that interval as a clock of its own* is the in-flight test: with nothing in flight the watcher declines for the whole watch and never exits, so the parent sleeps the interval itself; with something in flight the wake is `pnpm josh lane:await` or the watcher's arrival exit — never a report — and the interval is only a floor on the re-ask (`backlogrun-progress.md` → "The wake exists only while something is in flight"). **Nothing is held while watching** — the working tree's hold and each drained lane were released at the last child's merge, so a watching run blocks no other run |
| `stop` | Report and finish. The reason it printed **is** the termination reason the completion report carries |

**At the drain the retrospective fires before this watch, not after it** (joshuafolkken/kit#2335):
`backlog:offer` marks the drain on the event stream and `run:step` fires the retrospective there, so the
watch that follows picks up its `auto-ok` filings. `retrospective.md` → "When it fires" is the single
source, read when `run:step` prints the step.

`--started` is when the invocation began; `--active` is when it last had work — the most recent ask
that was **not** `exhausted`, and in a resumed session the moment it picked the run up. **Refreshing
`--active` restarts the idle watch**, so an issue opted in mid-watch is picked up and the watch begins
again at its full budget. Both are ISO-8601 timestamps (`date -u +%FT%TZ`), and `--idle` without
`--active` is refused. `--merged` is what has merged and `--running` what is still in a lane; **both
count against the maximum**. **No ending abandons a lane**: whatever would have ended the run answers
`watch` while `--running` is above zero, so the lanes drain and their merges reach the report. The full
contract is `docs/josh-commands-automation.md` → "`josh backlog:budget`".

**The completion report names three things the budgets make meaningful**: how many issues this run
took, how many of them were picked up during an idle watch, and the termination reason — quoted from
what `backlog:budget` printed rather than paraphrased.

Rationale: `docs/maintainers/backlogrun-steps-rationale.md` → "Why the idle watch defaults to 30 minutes"

### The cost check is not asked during a watch

**A watch does not count towards the session cut.** The hand-off check — `pnpm josh cost --cut`,
`backlogrun-progress.md` → "The hand-off" — is asked **at a child's merge**, and a watch has no merges,
so a run that is only watching never reaches one. When the watch picks something up, the check is
asked at that child's merge in the ordinary way.

**So every cut is taken at a merge.** The one shape that puts a cut inside a watch — the backlog
answering `exhausted` while this run's own children are still merging — is the same, because the woken
session has just merged a child. A Codex parent's cut is the one taken at a dispatch instead
(`backlogrun-progress.md` → "A parent without a completion callback").

**The 8-hour whole-run bound is untouched and still outranks all of this** — it is measured from the
record's `started_at` across every cut, so a run cannot watch its way past it in 30-minute pieces.

Rationale: `docs/maintainers/backlogrun-steps-rationale.md` → "Why the cost check skips a watch"

### Where the run stops

Termination is decided by what the loop is told, never by a judgement that enough has been done:

- **`--only` ends the run once the named list is done** — there is no pool and no idle watch to fall
  through to, so the run reports and finishes; it never enters the pool loop at all.
- **`pnpm josh backlog:budget` answering `stop`** — the single decision, covering an idle watch
  running out, the backlog emptying with the watch turned off, the maximum being reached, a parked
  backlog, an unreadable listing, and the whole-run bound.
- **The whole-run 8-hour bound is unchanged and outranks both budgets**, and the idle watch lives
  inside it: `backlogrun-progress.md` → "Waiting, and never waiting forever" is still where the figure is stated,
  and `backlog:budget` is what applies it, so a run at the bound stops with candidates in hand and a
  watch still open.
- **Every one of those budgets is counted across this run's own session cuts**, from the record
  `pnpm josh run:carry` keeps rather than from a count held in the current session — "The session cut
  is inside the invocation" above.
- **The guards in `backlogrun.md` → "Guards"** apply unchanged, counted over the whole `backlogrun`
  rather than per epic: children per run, Issues filed per run, and consecutive child failures. The
  maximum above is a person's declaration of scale and does not replace any of them — whichever binds
  first ends the run.
- **A `needs-human-review` child stops the whole run** before its commit — `needs-human-review.md`, which is
  the single source, and `backlogrun-park.md` → "`needs-human-review` — the one stop that is not a park" for
  what happens to its lane.
- **The hand-off check** — `pnpm josh cost --cut` at every child's merge, and the lane
  hand-over that follows an `over` — is `backlogrun-progress.md` → "The hand-off", unchanged. It is
  **not** asked during an idle watch: "The cost check is not asked during a watch" above, nor by the
  supervisor's `backlog:drive`, which has no session to cut (joshuafolkken/kit#3156).
- **Parking is not stopping.** A child that needs a decision, and a delegated unit that stopped
  without reporting, are **parked** and the run continues (`backlogrun-park.md` → "park and
  continue"); only the consecutive-failure guard above can turn repeated parks into a stop.

## What runs once per session, not once per issue

All of these are this file's, and are reached here in the same order and for the same reasons:

| Step | Where it is defined |
| --- | --- |
| `git switch main && git pull`, then `pnpm josh latest:scope`, then `pnpm josh lane:prune` — in the primary checkout, before the first lane opens | `backlogrun-lanes.md` → "Once per repository, before the first lane opens" |
| `josh latest` on `required` only, asked once at the first child and never in a lane | `backlogrun-child.md` → "`josh latest` runs once per session, not once per child" |
| `pnpm josh run:hold <N>`'s preflight check, before each child that is not in a lane — act on what it prints | `docs/josh-commands-run.md` → "`josh run:hold`" |
| `pnpm josh run:progress --wait` in the background, `--mark` at every real report | `progress-watcher.md` → "Progress while the run is quiet" |
| `pnpm josh release:scope` once, after the last issue has merged and the last lane is closed | `followup.md` → "When `pnpm josh release` runs" |

**Two more run once per session and are this file's own**:
`pnpm josh run:carry --begin "<the invocation, single-spaced>" --owner "$PPID"` before the plan and
`pnpm josh run:carry --end` when the run finishes, and beside each of them
`pnpm josh run:wake --start` and `pnpm josh run:wake --stop` — the supervisor that continues the run
across a cut. Both pairs are "The session cut is inside the invocation" above.

**Record the invocation in the form the supervisor can rebuild: one space between tokens, and a plain
integer for each budget value** — `backlogrun --max 3`, never `backlogrun  --max 03`. The supervisor
refuses to wake on a record its own rebuild would rewrite: the first cut ends the run with a `warning`
Telegram, so write the canonical form rather than the keystrokes.

**`pnpm josh epic:audit` is not run.** There is no epic to audit — the run began from the backlog, the
same reason this file skips it when it began from a bare Issue. `backlog:next` reuses `epic:next`'s
own read and classify and answers `error` rather than guessing when it cannot resolve one.
