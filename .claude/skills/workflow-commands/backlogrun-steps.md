# `backlogrun` — the detailed procedure behind the manifest

**This is the detailed procedure behind `backlogrun.md`'s manifest, relocated here so the entry read
carries the manifest, not the prose** (joshuafolkken/kit#2190). `backlogrun.md` is the resident
manifest; it routes here for the fine print of each step, read on demand rather than at the entry.
This file is **reference-only** and is read at its point of use — it is classified point-of-use in
`entry-read-set.ts`, exactly as the four `backlogrun-*.md` phase documents are, so a `backlogrun`
entry never opens it whole up front. Each section below is the single source of the rule it carries;
`backlogrun.md` points here rather than restating any of it.

## What one invocation approves

**One `backlogrun` approves every merge of every issue `pnpm josh backlog:next` offers** — the issues
carrying `auto-ok`, every child of an epic whose root carries it, **and an issue this run filed, once
it has become such a child**. A filing is placed into an epic by `pnpm josh epic:bundle`, which
`prompts/review.md` → "Review round cap" and `SKILL.md` → §2i both make **Tier A rather than
optional**; where that epic's root carries `auto-ok`, the child is offered from the next ask onwards
without anybody having labelled it.

**Two repairs that would bound this the other way are prohibited** (joshuafolkken/kit#1675): dropping
a run's own filings from the pool, and requiring a person's `auto-ok` on a child as well. What
replaces them is "The brake that replaces the promise" below.

That declaration is the authorization: **`backlogrun` declares "everything opted in", and a named
epic declares "the children of that epic".** The declaration *is* the statement of what may be
executed unattended, and that is the one thing a run must not leave ambiguous — which is why what runs
is stated by the keyword and its arguments, never inferred from the shape of a request.

**Which issues may be opted in stays a person's decision.** `auto-ok` is applied only by a person —
this file is that rule's single source, now that `backlogrun` owns the opted-in pool
(joshuafolkken/kit#1965) — and a run that labelled its own inputs would be widening its own
authorization. The split is: **which ones carry the label, a person; in what order and how many at
once, the run.** **What a run does move is the pool's contents**: an issue it files and bundles into an
already opted-in epic is offered from the next ask onwards, and the brake below bounds that quantity
rather than the membership.

**The end-of-run retrospective is the one carve-out, revised here rather than worked around**
(joshuafolkken/kit#2328). When a run drains its backlog, the retrospective files the improvements worth
carrying into the next run and applies `auto-ok` to them, so the next run can pick them up without
waiting for a person — the single path on which a run labels its own input. This is not the
self-widening the rule guards against, because the brakes in "The brake that replaces the promise"
below bound it with no exception: a retrospective's filings are counted against the ten-per-invocation
ceiling, the WIP cap of 30, `--max`, the 150,000-token session budget and the 8-hour whole-run bound
exactly as any other filing is. And a retrospective that judges nothing worth carrying files nothing,
so the "file → drain → file again" loop converges the moment improvements run out. Every other filing
route is unchanged: `auto-ok` stays a person's to apply.

A Tier C action inside a child still stops that child, exactly as it does for any batch child.

**A named issue is approved by the keyword and its number, not by `auto-ok`** (joshuafolkken/kit#1984).
`backlogrun #N1 #N2 …` runs those issues whether or not they carry the label — typing them is the
authorization, exactly as `queue` was explicit authorization to merge each of its issues. The pool
that follows is unchanged: still `auto-ok`, still a person's to opt in. "Named issues run first, in
order" below is the procedure.

### The brake that replaces the promise

**The promise was an authorization boundary rather than a convenience**, so withdrawing it without
putting something in its place would leave "file → run → file again" with no ceiling at all — the
self-widening `split-assessment.md` refuses when it forbids a `fullrun` promoting itself to a batch.
**What bounds it now is the invocation's own budget, and every part of that is counted in the carry
record rather than in the conversation** ("The session cut is inside the invocation" below):

| The bound | What it limits | Where it is counted |
| --- | --- | --- |
| `--max` | how many issues one invocation may merge — a run's own filing competes for that number rather than extending it | `run:carry --merged` |
| `--idle`, and the 8-hour whole-run bound | how long one invocation may go on looking for more | the record's `started_at` |
| **Ten filings per invocation** | how much one invocation may add to the pool at all, on **every** filing route (`SKILL.md` → §2d) | `run:carry --filed` |
| The WIP cap of 30 open issues | how large the pool may become, across invocations | `prompts/collaboration-workflow/wip-cap.md` |

**The last two are what actually replace the promise, and the first of them is why the loop
terminates**: one invocation may add at most ten issues to the pool and merge at most `--max` of
them, after which the run ends and the next one waits for a person to type the keyword. The old
promise bounded the *kind* of work that could run; these bound the *amount*, which is the only thing
left to bound once a run's own filings are admitted deliberately.

**Two filing routes are exempt from the depth test (`SKILL.md` → §2i), and the ten-filings ceiling
still covers them:**

- **`route:tier-a` and `route:interrupt` stay exempt** — a filing the run cannot proceed without is
  citing its own blockage by construction. **Their number is still capped**: §2d's ten-filings
  ceiling is stated "at every entry point", and `run:carry --filed` counts it across session cuts.
- **A review branch-2 filing stays exempt** because it has already cleared a bar the discretionary
  route has not — a confirmed defect reaching a runtime path, with a written failure scenario — and
  gating it on a citation as well would drop the one kind of finding both documents agree is never
  dropped.

**This section is the single source of how the `epic:bundle` obligation and this authorization
boundary meet.** `SKILL.md` → §2i points here rather than restating it.

## Named issues run first, in order

**`backlogrun #N1 #N2 …` runs the named issues before it touches the pool** (joshuafolkken/kit#1984,
folding in the old `queue` keyword). They run in the order they were typed, **one at a time — no
lanes**, because the order is the point of naming them. Only once the named list is exhausted does the
loop below drain the opted-in backlog. A bare `backlogrun` names none and starts straight on the loop,
exactly as it always did.

**`pnpm josh backlog:plan #N1 #N2 …` reports the whole plan** — the named prefix first, in order, then
the pool — so the person sees the shape of the run before anything starts. `scripts/backlog/backlog-named.ts`
is the single source of that order and of the failure branch below; the plan renders it rather than
restating it.

**Each named issue is a full `fullrun` in a delegated unit**, exactly as a backlog child is
(`backlogrun-child.md` → "Each child runs in a delegated unit"), and the once-per-session steps — `josh latest`
on `required`, the progress watcher — run once for the whole invocation, never per issue
("What runs once per session, not once per issue" below). Between issues, `pnpm josh ms`
brings the previous merge into the checkout the next one implements in. The parent reads each issue's
state back from GitHub — `pnpm josh issue:state <N>` — never the unit's summary.

**A named issue that cannot finish parks, and the rest of the named list is skipped** — starting the
issues after it would break the order they were named in. **The run does not stop there**: it goes on
to drain the opted-in backlog, and the completion report lists the named issues it did not start.
`backlog_named.after_failure` is the single source.

- A named issue read back `CLOSED` — merged, or already `already-done` — is finished; continue with the
  next.
- A **`needs-human-review`** named issue stops the whole run before its commit (`SKILL.md` → §2z),
  exactly as any child does — the named issues after it are not started and neither is the pool.
- Everything else about running one — the verification gate, the hand-off, the guards — is
  this file's and is not restated here.

**`--only` runs the named list and stops there, draining no pool** (joshuafolkken/kit#1984) — the old
`queue`'s scope kept under one keyword. `backlogrun #N1 #N2 … --only` runs the named issues in order and
ends, and the completion report says in one line that `--only` held it back from the opted-in backlog.
A named issue that fails **under `--only` ends the run** rather than falling through to a pool, and the
issues after it are skipped as ever. **`--only` with no named issues has nothing to run and is refused
before anything starts.** `backlog_named.startup` is the single source of both, and
`pnpm josh backlog:plan #N1 #N2 … --only` renders the named-only plan the run will take.

## The session cut is inside the invocation

**This section is the single source of the mechanism.** The record, the two commands, the answer table
and what each one means are all here. **A named-issue `backlogrun #N1 #N2 …` pins its list across the
cut**: the record keeps the **opening** list at every cut, and the issues it has finished live in the
record's `done` field rather than shrinking the string — a resumed session reads `remaining` from
`pnpm josh run:carry --json` and runs those, then drains the pool as ever. **`--only` rides in that
invocation string like every other token**, so a resumed session runs the remaining named issues and
**stops** rather than draining the pool the person excluded.

**Typing `backlogrun` once authorizes the declared budget, and a session cut is an execution detail of
spending it** (joshuafolkken/kit#1714). `backlogrun-progress.md` → "The hand-off" stops the _session_ at the seam;
under `backlogrun` that seam does not stop the _run_. The next session picks the same invocation up
and carries on with the budget already partly spent.

**A resumed session's carried-over lanes are polled beside new work, never waited out** —
`backlogrun-progress.md` → "A carried-over merge does not stand in front of the next lane" is the
single source.

**This is not an exception to the explicit-invocation rule above.** What §0 forbids is **inferring** a
workflow from the shape of a request; it never required the keystroke to land in every session's
transcript. A resumed session is a machine continuing an authorization a person gave, exactly as a
delegated child runs `fullrun` in a unit where nobody typed the keyword.

**The authorization boundary is carried by the budget, not by the keystroke.** So the budget has to
survive the cut, and the conversation is the one place it cannot live:

```bash
pnpm josh run:carry --begin "backlogrun --max 5 --idle 30" --owner "$PPID"   # alias: josh rc
pnpm josh run:carry --json                                                   # read it back in a resumed session
```

**`--owner "$PPID"` is not decoration.** It names the parent loop's own long-lived process, which is
what lets the command answer `busy` instead of letting a second parent count into a budget that is
still being spent. Left off, the record declares no owner and every standing record reads as not
provably live — refused rather than resumed, so nothing is lost silently, but the useful half of the
answer is gone. When the sandbox cannot read a process-start token, a live PID is conservatively held
as `busy`: stopping on a reused PID costs a decision, while replacing a genuinely live owner creates
two parents on one budget.

**Ask it before the plan, in the same turn as the first `git switch main && git pull`.** The contract
is `docs/josh-commands.md` → "`josh run:carry`"; what this loop does with each answer is here:

| It answers   | What the run does                                                                                                                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `began`      | Nothing was carried. This is the invocation's first session: report the plan and run the decision pass as written below                                                                                                     |
| `resumed`    | **This session is continuing a run that was cut** — a `--cut` handed the record off, or a `--resume` adopted it. Read the record with `--json` and take the budget figures from it, never from this session's own zero. Report the plan again — the pool has moved — and skip nothing else |
| `busy`       | The record's **owner process is still running and no cut handed it off**: another parent is spending this budget right now. **Stop; do not open a lane.** Counting into it would put two parents on one record. (A record a `--cut` _did_ hand off answers `resumed` here even with its owner still alive — joshuafolkken/kit#1935.) Nothing here is yours to end — either that run finishes and ends its own record, or a person decides it is over |
| `standing`   | A record is here that **no cut or supervisor handed off** — an unwatched crash, and the same command retyped over it. **Stop; do not open a lane**, and do not guess: the choice is the person's. Report the two commands the answer names — `pnpm josh run:carry --resume "<invocation>" --owner "$PPID"` to carry that budget on, or `pnpm josh run:carry --end` and begin again to discard it. The `--owner` belongs to the resume as much as to the begin: adopt without it and the record declares no owner, so `busy` degrades to `standing` for every parent after |
| `mismatch`   | A record is here for a **different** invocation — a run that never reached `--end`. **Stop; do not open a lane.** Resuming into it would spend that run's `--max` and its hours. End it deliberately, with `pnpm josh run:carry --end`, once you know that run is over |
| `expired`    | The 8-hour whole-run bound is spent. **Where a `--cut` handed the record off it is this run's own bound**, so this is the verdict on standard output and the run ends: report it and stop, and clear the record with `pnpm josh run:carry --end` once it is genuinely over. Where nothing handed it off it is printed on standard error ahead of a `began` instead — a person typing the keyword again over a spent record is starting a new run, and the record is replaced. A `--resume` over a spent record answers `expired` and adopts nothing |
| `unreadable` | Report what it printed and **stop before opening a lane**. A budget that cannot be carried is a run that restarts it at the next cut, which is the whole defect                                                             |
| `unknown`    | The same — the repository's git directory could not be read, so nothing was established                                                                                                                                    |

**The record is the parent loop's, and a lane never touches it.** The parent is what reads GitHub to
verify a child merged (`backlogrun-child.md` → "Each child runs in a delegated unit"), so it is also what
counts that merge — one sequential loop writing one record, with no two lanes writing it at once. A
delegated unit is briefed with its child and nothing about the invocation's budget. **`--begin` claims
the record exclusively and names the owning process, so a second parent is answered `busy`** rather
than counting into a budget somebody else is spending.

**Count into the record rather than into your head** — `--merged 1 --owner "$PPID"` at every child's
merge, `--filed 1 --owner "$PPID"` at every Issue this run files, and `--cut --owner "$PPID"`
immediately before the cut. Every counter is an increment and the command owns the sum, because a run
sending a total would be sending arithmetic done in its head. **`--owner "$PPID"` is not optional on a
count**: a count that does not name the record's owning process is refused, so a session whose record a
successor took over cannot advance a budget that is no longer its own.

**`--cut` hands the record off, and so does `run:wake` for a dead owner** (joshuafolkken/kit#2437): the
next `--begin` naming the same invocation answers `resumed` — **even while the cutting process is still
running**, so a cut is handed to exactly one successor rather than stalling every resume with `busy`.

**So `--cut` is the session's last write to the record**: count everything the session has, then cut.
A `--merged` or `--filed` issued after the `--cut` is **refused**, so the hand-off is protected rather
than silently spent.

**`backlog:budget` is then fed from the record, never from a count kept in the conversation:**
`--started` takes the record's `started_at` and `--merged` its `merged`. That one substitution is what
makes `--max` and the 8-hour whole-run bound count **across** cuts, as one invocation's worth. **The
10-filings-per-run ceiling is counted the same way**, from `filed`. **`--idle` is the one budget that
is not carried**, and a cut can only reach a watch that opened while this run's own children were
still merging — the one shape where the two overlap. A resumed session then states its resume moment
as `--active` and the watch begins again at its full budget, bounded by the 8 hours as everything
else is: "The cost check is not asked during a watch" below.

**How many cuts the run crossed is named in the completion report**, read from the record's `cuts`. A
run reporting only what it merged would hide that it spanned four sessions.

**End the record when the run ends** — `pnpm josh run:carry --end`, **after the final report and never
batched with it**: `run:report` scopes by the record `--end` removes (joshuafolkken/kit#2393). The next
`backlogrun` then begins its own budget rather than resuming a spent one. **Where the run ends by _stopping_ rather than finishing** — `backlog:budget` or `epic:next`
answered `stop` (a parked backlog, an unreadable listing, the maximum, the whole-run bound), or the
consecutive-failure
guard tripped — **end it with `pnpm josh run:carry --end --stopped "<one-line reason>"` instead**. That
pushes one ⏸️ confirmation as it clears the record, so a person learns the run halted even when the
session was cut and this parent headless (joshuafolkken/kit#2136); the reason is the stop verdict's, in
the session language. A clean completion takes the bare `--end` and stays silent, having its own report;
a parked _child_ is pushed by the child that parked it (`backlogrun-park.md`). Because `--end` removes
the record, a re-run's second `--end` finds nothing and never re-sends that confirmation —
`backlogrun-progress.md` →
"Progress while the run is quiet" is the single source of the pull-versus-push split.

**The record widens nothing.** It carries a budget and nothing else: `auto-ok` is still applied only
by a person, so a cut adds no rule about which issues may be offered. **The pool itself may have
grown across the cut** — an issue the first session filed, and `epic:bundle` placed under an already
opted-in epic, is offered to the resumed one — and that is "What one invocation approves" rather than
anything the record did. The ceiling on it is counted across cuts too, from the record's `filed`.

**Nothing waits for a person any more — `pnpm josh run:wake` supervises the driver**. After a cut or
dead-owner recovery, it adopts the carry record and runs `backlog:drive` itself. The driver dispatches,
collects, watches and reports without starting a parent AI session. Only a returned branch that needs
judgment starts an AI session, with the branch result and resume flags in its prompt.

**Start it in the same turn as `--begin`, and stop it in the same turn as `--end`:**

```bash
pnpm josh run:wake --start   # alias: josh rw ; right after `run:carry --begin`
pnpm josh run:wake --stop    # in the same turn as `run:carry --end`
```

**It reads the same record this section already keeps.** A handed-off carry record, or one whose owner
died, starts the driver. The supervisor adopts that record before the driver counts a merge; a live
owner prevents a second driver from taking it over. On `none`, `expired` or `unreadable` it stops. The
8-hour whole-run bound therefore still comes from the carry record. **A new authorization is still a
person's**: the supervisor spends the declared budget and never declares another.

**What may be run is untouched.** The driver takes named issues from the invocation and pool issues
from the existing offer command. The supervisor writes no `auto-ok` label. A judgment session receives
the original invocation plus the driver's reason and resume state.
For a named epic, the driver hands off `epic #N` with the original invocation. The judgment session
follows the named epic procedure and dispatches its children; the epic root is never launched as a
standalone `fullrun` child. The named prefix also consults the carried maximum and whole-run bound
before each launch, and a failed named issue skips the remaining named prefix.

**A failure is visible rather than silent.** A judgment wake that never claims the carry record is retried, and
once the retries are spent the supervisor stops and sends a `warning` Telegram; a carry record that
expired or cannot be read ends it the same way. `none` — the run having finished — and a person's own
`--stop` stay silent. Everything the supervisor starts writes to one log file per repository, named by
`--list` and by every warning, so a silent exit stays diagnosable.

**A person keeps control of it.** `pnpm josh run:wake --list` names the running supervisor and
`--stop` ends it; the full contract, what it launches and why that is a constant rather than a
setting are `docs/josh-commands.md` → "`josh run:wake`".

**Every unattended role runs with the provider selected from the invoking CLI and its own profile.**
Codex sessions use OpenAI; Claude Code sessions use Anthropic. Anthropic uses scheduler
`claude-opus-5-5`, worker `claude-opus-5-5` and reviewer `claude-opus-5-5`; OpenAI uses `gpt-6-sol`,
with role efforts `medium`/`medium`/`high` (scheduler / worker / reviewer) for both. Role overrides
resolve before launch; model overrides apply only to Claude Code, effort overrides to either provider,
and legacy `JOSH_LANE_*` values to the worker only. Invalid configuration, a missing or conflicting
session marker, or a missing, outdated or unauthenticated CLI refuses without fallback, promotion or
worker retry. `run:wake --list`, `lane:list`, the review brief and each launch
log expose the resolved provider, role, model and effort.
`docs/josh-commands.md` → "`josh lane:dispatch`" and `backlogrun-child.md` → "Each child runs in a
delegated unit" are the single sources.

**It relays progress from the existing report record.** The driver keeps the same `run:merge` event
stream and `run:report` finish path; `pnpm josh run:wake --list` relays the latest line from that
record. Telegram notifications retain their existing generation points (→ "It goes to the session only").

**The completion report names how many sessions were woken beside the record's `cuts`** — one wake per
cut is the invariant, and what counts is a carry record actually claimed, never a process started.

**The reading is scoped to `backlogrun`.** A `fullrun` cut still waits for a person's keystroke,
because it declares no budget of the kind this section leans on — it ends at one issue and has
nothing to carry.

## The plan, before the first child starts

**A `backlogrun` reports its plan before it starts anything.** Nothing is dispatched, no lane is
opened and no issue is picked up until the plan has been reported and the decision pass below has
run (joshuafolkken/kit#1652).

**The plan is one command's output, not an assembly of several:**

```bash
pnpm josh backlog:plan          # alias: josh blp
```

**It renders the same classified pool `backlog:next` answers from**, so **the plan cannot promise an
order the run does not take**. It is a separate command rather than a flag because `backlog:next`'s
standard output is one bare token per line and a plan printed there would break the loop below. Its
four sections are:

- **Ready now** — the runnable children, grouped by repository. **The grouping is the parallelism**,
  not a presentational choice: a lane is per repository, so the bundles are how wide this run can go.
- **Waiting** — every withheld child, each naming **what it is waiting on**: the blocking issue
  numbers, a run that already has it, or that it is ready but past the offer this ask could make.
- **Waiting on a person** — the `needs-decision` children, which is the next subsection's input.
- **Out of scope** — every open issue the backlog will **not** run, with the reason, so "not opted in"
  is distinguished from "not reached yet".

**Report all four to the person, in the session language, before the first child starts.** Epic
children are enumerated individually rather than summarized under their root. A `⚠` about a truncated
listing is reported with them: the plan is then partial, and saying so is what keeps it from reading as
complete.

### Resolve what the plan can resolve, before starting

**Every `needs-decision` issue the plan listed is settled in one pass at the start, rather than one
stop at a time.** The point is to spend a person's attention once, up front, instead of interrupting
an unattended run over and over.

- **Decide everything decidable from the issue itself.** Read the issue's body **and its comments**
  (`SKILL.md` → §2g), and where the answer is already there, record it as an Issue comment and
  **remove the label** — `CLAUDE.md` → "Decision autonomy" already makes that Tier A, and a child
  whose decision is recorded while its label still stands is parked for no reason. **Read every one
  of them in one call** — `pnpm josh issue:read <N> <N> …`, the numbers the plan just listed under
  "Waiting on a person" — rather than a `gh api` pair per issue. This pass is where a parent reads the
  most issues in a row, and a parent's cost grows as n²/2 in its own request count
  (joshuafolkken/kit#1567), so a turn removed here is worth more than a turn removed inside a child.
- **Never measure in order to decide.** A question needing a benchmark, a profile, or a run of the
  thing itself is not settled here: it stays labelled and the plan says so. This pass is a cheap
  read, not a research task, and turning it into one would put the whole backlog behind it.
- **Label what you find.** An issue that turns out to need a person's judgement has `needs-decision`
  applied — the same label a parked child gets, applied the way `backlogrun-park.md` → "park and continue"
  applies it. **The next plan then classifies it by reading the label alone**, never by reading the
  body again, so the cost of this pass falls on every subsequent ask instead of repeating.
- **Then start the loop.** Whatever is still labelled is reported as parked and left standing; the
  run does not wait on it.

**`needs-decision` is the one workflow label a run may apply, and it is neither `auto-ok` nor
`needs-human-review`.** Those two widen or withhold what may be *executed* and stay a person's alone
(this file, `SKILL.md` → §2z). This one records only that a person's answer is needed, which is a
finding rather than an authorization — which is why a run parks with it and a person clears it.

## The loop

**The detached `run:wake` supervisor runs `backlog:drive`** after the carry record is handed off.
Its driver keeps the loop below running without a parent AI turn. A returned judgment branch includes
the first-line verdict, affected issue and `resume:` flags in the AI prompt; `stop` reports and ends
inside the driver. This uses the same command and decisions as the former parent-launched wait.

**The loop's head is one command — `pnpm josh backlog:offer`** (joshuafolkken/kit#2162). It runs
`backlog:next`, maps its answer to the budget word the table below fixes, runs `backlog:budget`, and
returns the verdict with the issues to start. It stays both halves' contract source: what an answer
*means* changes here.

```bash
offer=$(pnpm josh backlog:offer --started "$started" --active "$active")   # alias: josh blo
offer=$(pnpm josh backlog:offer --started "$started" --active "$active" --exclude 1630,1631)   # after #1630, #1631 merged
```

**The first line of standard output is the budget verdict; on `run`, the issue numbers to start
follow, one per line.** `backlog:offer` forwards `--exclude` and `--repo` to `backlog:next` and
`--started` / `--active` / `--merged` / `--running` / `--max` / `--idle` to `backlog:budget`, computes
`--answer` itself, and carries the consecutive-retry count on the last stderr line (`retries: <n>`) and
in `--json`. **The verdict table is "The two budgets" below; the answer-to-word mapping it applies is
this section's table.**

**`backlog:next`'s output contract is `docs/josh-commands.md` → "`josh backlog:next`", and four parts
of it decide how the mapping is written:**

1. **Standard output is one token per line, and everything else is standard error** — so `answers`
   holds something a loop can branch on.
2. **The tokens are bare issue numbers, scoped to the repository the command runs in.** A runnable
   child in *another* repository is reported on standard error with its repository and checkout, and
   is never a token; this repository having no candidate of its own is answered `wait`. **So
   `backlogrun` takes no `owner/repo#N` token.** A qualified token was implemented and withdrawn,
   because `--exclude` parses bare integers and feeding one back produces a usage error rather than
   an exclusion (joshuafolkken/kit#1630). Report the other repository's candidates in the run summary
   and leave them to a session running there (`backlogrun-lanes.md` → "Concurrency").
3. **The verdict words are `wait`, `stop`, `retry`, `error` and `none`** — `none` is `epic:next`'s
   `complete` under this command's spelling, and there is no `complete` here. **`retry` is the one
   with no `epic:next` counterpart**: it says GitHub did not answer, which is a statement about the
   connection and not about the graph (joshuafolkken/kit#1663).
4. **Exit code 0 covers all five verdicts, and 1 means the listing could not be read** — no answer at
   all. **`error` cannot be told apart by exit code, so read the token rather than the status.**

**What the answer means is this table's; whether the run may act on it is `pnpm josh backlog:budget`'s**
(joshuafolkken/kit#1632). The right-hand column ends in the word each answer is handed to that command
as. Nothing here decides an ending on its own — the two budgets and every termination live in the next
subsection.

| Answer | What to do | Budget answer |
| --- | --- | --- |
| One or more issue numbers | Start each one as a child, up to the free lanes — `backlogrun-lanes.md` → "Lanes" and "Each child runs in a delegated unit", unchanged. Then **ask the command again**, with the merged numbers added to `--exclude` | `candidates` |
| `wait`, with something of this run's own still in flight | Everything opted in is blocked or already running, so waiting can still change the answer. **Ask the command again on the wake the progress watcher's exit delivers** — the parent starts no sleep of its own, and the interval is a floor on the re-ask rather than a clock (`backlogrun-progress.md` → "Waiting, and never waiting forever" and "The parent keeps no clock of its own") | `blocked` |
| `wait` this checkout can never resolve — the only candidates the command reported on standard error are in other repositories, and this run has nothing of its own in flight | Report those candidates with their checkouts. **Waiting cannot resolve them, but a person opting a new issue in here still can**, so the ending is the idle watch's rather than this row's | `exhausted` |
| `stop` | Nothing can proceed without a person. Report the parked issues and finish | `parked` |
| `retry`, on fewer than three consecutive asks | GitHub did not answer, so the graph was never read. Sleep the polling interval and **ask the command again** — **this is one of the states with no watcher-delivered wake**, because the outage that produced `retry` stops the watcher reading too and a declined watcher does not exit (`backlogrun-progress.md` → "The wake exists only while something is in flight"). This is the one answer re-asking is allowed on, and the count is consecutive: any other answer resets it to zero | `blocked` |
| `retry` for a third consecutive time | The outage is not a hiccup. Report what the command printed on standard error and finish | `unreadable` |
| `error` | The graph could not be resolved — report what the command printed on standard error and finish. **Never re-ask hoping for a different answer**, and never fall back to picking an issue by hand: that would be the run choosing its own membership | `unreadable` |
| `none` | Nothing opted in is left | `exhausted` |
| Exit 1, empty standard output | The listing could not be read. Report it and finish — **it is not `none`**, and reading it as one would report an empty backlog that was never seen | `unreadable` |

**Re-asking on `retry` is not the exception to the `error` rule** (joshuafolkken/kit#1663): `error`
forbids a run answering its own question, while `retry` means the command never got an answer to read,
so asking again is the same question rather than a second opinion. **Three consecutive `retry` answers
end the run**, and any other answer resets the count to zero, so `backlog:budget` is told `blocked`
while retries remain and `unreadable` on the third.

**Feed every issue this run has merged back through `--exclude`.** GitHub applies `closes #N`
asynchronously, so a just-merged issue can still read as open on the next ask and be offered a second
time. The flag takes a comma-separated list and may be repeated; it drops the issue from every bucket
rather than only from the offer.

**A short offer is not proof the backlog is empty.** The standalone half of the pool is capped at the
same five rows the `🗒 Next issues` display shows, so a sixth opted-in issue simply appears on the
next ask. An epic's children are not capped that way — they come through the epic's own graph.

**The epic side is found server-side by the `epic` label.** An epic that never received the label is
invisible to the listing, so nothing knows it tracks anything at all (joshuafolkken/kit#1633). This is
a known limit of the listing, recorded rather than worked around; do not assert the opposite anywhere.

**A child is offered on its own `auto-ok` unless the epic tracking it is opted in**
(joshuafolkken/kit#1668). An epic that **is** opted in owns its children entirely — it sequences them,
so offering one beside it would hand the same issue over twice; ordering survives the standalone route
on the children's own `blocked-by` relations, which `--ordered` records.

**An order between two epics holds too** (joshuafolkken/kit#1943). A `blocked-by` relation whose
blocker sits in another opted-in epic — or is an opted-in standalone issue — makes the child wait on
time, so one `backlogrun` runs both epics in that order without the person sequencing the commands. A
blocker outside the opted-in backlog, or one inside it that itself waits on a person, makes the child
wait on a person instead, and a cycle across epics
answers `error`. The table is `docs/josh-commands.md` → "`josh epic:next`".

**New work is picked up without restarting anything.** The command re-derives its pool from GitHub
labels on every ask, so an issue filed and opted in while the run is going is offered on the next
iteration.

### The two budgets

**A `backlogrun` may declare how long it will watch an empty backlog and how many issues it may
take** (joshuafolkken/kit#1632). Both are written on the keyword, and **the idle watch is on by
default while the maximum is not** (joshuafolkken/kit#1676):

```
backlogrun               # watches for 30 minutes after the backlog empties
backlogrun --idle 0      # finishes the moment the backlog empties
backlogrun --idle 0 --max 5
```

| Budget | Written | Default | What it does |
| --- | --- | --- | --- |
| Idle watch | `--idle <minutes>` | **30 minutes** | After the candidates run out, keep polling this long for a new one. A candidate that appears restarts the watch from that moment |
| Maximum issues | `--max <count>` | unlimited | How many issues this invocation may take. On reaching it the run reports and finishes |

**`--idle 0` is how the watch is turned off, and it is the only way** (joshuafolkken/kit#1676):
`backlogrun --idle 0` finishes at the first empty backlog, exactly as a bare `backlogrun` did before.

**Why 30 minutes** (single source `scripts/backlog/backlog-budget.ts` → `DEFAULT_IDLE_MINUTES`): it is
about the length of one child (12–28 minutes), so a run that has emptied its backlog waits roughly as
long as one more issue would have taken. **A watch is polled every 5 minutes, not at the loop's
60-second interval** — it is waiting on a person, on human timescales, and the reason `backlog:budget`
prints names the interval so the loop reads it rather than remembering it.

**Why an idle watch is safe.** To become a candidate an issue needs `auto-ok`, which only a person
applies — except an issue this run filed and bundled under an already opted-in epic, which is admitted
("What one invocation approves") and bounded by the brake there, never the watch. No issue nobody
opted in is ever picked up during a watch.

**`backlog:offer` asks `backlog:budget` for you on every iteration** — it maps `backlog:next`'s answer
to the word the table above fixes and hands it over, so the loop makes the one call and reads back the
verdict:

```bash
offer=$(pnpm josh backlog:offer --started "$started" --active "$active" \
  --merged <count> --running <count> --retries <count> [--idle <minutes>] [--max <count>])
```

**`--active` is required of every ask, because the watch is on unless it was turned off** — an
invocation whose watch is on and that carries no `--active` is **refused** by `backlog:budget`, so an
emptiness nobody watched cannot be reported as an ordinary `stop`. Only `--idle 0` excuses it.
**`--running` also decides `wait` and `--retries` decides `retry`** — the two context branches the
table above carries, now applied inside the command from the counts the loop already tracks.

| Verdict | What the loop does |
| --- | --- |
| `run` | Start what `backlog:next` offered, up to the free lanes. The reason names how many more the maximum still allows; start no more than that |
| `watch` | Ask both commands again — at the 5-minute idle poll while the backlog is empty **and** nothing of this run's is in flight, and at the 60-second polling interval in every other case (a blocked backlog, a drain, or a watch that opened while children were still merging). *Whether the parent keeps that interval as a clock of its own* is the in-flight test: with nothing in flight the watcher declines for the whole watch and never exits, so the parent sleeps the interval itself; with something in flight the wake is the watcher's exit and the interval is only a floor on the re-ask (`backlogrun-progress.md` → "The wake exists only while something is in flight"). **Nothing is held while watching** — the working tree's hold and each drained lane were released at the last child's merge, so a watching run blocks no other run |
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
contract is `docs/josh-commands.md` → "`josh backlog:budget`".

**The completion report names three things the budgets make meaningful**: how many issues this run
took, how many of them were picked up during an idle watch, and the termination reason — quoted from
what `backlog:budget` printed rather than paraphrased.

### The cost check is not asked during a watch

**A watch does not count towards the session cut** (joshuafolkken/kit#1676). The hand-off check —
`pnpm josh cost --cut`, `backlogrun-progress.md` → "The hand-off" — is asked **at a child's merge**, and a
watch has no merges, so a run that is only watching never reaches one. That is a decision rather than
an omission: a watch holds nothing (the working tree's hold and every lane were released at the last
child's merge), its cost is bounded before it starts (`--idle N` is at most `N / 5` asks), and when the
watch picks something up the run has work again and the check is asked at that child's merge in the
ordinary way.

**So every cut is taken at a merge, which is what lets a resumed session state its own `--active`**: a
woken session picks the run up seconds after the merge the cut was taken at. The one shape that puts a
cut inside a watch — the backlog answering `exhausted` while this run's own children are still
merging — is the same, because the woken session has just merged a child.

**The 8-hour whole-run bound is untouched and still outranks all of this** — it is measured from the
record's `started_at` across every cut, so a run cannot watch its way past it in 30-minute pieces.

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
  is inside the invocation" above. A resumed run that started its budget over would stop 8 hours after
  the _last_ cut instead of after the invocation, which is no bound at all.
- **The guards in `backlogrun.md` → "Guards"** apply unchanged, counted over the whole `backlogrun`
  rather than per epic: children per run, Issues filed per run, and consecutive child failures. The
  maximum above is a person's declaration of scale and does not replace any of them — whichever binds
  first ends the run.
- **A `needs-human-review` child stops the whole run** before its commit — `SKILL.md` → §2z, which is
  the single source, and `backlogrun-park.md` → "`needs-human-review` — the one stop that is not a park" for
  what happens to its lane.
- **The hand-off check** — `pnpm josh cost --cut` at every child's merge, and the lane
  hand-over that follows an `over` — is `backlogrun-progress.md` → "The hand-off", unchanged. It is
  **not** asked during an idle watch: "The cost check is not asked during a watch" above is why.
- **Parking is not stopping.** A child that needs a decision, and a delegated unit that stopped
  without reporting, are **parked** and the run continues (`backlogrun-park.md` → "park and
  continue"); only the consecutive-failure guard above can turn repeated parks into a stop.

## What runs once per session, not once per issue

All of these are this file's, and are reached here in the same order and for the same reasons:

| Step | Where it is defined |
| --- | --- |
| `git switch main && git pull`, then `pnpm josh latest:scope`, then `pnpm josh lane:prune` — in the primary checkout, before the first lane opens | `backlogrun-lanes.md` → "Once per repository, before the first lane opens" |
| `josh latest` on `required` only, asked once at the first child and never in a lane | `backlogrun-child.md` → "`josh latest` runs once per session, not once per child" |
| `pnpm josh run:hold <N>`'s preflight check, before each child that is not in a lane | `backlogrun-child.md` → "Preflight" |
| `pnpm josh run:progress --wait` in the background, `--mark` at every real report | `backlogrun-progress.md` → "Progress while the run is quiet" |
| `pnpm josh release:scope` once, after the last issue has merged and the last lane is closed | `followup-reference.md` → "When `pnpm josh release` runs" |

**Two more run once per session and are this file's own, not this file's**:
`pnpm josh run:carry --begin "<the invocation, single-spaced>" --owner "$PPID"` before the plan and
`pnpm josh run:carry --end` when the run finishes, and beside each of them
`pnpm josh run:wake --start` and `pnpm josh run:wake --stop` — the supervisor that continues the run
across a cut. Both pairs are "The session cut is inside the invocation" above.

**Record the invocation in the form the supervisor can rebuild: one space between tokens, and a plain
integer for each budget value** — `backlogrun --max 3`, never `backlogrun  --max 03`. What the
supervisor hands the next session is composed from constants and the validated integers rather than
copied out of the record, and it refuses to wake on a record its own rebuild would rewrite, because the
woken session hands that text straight back to `run:carry --begin` to be compared character for
character. A record written some other way is not lost quietly — the first cut ends the run with a
`warning` Telegram — but it ends the run, so write the canonical form rather than the keystrokes
(joshuafolkken/kit#1719).

**`pnpm josh epic:audit` is not run.** There is no epic to audit — the run began from the backlog, the
same reason this file skips it when it began from a bare Issue. The dependency graph the loop acts
on is still audited in effect, because `backlog:next` reuses `epic:next`'s own read and classify and
answers `error` rather than guessing when it cannot resolve one.
