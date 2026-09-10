# `backlogrun` — Unattended execution of the opted-in backlog

`epicrun` names an epic and runs its children. `queue` names the issues and the order by hand.
**`backlogrun` names nothing.** It runs whatever `pnpm josh backlog:next` offers — the whole opted-in
backlog, which is every issue carrying `auto-ok` plus every child of an epic whose root carries it,
ordered by dependency and grouped into waves that may run beside one another
(joshuafolkken/kit#1631).

**Before it existed the backlog could only be reached after something else had finished.** The
`auto-ok` pickup runs when `epic:next` answers `complete`, or once a bare-Issue `epicrun` has merged;
there was no door that started *from* the backlog. So a person who wanted the opted-in issues run in
the best order had to create an epic first, and creating one was itself the bottleneck this entry
point removes.

**Read `epicrun.md` alongside this file.** Everything about *running a child* is that document's and
is deliberately not restated here — lanes, park-and-continue, the `needs-human-review` stop, a
prerequisite discovered mid-run, the delegated unit and its summary bound, the preflight, `josh
latest` once per session, the progress watcher, the hand-off check and the guards. What this file
carries is the part that is genuinely different: **which issues are offered, and under what
authorization.**

## Explicit invocation required (MANDATORY)

**Never start a `backlogrun` unless the user has typed the keyword in the current turn's prompt.**
This is the same rule the other five entry points carry, at the same strength — `SKILL.md` → §0 is
its single source, and `CLAUDE.md` → "Explicit invocation required (MANDATORY)" is where it stays
resident so it binds on a turn where nothing here has been read.

It matters more here than anywhere else, because this is the entry point with the widest
authorization:

- Conversational requests — "clear the backlog", "work through the `auto-ok` issues", "keep going" —
  are **NOT** invocations. Do not infer authorization from the shape of the request.
- Do **NOT** ask "Shall I run `backlogrun`?". A confirmation question is not a substitute for the
  keyword.
- Prompt the user to type it, in the exact phrasing: "Please run `backlogrun` to start this task."
- An earlier turn's authorization does not carry. Each invocation is re-typed.

**The keystroke starts the invocation; it does not have to land in every session that invocation
spans.** A `backlogrun` cut mid-run and resumed is still that one invocation, and "The session cut is
inside the invocation" below is where the boundary is drawn. The last bullet is about an _earlier
turn's_ authorization, which is a different thing: a run whose budget is spent, or one that never
began, has nothing to carry and needs the keyword again.

## What one invocation approves

**One `backlogrun` approves every merge of every issue a person has opted in with `auto-ok`** — the
issues carrying the label, every child of an epic whose root carries it, and the issues the run files
itself — **filing them, not running them**: an issue this run creates carries no `auto-ok`, so
`backlog:next` never offers it and no later iteration picks it up **unless a person opts it in**.
That is `epicrun`'s authorization with the epic boundary taken off, and it is why this is a
**separate keyword rather than an argument to `epicrun`**: `epicrun #E` declares "the children of
`#E`" and `backlogrun` declares "everything opted in". The declaration *is* the statement of what may
be executed unattended, and that is the one thing a run must not leave ambiguous. An argument would
have made the two declarations differ only by whether a number happened to follow the keyword.

**What may be run stays a person's decision.** The run decides the order and what may go in parallel;
it never decides membership. `auto-ok` is applied only by a person — `epicrun.md` → "After the epic —
issues opted in with `auto-ok`" is that rule's single source — and a run that could label its own
inputs would be widening its own authorization, which is exactly the self-widening
`split-assessment.md` refuses. The split is: **which ones, a person; in what order and how many at
once, the run.**

A Tier C action inside a child still stops that child, exactly as under `epicrun`.

## The session cut is inside the invocation

**Typing `backlogrun` once authorizes the declared budget, and a session cut is an execution detail of
spending it** (joshuafolkken/kit#1714). `epicrun.md` → "The hand-off" stops the _session_ at the seam;
under `backlogrun` that seam does not stop the _run_. The next session picks the same invocation up
and carries on with the budget already partly spent.

**This is not an exception to the explicit-invocation rule above — it is what that rule already
says.** What §0 forbids is **inferring** a workflow from the shape of a request; it has never required
the keystroke to land in every session's own transcript. `epicrun.md` → "Each child runs in a
delegated unit" applies exactly that reading today: a delegated child runs the whole `fullrun`
procedure in a unit where nobody typed `fullrun`, on the strength of the keyword a person typed once.
A resumed session is the same shape — a machine continuing an authorization a person gave, never a
model deciding on one from a request's shape. Read the other way, the entry point built for
unattended execution spends most of its unattended hours waiting for a keystroke, which is the defect
joshuafolkken/kit#1714 was filed for.

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
answer is gone.

**Ask it before the plan, in the same turn as the first `git switch main && git pull`.** The contract
is `docs/josh-commands.md` → "`josh run:carry`"; what this loop does with each answer is here:

| It answers   | What the run does                                                                                                                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `began`      | Nothing was carried. This is the invocation's first session: report the plan and run the decision pass as written below                                                                                                     |
| `resumed`    | **This session is continuing a run that was cut** — a `--cut` handed the record off, or a `--resume` adopted it. Read the record with `--json` and take the budget figures from it, never from this session's own zero. Report the plan again — the pool has moved — and skip nothing else |
| `busy`       | The record's **owner process is still running**: another parent is spending this budget right now. **Stop; do not open a lane.** Counting into it would put two parents on one record. Nothing here is yours to end — either that run finishes and ends its own record, or a person decides it is over |
| `standing`   | A record is here that **no cut handed off** — the crashed run, and the same command retyped over it. **Stop; do not open a lane**, and do not guess: the choice is the person's. Report the two commands the answer names — `pnpm josh run:carry --resume "<invocation>" --owner "$PPID"` to carry that budget on, or `pnpm josh run:carry --end` and begin again to discard it. The `--owner` belongs to the resume as much as to the begin: adopt without it and the record declares no owner, so `busy` degrades to `standing` for every parent after |
| `mismatch`   | A record is here for a **different** invocation — a run that never reached `--end`. **Stop; do not open a lane.** Resuming into it would spend that run's `--max` and its hours. End it deliberately, with `pnpm josh run:carry --end`, once you know that run is over |
| `expired`    | The 8-hour whole-run bound is spent. **Where a `--cut` handed the record off it is this run's own bound**, so this is the verdict on standard output and the run ends: report it and stop, and clear the record with `pnpm josh run:carry --end` once it is genuinely over. Where nothing handed it off it is printed on standard error ahead of a `began` instead — a person typing the keyword again over a spent record is starting a new run, and the record is replaced. A `--resume` over a spent record answers `expired` and adopts nothing |
| `unreadable` | Report what it printed and **stop before opening a lane**. A budget that cannot be carried is a run that restarts it at the next cut, which is the whole defect                                                             |
| `unknown`    | The same — the repository's git directory could not be read, so nothing was established                                                                                                                                    |

**The record is the parent loop's, and a lane never touches it.** The parent is what reads GitHub to
verify a child merged (`epicrun.md` → "Each child runs in a delegated unit"), so it is also what
counts that merge — one sequential loop writing one record, with no two lanes writing it at once. A
delegated unit is briefed with its child and nothing about the invocation's budget, exactly as it is
told nothing about `run:hold`'s claim on the primary checkout. **The single writer is now enforced
rather than only stated** (joshuafolkken/kit#1722): `--begin` claims the record exclusively and names
the owning process, so a second parent is answered `busy` instead of being allowed to count into a
budget somebody else is spending.

**Count into the record rather than into your head** — `--merged 1` at every child's merge, `--filed 1`
at every Issue this run files, and `--cut` immediately before the cut. Every counter is an increment
and the command owns the sum, because a run sending a total would be sending arithmetic it had done in
its head — the one-shot judgement joshuafolkken/kit#1460 measured a run walking straight past.

**`--cut` is also what hands the record off, and it is the only thing that does.** A crash never
reaches it, which is exactly why a declared cut is the one standing record the next session carries
without anybody deciding: `--cut`, then the next `--begin` naming the same invocation answers
`resumed`. Skip it and the resumed session is answered `standing` and stops for the person — the
budget is safe either way, but the run is not unattended any more.

**So `--cut` is the session's last write to the record, and "immediately before" is literal.** Any
later `--merged` or `--filed` spends the hand-off — the run said it was carrying on, and the command
takes it at its word — so a lane's merge counted after the cut costs the next session its unattended
resumption. Count everything the session has, then cut.

**`backlog:budget` is then fed from the record, never from a count kept in the conversation:**
`--started` takes the record's `started_at` and `--merged` its `merged`. That one substitution is what
makes `--max` and the 8-hour whole-run bound count **across** cuts, as one invocation's worth. **The
10-filings-per-run ceiling is counted the same way**, from `filed`. **`--idle` is the one budget that
is not carried, and it needs no carrying** — a cut is taken at a child's merge, so no cut ever falls
inside a watch: "The hand-off check is not asked during a watch" below.

**The consecutive-failure guard needs no carrying, and that is by construction rather than by
omission.** The hand-off is asked at every child's _merge_, so a cut is always taken directly after a
success — the count is zero at every seam it could have had to cross.

**How many cuts the run crossed is named in the completion report**, read from the record's `cuts`. A
run reporting only what it merged would hide that it had spanned four sessions to do it.

**End the record when the run ends** — `pnpm josh run:carry --end`, in the same turn as the final
report — so the next `backlogrun` begins a budget of its own rather than resuming a spent one.

**What may be run is untouched.** The record carries a budget and nothing else: `auto-ok` is still
applied only by a person, so a resumed session is offered exactly the issues the first one was, and
the invariant in "What one invocation approves" stands unchanged.

**Nothing waits for a person any more, and `pnpm josh run:wake` is what closed that**
(joshuafolkken/kit#1719). The record made the budget survive the cut and left the keystroke in place,
so a cut still ended with a `confirmation` Telegram and a resume line — and at a measured cut about
every 50 minutes, an entry point meant to run unattended for eight hours ran unattended for barely
one. The supervisor is the thing that starts the next session.

**Start it in the same turn as `--begin`, and stop it in the same turn as `--end`:**

```bash
pnpm josh run:wake --start   # alias: josh rw ; right after `run:carry --begin`
pnpm josh run:wake --stop    # in the same turn as `run:carry --end`
```

**It reads the same record this section already keeps, and decides from nothing else.** It wakes on
`carried` **and** handed off — which is to say on a cut this run declared with `--cut` — and stops on
`none`, `expired` and `unreadable`. So the 8-hour whole-run bound binds the waking for free: it is the
record's own expiry, and a spent budget reads `expired` and wakes nothing. **A new authorization is
still a person's**, which is decision B's boundary exactly: the supervisor spends the budget that was
declared and never declares another.

**`--cut` matters more than ever, and for the same reason.** It is what marks the record handed off,
so a session that skips it leaves a record the supervisor reads as still being spent — and nothing
wakes. The rule above is unchanged: count everything the session has, then cut, and let `--cut` be the
session's last write.

**What may be run is still untouched.** The supervisor hands the woken session the invocation the
person typed and nothing else; it writes no label, so `auto-ok` stays a person's to apply and a woken
session is offered exactly the issues the first one was.

**A failure is visible rather than silent.** A wake that never claims the carry record is retried, and
once the retries are spent the supervisor stops and sends a `warning` Telegram — which covers a wake
command that does not exist, a session that dies during boot, and one that runs without picking the
run up.

**A person keeps control of it.** `pnpm josh run:wake --list` names the running supervisor and
`--stop` ends it; the full contract, what it launches and why that is a constant rather than a
setting are `docs/josh-commands.md` → "`josh run:wake`".

**The completion report names how many sessions were woken beside the record's `cuts`**, and the two
being equal is the invariant — one wake per cut. `pnpm josh run:wake --list` prints them together, so
a run that woke fewer sessions than it took cuts is visible rather than argued about.

**The reading is scoped to `backlogrun`.** `epicrun` and `fullrun` cuts still wait for a person's
keystroke — `epicrun.md` → "The hand-off" is unchanged — because neither declares a budget of the kind
this section leans on.

## The plan, before the first child starts

**A `backlogrun` reports its plan before it starts anything.** Nothing is dispatched, no lane is
opened and no issue is picked up until the plan has been reported and the decision pass below has
run (joshuafolkken/kit#1652).

**The plan is one command's output, not an assembly of several:**

```bash
pnpm josh backlog:plan          # alias: josh blp
```

**It renders the same classified pool `backlog:next` answers from**, through that command's own
`context_of` and `resolve` — so **the plan cannot promise an order the run does not take**. It is a
separate command rather than a flag because `backlog:next`'s standard output is one bare token per
line and a plan printed there would break the loop below. Its four sections are:

- **Ready now** — the runnable children, grouped by repository. **The grouping is the parallelism**,
  not a presentational choice: a lane is per repository, so the bundles are how wide this run can go.
- **Waiting** — every withheld child, each naming **what it is waiting on**: the blocking issue
  numbers, a run that already has it, or that it is ready but past the offer this ask could make.
- **Waiting on a person** — the `needs-decision` children, which is the next subsection's input.
- **Out of scope** — every open issue the backlog will **not** run, with the reason. That half was
  silent before: an issue without `auto-ok` never enters the pool, so nothing distinguished "not
  opted in" from "not reached yet".

**Report all four to the person, in the session language, before the first child starts.** Epic
children are enumerated individually rather than summarized under their root, because the pool has
already classified each one — the detail costs nothing (joshuafolkken/kit#1652). A `⚠` about a
truncated listing is reported with them: the plan is then partial, and saying so is what keeps it
from reading as complete.

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
  most issues in a row, and joshuafolkken/kit#1715 measured `issue bookkeeping` as the largest single
  contributor to a `backlogrun` parent's turn count: 110 of 414 turns over four recorded parents,
  26.6%, one issue at a time. A parent's cost grows as n²/2 in its own request count
  (joshuafolkken/kit#1567), so a turn removed here is worth more than a turn removed inside a child.
- **Never measure in order to decide.** A question needing a benchmark, a profile, or a run of the
  thing itself is not settled here: it stays labelled and the plan says so. This pass is a cheap
  read, not a research task, and turning it into one would put the whole backlog behind it.
- **Label what you find.** An issue that turns out to need a person's judgement has `needs-decision`
  applied — the same label a parked child gets, applied the way `epicrun.md` → "park and continue"
  applies it. **The next plan then classifies it by reading the label alone**, never by reading the
  body again, so the cost of this pass falls on every subsequent ask instead of repeating.
- **Then start the loop.** Whatever is still labelled is reported as parked and left standing; the
  run does not wait on it.

**`needs-decision` is the one workflow label a run may apply, and it is neither `auto-ok` nor
`needs-human-review`.** Those two widen or withhold what may be *executed* and stay a person's alone
(`epicrun.md`, `SKILL.md` → §2z). This one records only that a person's answer is needed, which is a
finding rather than an authorization — which is why a run parks with it and a person clears it.

## The loop

The answer comes from one command, and the command is the single source of what may start:

```bash
answers=$(pnpm josh backlog:next)                      # alias: josh bl
# one issue number per line, in the order they may be started; a verdict word when there is none
answers=$(pnpm josh backlog:next --exclude 1630)             # after #1630 merged
answers=$(pnpm josh backlog:next --exclude 1630,1631)        # after two
```

**The output contract is `docs/josh-commands.md` → "`josh backlog:next`", and four parts of it decide
how this loop is written:**

1. **Standard output is one token per line, and everything else is standard error** — so `answers`
   holds something a loop can branch on.
2. **The tokens are bare issue numbers, scoped to the repository the command runs in.** A runnable
   child in *another* repository is reported on standard error with its repository and checkout, and
   is never a token; this repository having no candidate of its own is answered `wait`. **So
   `backlogrun` takes no `owner/repo#N` token.** A qualified token was implemented and withdrawn,
   because `--exclude` parses bare integers and feeding one back produces a usage error rather than
   an exclusion (joshuafolkken/kit#1630). Report the other repository's candidates in the run summary
   and leave them to a session running there — the same one-session-per-repository shape
   `epicrun.md` → "Concurrency" already has.
3. **The verdict words are `wait`, `stop`, `retry`, `error` and `none`** — `none` is `epic:next`'s
   `complete` under this command's spelling, and there is no `complete` here. **`retry` is the one
   with no `epic:next` counterpart**: it says GitHub did not answer, which is a statement about the
   connection and not about the graph (joshuafolkken/kit#1663).
4. **Exit code 0 covers all five verdicts, and 1 means the listing could not be read** — no answer at
   all. **`error` cannot be told apart by exit code, so read the token rather than the status.**

**What the answer means is this table's; whether the run may act on it is `pnpm josh backlog:budget`'s**
(joshuafolkken/kit#1632). The right-hand column ends in the word each answer is handed to that
command as, and the next subsection is where the two budgets and every termination live. Nothing here
decides an ending on its own any more — a count and an elapsed time kept in an agent's head are the
one-shot judgement joshuafolkken/kit#1460 measured a run walking straight past.

| Answer | What to do | Budget answer |
| --- | --- | --- |
| One or more issue numbers | Start each one as a child, up to the free lanes — `epicrun.md` → "Lanes" and "Each child runs in a delegated unit", unchanged. Then **ask the command again**, with the merged numbers added to `--exclude` | `candidates` |
| `wait`, with something of this run's own still in flight | Everything opted in is blocked or already running, so waiting can still change the answer. Sleep the polling interval and **ask the command again** — `epicrun.md` → "Waiting, and never waiting forever" | `blocked` |
| `wait` this checkout can never resolve — the only candidates the command reported on standard error are in other repositories, and this run has nothing of its own in flight | Report those candidates with their checkouts. **Waiting cannot resolve them, but a person opting a new issue in here still can**, so the ending is the idle watch's rather than this row's | `exhausted` |
| `stop` | Nothing can proceed without a person. Report the parked issues and finish | `parked` |
| `retry`, on fewer than three consecutive asks | GitHub did not answer, so the graph was never read. Sleep the polling interval and **ask the command again** — this is the one answer re-asking is allowed on, and the count is consecutive: any other answer resets it to zero | `blocked` |
| `retry` for a third consecutive time | The outage is not a hiccup. Report what the command printed on standard error and finish | `unreadable` |
| `error` | The graph could not be resolved — report what the command printed on standard error and finish. **Never re-ask hoping for a different answer**, and never fall back to picking an issue by hand: that would be the run choosing its own membership | `unreadable` |
| `none` | Nothing opted in is left | `exhausted` |
| Exit 1, empty standard output | The listing could not be read. Report it and finish — **it is not `none`**, and reading it as one would report an empty backlog that was never seen | `unreadable` |

**Re-asking on `retry` is not the exception to the `error` rule — it is what that rule was protecting**
(joshuafolkken/kit#1663). What `error` forbids is a run answering its own question: re-asking there
would mean hoping a graph the command already read would read differently, and picking an issue by
hand would mean choosing the membership. `retry` says the command never got an answer to read, so
asking again is the same question rather than a second opinion, and the run still takes whatever the
command then says. The counting is what keeps it finite: **three consecutive `retry` answers end the
run**, and any other answer puts the count back to zero, so an outage cannot be waited out forever
and a single dropped connection cannot end a run with the backlog untouched. The count is the run's
own — `backlog:budget` is told `blocked` while it has retries left and `unreadable` on the third, which
is how the ending still comes from the budget rather than from a clock kept in an agent's head.

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
(joshuafolkken/kit#1668). That is a rule rather than a limit, and it covers the epic above as well as
one that carries `epic` and not `auto-ok`: an epic that is not going to offer its children does not
withhold them either, because withholding them left a person's label on the child inert with nothing
said. An epic that **is** opted in still owns its children entirely — it sequences them, so offering
one beside it would skip that order and hand the same issue over twice. Ordering survives the
standalone route on the children's own `blocked-by` relations, which is what `--ordered` records.

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
backlogrun --idle 60
backlogrun --max 5
backlogrun --idle 0 --max 5
```

| Budget | Written | Default | What it does |
| --- | --- | --- | --- |
| Idle watch | `--idle <minutes>` | **30 minutes** | After the candidates run out, keep polling this long for a new one. A candidate that appears restarts the watch from that moment |
| Maximum issues | `--max <count>` | unlimited | How many issues this invocation may take. On reaching it the run reports and finishes |

**`--idle 0` is how the watch is turned off, and it is the only way**
(joshuafolkken/kit#1676). Omitting the flag used to mean off, and that spelling is gone the moment
omitting it means the default — so the disable moved onto the number line, where "watch for zero
minutes" is the same thing said in the flag's own units. Short runs are not shut out: `backlogrun
--idle 0` finishes at the first empty backlog, exactly as a bare `backlogrun` did before.

**Why 30 minutes, and not the figure the examples happened to use.** Three things fix it, and the
single source is `scripts/backlog/backlog-budget.ts` → `DEFAULT_IDLE_MINUTES`:

- **Below it the watch is a coin flip.** What it waits for is a person noticing the run has gone
  quiet, filing an issue and applying `auto-ok`; ten minutes does not reliably outlast that.
- **Above it the run pays for nothing.** A watch is polled every 5 minutes, so 30 minutes is six
  asks — about one child's worth of turns, spent while the run holds no working tree and no lane.
- **It is about the length of one child** — 12 to 28 minutes measured on joshuafolkken/kit#1477 — so
  a run that has emptied its backlog waits roughly as long as one more issue would have taken.

**A watch is polled every 5 minutes, not at the loop's 60-second polling interval.** That interval is
sized to a child's `fullrun`, which finishes in minutes; a watch is waiting on a person, which happens
on human timescales. Asking every minute would spend thirty of the parent's own requests — each one
billing the whole session history — to learn nothing thirty times. `epicrun.md` → "Waiting, and never
waiting forever" holds the row, and the reason `backlog:budget` prints names the interval, so the loop
reads it rather than remembering it.

**Why an idle watch is safe, and why it is not a way in.** A new issue is never implemented the
moment it is filed: to become a candidate at all it needs `auto-ok`, which only a person applies, and
that opt-in is the safety valve. There is no route by which an unreviewed issue is picked up during a
watch.

**Ask `pnpm josh backlog:budget` on every iteration and act on what it answers** — after
`backlog:next`, with the word the table above maps its answer to:

```bash
verdict=$(pnpm josh backlog:budget --answer <word> --started "$started" --active "$active" \
  --merged <count> --running <count> [--idle <minutes>] [--max <count>])
```

**`--active` is required of every ask, because the watch is on unless it was turned off.** It used to
be the companion of an optional flag; with the default on it is what every ask needs, and an
invocation whose watch is on and that carries no `--active` is **refused**. The alternative — a `stop`
saying the watch could not be measured — is the failure one layer up: `stop` is the word the loop acts
on, and it cannot tell that one from a run that ended properly, so the run would report an emptiness
nobody watched. The refusal lands on the first ask, before anything has started, and the fix is one
flag the loop already holds. Only `--idle 0` excuses it.

| Verdict | What the loop does |
| --- | --- |
| `run` | Start what `backlog:next` offered, up to the free lanes. The reason names how many more the maximum still allows; start no more than that |
| `watch` | Sleep and ask both commands again — at the 5-minute idle poll while the backlog is empty **and** nothing of this run's is in flight, and at the 60-second polling interval otherwise, which covers a blocked backlog, a drain, and a watch that opened while children were still merging. The reason names the interval wherever it is the idle poll. **Nothing is held while watching** — the working tree's hold was released at the last child's merge and each drained lane was closed there, so a watching run blocks no other run |
| `stop` | Report and finish. The reason it printed **is** the termination reason the completion report carries |

`--started` is when the invocation began; `--active` is when it last had work — the most recent ask
that was **not** `exhausted`, and the run start before there is one; in a session that resumed a cut
run it is the moment that session picked the run up, which the next subsection is why. **Refreshing
`--active` is what
restarts the idle watch**, so an issue opted in mid-watch is picked up and the watch begins again at
its full budget rather than at whatever was left. Both are ordinary ISO-8601 timestamps
(`date -u +%FT%TZ`), and `--idle` without `--active` is refused rather than measured from the run's
start. `--merged` is what has merged and `--running` what is still in a lane; **both count against
the maximum**, since a wave started before the first one merged would otherwise take the run past the
number the person declared. **No ending abandons a lane**: whatever would have ended the run answers
`watch` while `--running` is above zero, so the lanes drain and their merges reach the report. The
full contract is `docs/josh-commands.md` → "`josh backlog:budget`".

**The completion report names three things the budgets make meaningful**: how many issues this run
took, how many of them were picked up during an idle watch, and the termination reason — quoted from
what `backlog:budget` printed rather than paraphrased.

### The hand-off check is not asked during a watch

**A watch does not count towards the session cut** (joshuafolkken/kit#1676). The hand-off check —
`pnpm josh cost --over 150000`, `epicrun.md` → "The hand-off" — is asked **at a child's merge**, and a
watch has no merges, so a run that is only watching never reaches one. That is a decision rather than
an omission, and three things make it safe:

- **The cost of a watch is bounded before it starts.** At the 5-minute idle poll, `--idle N` is at
  most `N / 5` asks — six for the default — which is why the default is a number of minutes and not a
  number of hours.
- **A watch holds nothing.** The working tree's hold was released at the last child's merge and every
  lane was closed there, so the requests it spends are the only thing it costs.
- **The cut lands where it always did.** When the watch picks something up, the run has work again,
  that child merges, and the check is asked there in the ordinary way. Nothing is deferred — a cut is
  simply never taken in the middle of a wait.

**So every cut is taken at a merge, and that is what lets a resumed session state its own
`--active`.** A woken session picks the run up seconds after the merge the cut was taken at, so the
moment it resumed *is* the moment the run last had work, to within the hand-off itself. Nothing has to
carry the watch across a cut, because no cut ever falls inside one.

**The 8-hour whole-run bound is untouched and still outranks all of this** — it is measured from the
record's `started_at` across every cut, so a run cannot watch its way past it in 30-minute pieces.

### Where the run stops

Termination is decided by what the loop is told, never by a judgement that enough has been done:

- **`pnpm josh backlog:budget` answering `stop`** — the single decision, covering an idle watch
  running out, the backlog emptying with the watch turned off, the maximum being reached, a parked
  backlog, an unreadable listing, and the whole-run bound.
- **The whole-run 8-hour bound is unchanged and outranks both budgets**, and the idle watch lives
  inside it: `epicrun.md` → "Waiting, and never waiting forever" is still where the figure is stated,
  and `backlog:budget` is what applies it, so a run at the bound stops with candidates in hand and a
  watch still open.
- **Every one of those budgets is counted across this run's own session cuts**, from the record
  `pnpm josh run:carry` keeps rather than from a count held in the current session — "The session cut
  is inside the invocation" above. A resumed run that started its budget over would stop 8 hours after
  the _last_ cut instead of after the invocation, which is no bound at all.
- **The guards in `epicrun.md` → "Guards"** apply unchanged, counted over the whole `backlogrun`
  rather than per epic: children per run, Issues filed per run, and consecutive child failures. The
  maximum above is a person's declaration of scale and does not replace any of them — whichever binds
  first ends the run.
- **A `needs-human-review` child stops the whole run** before its commit — `SKILL.md` → §2z, which is
  the single source, and `epicrun.md` → "`needs-human-review` — the one stop that is not a park" for
  what happens to its lane.
- **The hand-off check** — `pnpm josh cost --over 150000` at every child's merge, and the lane hand-over
  that follows an `over` — is `epicrun.md` → "The hand-off", unchanged. It is **not** asked during an
  idle watch: "The hand-off check is not asked during a watch" above is why.

## What happens to a child that cannot finish

Nothing here is new, and nothing here is restated — a `backlogrun` child is a `fullrun` under a batch
authorization, which is what an `epicrun` child already is:

- **A stop that would end a `queue` parks one issue and the run continues** — `epicrun.md` → "park
  and continue", which is that rule's single source, including what happens to the issue's lane.
- **A prerequisite discovered mid-run is recorded as a dependency rather than parked** —
  `epicrun.md` → "A prerequisite discovered mid-run", and `SKILL.md` → §2d for the three-way
  distinction between a prerequisite, a split and an upstream defect. **One thing is genuinely
  different**: with no epic, there is no `pnpm josh epic --add` to record the ordering into, so the
  prerequisite is filed with `route:tier-a` and the blocked issue is parked with `needs-decision`
  naming it. The parked issue returns to the pool when a person clears the label, and the
  prerequisite is offered on the next ask if it carries `auto-ok`.
- **A split found mid-run** files the children and the epic and does not stop the batch, exactly as
  under `epicrun` — `split-assessment.md` for the assessment, `epicrun.md` → "Splitting a child
  mid-run" for the branch.
- **`in-progress` left behind by an interrupted run** is `epicrun.md` → "`in-progress` is removed by
  whoever finds it stale".

## What runs once per session, not once per issue

All of these are `epicrun.md`'s, and are reached here in the same order and for the same reasons:

| Step | Where it is defined |
| --- | --- |
| `git switch main && git pull`, then `pnpm josh latest:scope`, then `pnpm josh lane:prune` — in the primary checkout, before the first lane opens | `epicrun.md` → "Once per repository, before the first lane opens" |
| `josh latest` on `required` only, asked once at the first child and never in a lane | `epicrun.md` → "`josh latest` runs once per session, not once per child" |
| `pnpm josh run:preflight <N>` before each child that is not in a lane | `epicrun.md` → "Preflight" |
| `pnpm josh run:progress --wait` in the background, `--mark` at every real report | `epicrun.md` → "Progress while the run is quiet" |
| `pnpm josh release:scope` once, after the last issue has merged and the last lane is closed | `followup.md` → "When `pnpm josh release` runs" |

**Two more run once per session and are this file's own, not `epicrun.md`'s**:
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
same reason `epicrun.md` skips it when it began from a bare Issue. The dependency graph the loop acts
on is still audited in effect, because `backlog:next` reuses `epic:next`'s own read and classify and
answers `error` rather than guessing when it cannot resolve one.

## This file is the single source of the `backlogrun` procedure

`CLAUDE.md` carries the keyword's row in the shorthand table and the explicit-invocation rule;
`SKILL.md` → §1 routes here. Everything else about a `backlogrun` is either in this file or in
`epicrun.md`, and where the two could disagree, the rule is that this file adds nothing to a child's
procedure — it only says which children there are.
