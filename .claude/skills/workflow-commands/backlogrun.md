# `backlogrun` — Unattended execution of named issues, epics and the opted-in backlog

**`backlogrun` names either nothing, or the issues and epics to run first.** With no argument it runs
whatever `pnpm josh backlog:next` offers — the whole opted-in backlog, which is every issue carrying
`auto-ok` plus every child of an epic whose root carries it, ordered by dependency and grouped into
waves that may run beside one another (joshuafolkken/kit#1631). With `#N1 #N2 …` it runs those named
items in the order they were typed, one at a time, and **then** drains that same backlog — folding in
what `queue` used to be a separate keyword for (joshuafolkken/kit#1984). **`--only` stops it after the
named list**, draining nothing: `backlogrun #N1 #N2 … --only` runs exactly the scope the old `queue`
did.

**A named item may be a single issue or an epic** (joshuafolkken/kit#1985, folding in the old
`epicrun` keyword). A single-issue item is one `fullrun`; **a named epic runs its children in
dependency order across the free lanes, and the run does not advance to the next named item until
every one of that epic's children has been processed — merged or parked.** `backlogrun #E --only`
therefore runs exactly one epic's children and stops, which is the scope the removed `epicrun #E` had;
a person who types `epicrun` is told to run `backlogrun #E --only` instead
(`CLAUDE.md` → the shorthand-commands section).

**Before it existed the backlog could only be reached after something else had finished.** The
`auto-ok` pickup ran only when the epic graph was drained, or once a bare-Issue batch run had merged
(that standalone pickup has since moved here entirely — joshuafolkken/kit#1965); there was no
door that started *from* the backlog. So a person who wanted the opted-in issues run in
the best order had to create an epic first, and creating one was itself the bottleneck this entry
point removes.

**This file is the single source of running a child** (joshuafolkken/kit#1985, which folded the
removed this file into it). Everything about *running a child* is here — lanes, park-and-continue,
the `needs-human-review` stop, a prerequisite discovered mid-run, the delegated unit and its summary
bound, the preflight, `josh latest` once per session, the progress watcher, the hand-off check and the
guards — under "Running a child — the shared mechanics" below. What the first half of this file carries
is the part that is genuinely different between a bare backlog drain, a named issue and a named epic:
**which issues are offered, and under what authorization.**

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

**One `backlogrun` approves every merge of every issue `pnpm josh backlog:next` offers** — the issues
carrying `auto-ok`, every child of an epic whose root carries it, **and an issue this run filed, once
it has become such a child**. That last clause used to read the other way round: it said a run's own
filing carries no `auto-ok`, so nothing ever offers it unless a person opts it in. **That was never
true, and obeying the rules is what broke it** (joshuafolkken/kit#1675). A filing is placed into an
epic by `pnpm josh epic:bundle`, which `prompts/review.md` → "Review round cap" and `SKILL.md` → §2i
both make **Tier A rather than optional**; where that epic's root carries `auto-ok`, the child is
offered from the next ask onwards without anybody having labelled it. Measured on 2026-09-09:
joshuafolkken/kit#1668 and joshuafolkken/kit#1673 were filed by the run itself, and both reached
`backlog:plan`'s **Ready now**.

**The promise was withdrawn rather than enforced, because the owner's policy is its opposite**
(2026-09-10, joshuafolkken/kit#1675): work a run files is work the backlog should drain. So the two
repairs that would have *kept* it — dropping a run's own filings from the pool, and requiring a
person's `auto-ok` on a child as well — **are prohibited**, and a run that finds itself writing
either is reimplementing something that Issue rejected. What replaces the promise is "The brake that
replaces the promise" below, and withdrawing the promise without it is what that Issue forbids.

That declaration is the authorization: **`backlogrun` declares "everything opted in", and a named
epic declares "the children of that epic".** The declaration *is* the statement of what may be
executed unattended, and that is the one thing a run must not leave ambiguous — which is why what runs
is stated by the keyword and its arguments, never inferred from the shape of a request.

**Which issues may be opted in stays a person's decision.** `auto-ok` is applied only by a person —
this file is that rule's single source, now that `backlogrun` owns the opted-in pool
(joshuafolkken/kit#1965) — and a run that labelled its own inputs would be widening its own
authorization, which is exactly the self-widening `split-assessment.md` refuses. The split is: **which ones carry the label, a person; in
what order and how many at once, the run.** **What a run does move is the pool's contents**, and that
is now stated rather than denied: an issue it files and bundles into an already opted-in epic is
offered from the next ask onwards. The brake below is what bounds that, and it bounds a quantity
rather than a membership.

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

**Two filing routes are exempt from the depth test (`SKILL.md` → §2i), and both are re-examined here
rather than left unsaid** — they are the routes a run files on most, so an unstated exemption is
where self-widening would actually happen:

- **`route:tier-a` and `route:interrupt` stay exempt, and that reason holds.** A filing the run
  cannot proceed without is citing its own blockage by construction, which is what the depth test
  asks for. **Their number is not unbounded either** — joshuafolkken/kit#1675 read it as uncapped and
  it is not: §2d's ten-filings ceiling is stated "at every entry point", so it covers this route, and
  `run:carry --filed` is what counts it across session cuts.
- **A review branch-2 filing stays exempt, but not for the reason §2i used to give.** That reason — a
  defect in a `josh` command's behavior is depth 0 by construction — does not hold:
  joshuafolkken/kit#1694 and joshuafolkken/kit#1703 are both branch-2 filings whose subject is the
  epic tooling, which §2i's own table puts at depth 1. **The exemption survives on the other half of
  the sentence**: such a filing has already cleared a bar the discretionary route has not — a
  confirmed defect reaching a runtime path, with a written failure scenario — and gating it on a
  citation as well would drop the one kind of finding both documents agree is never dropped. §2i
  carries the corrected reason; this names the disposition rather than restating it.

**This section is the single source of how the `epic:bundle` obligation and this authorization
boundary meet.** Filing puts an issue into an epic, the epic's `auto-ok` puts it into the pool, and
the four bounds above are what stop that compounding. `SKILL.md` → §2i points here rather than
restating it.

**It does not contradict joshuafolkken/kit#1668.** That change opened the opposite door — a child of
an epic that is *not* opted in is offered where the **child** carries `auto-ok` — while this one
changes no offering condition whatever: not a line of `scripts/backlog/backlog-pool.ts` moves, and
`scripts/backlog/backlog-next.test.ts` fixes the behavior this section now describes. What changed
here is the promise written above and the brake written beside it.

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
(→ "Each child runs in a delegated unit"), and the once-per-session steps — `josh latest`
on `required`, the progress watcher — run once for the whole invocation, never per issue
("What runs once per session, not once per issue" below). Between issues, `pnpm josh ms`
brings the previous merge into the checkout the next one implements in. The parent reads each issue's
state back from GitHub — `pnpm josh issue:state <N>` — never the unit's summary.

**A named issue that cannot finish parks, and the rest of the named list is skipped** — starting the
issues after it would break the order they were named in. **The run does not stop there**: it goes on
to drain the opted-in backlog, and the completion report lists the named issues it did not start. This
is the one place a `backlogrun` differs from the old `queue`, whose failure ended the batch — and it
holds because the pool that follows is a separate authorization the named list's order does not govern.
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

**This section is the single source of the mechanism** (joshuafolkken/kit#1774; folded into
`backlogrun` by joshuafolkken/kit#1984). The record, the two commands, the answer table and what each
one means are all here. **A named-issue `backlogrun #N1 #N2 …` pins its list across the cut**: the
record keeps the **opening** list at every cut so `classify_claim`'s character-for-character
comparison is untouched, and the issues it has finished live in the record's `done` field rather than
shrinking the string — a resumed session reads `remaining` from `pnpm josh run:carry --json` and runs
those, then drains the pool as ever. **`--only` rides in that invocation string like every other
token**, so a resumed session runs the remaining named issues and **stops**, rather than silently
draining the pool the person excluded. `SKILL.md` → §0 is where the entry point this reading covers is
named.

**Typing `backlogrun` once authorizes the declared budget, and a session cut is an execution detail of
spending it** (joshuafolkken/kit#1714). → "The hand-off" stops the _session_ at the seam;
under `backlogrun` that seam does not stop the _run_. The next session picks the same invocation up
and carries on with the budget already partly spent.

**A resumed session's carried-over lanes are polled beside new work, never waited out.** The lanes a
cut handed over finish in their own detached units, and the resumed parent opens new independent lanes
in the same turn it polls them rather than serializing behind their merges: → "A
carried-over merge does not stand in front of the next lane" is the single source, and this file adds
nothing to it.

**This is not an exception to the explicit-invocation rule above — it is what that rule already
says.** What §0 forbids is **inferring** a workflow from the shape of a request; it has never required
the keystroke to land in every session's own transcript. → "Each child runs in a
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
| `busy`       | The record's **owner process is still running and no cut handed it off**: another parent is spending this budget right now. **Stop; do not open a lane.** Counting into it would put two parents on one record. (A record a `--cut` _did_ hand off answers `resumed` here even with its owner still alive — joshuafolkken/kit#1935.) Nothing here is yours to end — either that run finishes and ends its own record, or a person decides it is over |
| `standing`   | A record is here that **no cut handed off** — the crashed run, and the same command retyped over it. **Stop; do not open a lane**, and do not guess: the choice is the person's. Report the two commands the answer names — `pnpm josh run:carry --resume "<invocation>" --owner "$PPID"` to carry that budget on, or `pnpm josh run:carry --end` and begin again to discard it. The `--owner` belongs to the resume as much as to the begin: adopt without it and the record declares no owner, so `busy` degrades to `standing` for every parent after |
| `mismatch`   | A record is here for a **different** invocation — a run that never reached `--end`. **Stop; do not open a lane.** Resuming into it would spend that run's `--max` and its hours. End it deliberately, with `pnpm josh run:carry --end`, once you know that run is over |
| `expired`    | The 8-hour whole-run bound is spent. **Where a `--cut` handed the record off it is this run's own bound**, so this is the verdict on standard output and the run ends: report it and stop, and clear the record with `pnpm josh run:carry --end` once it is genuinely over. Where nothing handed it off it is printed on standard error ahead of a `began` instead — a person typing the keyword again over a spent record is starting a new run, and the record is replaced. A `--resume` over a spent record answers `expired` and adopts nothing |
| `unreadable` | Report what it printed and **stop before opening a lane**. A budget that cannot be carried is a run that restarts it at the next cut, which is the whole defect                                                             |
| `unknown`    | The same — the repository's git directory could not be read, so nothing was established                                                                                                                                    |

**The record is the parent loop's, and a lane never touches it.** The parent is what reads GitHub to
verify a child merged (→ "Each child runs in a delegated unit"), so it is also what
counts that merge — one sequential loop writing one record, with no two lanes writing it at once. A
delegated unit is briefed with its child and nothing about the invocation's budget, exactly as it is
told nothing about `run:hold`'s claim on the primary checkout. **The single writer is now enforced
rather than only stated** (joshuafolkken/kit#1722): `--begin` claims the record exclusively and names
the owning process, so a second parent is answered `busy` instead of being allowed to count into a
budget somebody else is spending.

**Count into the record rather than into your head** — `--merged 1 --owner "$PPID"` at every child's
merge, `--filed 1 --owner "$PPID"` at every Issue this run files, and `--cut --owner "$PPID"`
immediately before the cut. Every counter is an increment and the command owns the sum, because a run
sending a total would be sending arithmetic it had done in its head — the one-shot judgement
joshuafolkken/kit#1460 measured a run walking straight past. **`--owner "$PPID"` is not optional on a
count** (joshuafolkken/kit#1935): the record names its owning process, and a count that does not name
that same one is refused, so a session whose record a successor took over cannot advance a budget that
is no longer its own — the single writer joshuafolkken/kit#1722 established, now kept across the cut.

**`--cut` is also what hands the record off, and it is the only thing that does.** A crash never
reaches it, which is exactly why a declared cut is the one standing record the next session carries
without anybody deciding: `--cut`, then the next `--begin` naming the same invocation answers
`resumed` — **and it does so even while the cutting process is still running** (joshuafolkken/kit#1935),
so a `backlogrun` cut from an interactive session that never ends, or a lane child woken by a
background task's notification, is still handed to exactly one successor rather than stalling every
resume with `busy`. Skip the `--cut` and the resumed session is answered `standing` and stops for the
person — the budget is safe either way, but the run is not unattended any more.

**So `--cut` is the session's last write to the record, and "immediately before" is literal.** Count
everything the session has, then cut. A `--merged` or `--filed` issued after the `--cut` is now
**refused** rather than obeyed (joshuafolkken/kit#1935): the record is handed off and awaiting its
successor, so the cutting session can no longer advance it. The hand-off is protected instead of being
silently spent, which is what used to cost the next session its unattended resumption.

**`backlog:budget` is then fed from the record, never from a count kept in the conversation:**
`--started` takes the record's `started_at` and `--merged` its `merged`. That one substitution is what
makes `--max` and the 8-hour whole-run bound count **across** cuts, as one invocation's worth. **The
10-filings-per-run ceiling is counted the same way**, from `filed`. **`--idle` is the one budget that
is not carried**, and a cut can only reach a watch that opened while this run's own children were
still merging — the one shape where the two overlap. A resumed session then states its resume moment
as `--active` and the watch begins again at its full budget, bounded by the 8 hours as everything
else is: "The cost check is not asked during a watch" below.

**The consecutive-failure guard needs no carrying, and that is by construction rather than by
omission.** The hand-off is asked at every child's _merge_, so a cut is always taken directly after a
success — the count is zero at every seam it could have had to cross.

**How many cuts the run crossed is named in the completion report**, read from the record's `cuts`. A
run reporting only what it merged would hide that it had spanned four sessions to do it.

**End the record when the run ends** — `pnpm josh run:carry --end`, in the same turn as the final
report — so the next `backlogrun` begins a budget of its own rather than resuming a spent one.

**The record widens nothing.** It carries a budget and nothing else: `auto-ok` is still applied only
by a person, so a cut adds no rule about which issues may be offered. **The pool itself may have
grown across the cut** — an issue the first session filed, and `epic:bundle` placed under an already
opted-in epic, is offered to the resumed one — and that is "What one invocation approves" rather than
anything the record did. The ceiling on it is counted across cuts too, from the record's `filed`.

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
session is offered by exactly the rules the first one was — a pool that grew across the seam is
"What one invocation approves", never the supervisor's doing.

**A failure is visible rather than silent.** A wake that never claims the carry record is retried, and
once the retries are spent the supervisor stops and sends a `warning` Telegram — which covers a wake
command that does not exist, a session that dies during boot, and one that runs without picking the
run up. **Every other stop that leaves the run asleep sends it too** (joshuafolkken/kit#1746): a
carry record that has expired or cannot be read ends the supervisor with the record still handed off,
and both of those were silent, which is this sentence's promise going unkept. `none` — the run having
finished — and a person's own `--stop` stay silent, because in neither did anything go wrong.

**And what the woken sessions printed is kept, because a silent exit has to be diagnosable after the
fact** (joshuafolkken/kit#1746). Everything the supervisor starts writes to one log file per
repository, named by `--list` and by every warning. `detached` is what puts a session outside the
conversation; discarding its output was a second choice riding along with that, and the two are
separate requirements — on 2026-09-10 three sessions died without claiming the record and left nothing
anywhere to say why.

**A person keeps control of it.** `pnpm josh run:wake --list` names the running supervisor and
`--stop` ends it; the full contract, what it launches and why that is a constant rather than a
setting are `docs/josh-commands.md` → "`josh run:wake`".

**The woken session and its lane children run with an explicit model and effort**
(joshuafolkken/kit#1932). The woken `claude -p backlogrun` parent, and every lane child it goes on to
dispatch, is launched with model `opus` and effort `medium` by default — so an unattended run matches
the parent session and stays comparable between runs — each overridable in `.env` with
`JOSH_LANE_MODEL` / `JOSH_LANE_EFFORT`. `docs/josh-commands.md` → "`josh lane:dispatch`" and
→ "Each child runs in a delegated unit" are the single sources.

**And it relays the woken parent's progress, because a cut cuts the one channel the person watched
across** (joshuafolkken/kit#1910). Before the cut the parent was the person's own session and its
twenty-minute heartbeat appeared on their screen; after it the parent is a headless `claude -p
backlogrun`, whose heartbeat reaches only its own transcript. So the watcher persists each line into
the report record and `pnpm josh run:wake --list` relays the last one verbatim beside the
supervisor's state — a **pull**, never a Telegram push, so the heartbeat stays session-only and does
not cheapen `confirmation` / `completion` (→ "It goes to the session only" is the single
source of both the line's shape and this exception).

**The completion report names how many sessions were woken beside the record's `cuts`**, and the two
being equal is the invariant — one wake per cut. `pnpm josh run:wake --list` prints them together, so
a run that woke fewer sessions than it took cuts is visible rather than argued about. **What is
counted is a carry record actually claimed, never a process started** (joshuafolkken/kit#1746) —
counted at the launch the number asserted the one thing nobody had checked, and it read as one wake
against one cut through the whole of the forty minutes in which three sessions started and none of
them arrived.

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
  applied — the same label a parked child gets, applied the way → "park and continue"
  applies it. **The next plan then classifies it by reading the label alone**, never by reading the
  body again, so the cost of this pass falls on every subsequent ask instead of repeating.
- **Then start the loop.** Whatever is still labelled is reported as parked and left standing; the
  run does not wait on it.

**`needs-decision` is the one workflow label a run may apply, and it is neither `auto-ok` nor
`needs-human-review`.** Those two widen or withhold what may be *executed* and stay a person's alone
(this file, `SKILL.md` → §2z). This one records only that a person's answer is needed, which is a
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
   → "Concurrency" already has.
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
| One or more issue numbers | Start each one as a child, up to the free lanes — → "Lanes" and "Each child runs in a delegated unit", unchanged. Then **ask the command again**, with the merged numbers added to `--exclude` | `candidates` |
| `wait`, with something of this run's own still in flight | Everything opted in is blocked or already running, so waiting can still change the answer. **Ask the command again on the wake the progress watcher's exit delivers** — the parent starts no sleep of its own, and the interval is a floor on the re-ask rather than a clock (→ "Waiting, and never waiting forever" and "The parent keeps no clock of its own") | `blocked` |
| `wait` this checkout can never resolve — the only candidates the command reported on standard error are in other repositories, and this run has nothing of its own in flight | Report those candidates with their checkouts. **Waiting cannot resolve them, but a person opting a new issue in here still can**, so the ending is the idle watch's rather than this row's | `exhausted` |
| `stop` | Nothing can proceed without a person. Report the parked issues and finish | `parked` |
| `retry`, on fewer than three consecutive asks | GitHub did not answer, so the graph was never read. Sleep the polling interval and **ask the command again** — **this is one of the states with no watcher-delivered wake**, because the outage that produced `retry` stops the watcher reading too and a declined watcher does not exit (→ "The wake exists only while something is in flight"). This is the one answer re-asking is allowed on, and the count is consecutive: any other answer resets it to zero | `blocked` |
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
billing the whole session history — to learn nothing thirty times. → "Waiting, and never
waiting forever" holds the row, and the reason `backlog:budget` prints names the interval, so the loop
reads it rather than remembering it.

**Why an idle watch is safe, and why it is not a way in.** A new issue is never implemented the
moment it is filed: to become a candidate at all it needs `auto-ok`, which only a person applies —
on the issue itself, or on the epic whose children it stands for. **What that no longer excludes is
an issue this run filed**: bundled under an already opted-in epic it is offered on the next ask,
inside the same watch. That is admitted rather than denied ("What one invocation approves"), and what
bounds it is the brake stated there — ten filings per invocation, `--max` merges, the WIP cap — never
the watch. There is no route by which an issue **nobody** opted in, on itself or on its epic, is
picked up during a watch.

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
| `watch` | Ask both commands again — at the 5-minute idle poll while the backlog is empty **and** nothing of this run's is in flight, and at the 60-second polling interval otherwise, which covers a blocked backlog, a drain, and a watch that opened while children were still merging. **Two questions, and they are not the same test.** *Which* interval applies is the two-part test just given — the 5-minute idle poll only while the backlog is empty **and** nothing of this run's is in flight, and the 60-second interval in every other case, a blocked backlog with nothing in flight included. *Whether the parent keeps that interval as a clock of its own* is the in-flight test: with nothing in flight the watcher declines for the whole watch and never exits, so the parent sleeps the interval itself; with something in flight the wake is the watcher's exit and the interval is only a floor on the re-ask (→ "The wake exists only while something is in flight"). The reason names the interval wherever it is the idle poll. **Nothing is held while watching** — the working tree's hold was released at the last child's merge and each drained lane was closed there, so a watching run blocks no other run |
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

### The cost check is not asked during a watch

**A watch does not count towards the session cut** (joshuafolkken/kit#1676). The hand-off check —
`pnpm josh cost --over 300000`, → "The hand-off" — is asked **at a child's merge**, and a
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
moment it resumed *is* the moment the run last had work, to within the hand-off itself.

**One shape does put a cut inside a watch, and it is the one where that is right.** The backlog can
answer `exhausted` while this run's own children are still in lanes — a watch and a drain at once —
and a cut is taken at each of those merges. A session woken from one has just merged a child, so the
resume moment is still the moment the run last had work, and the watch begins again at its full
budget. What keeps that finite is the 8-hour whole-run bound, which is measured from the record's
`started_at` across every cut.

**The 8-hour whole-run bound is untouched and still outranks all of this** — it is measured from the
record's `started_at` across every cut, so a run cannot watch its way past it in 30-minute pieces.

### Where the run stops

Termination is decided by what the loop is told, never by a judgement that enough has been done:

- **`--only` ends the run once the named list is done** — there is no pool and no idle watch to fall
  through to, so the run reports and finishes (joshuafolkken/kit#1984). It is the one termination the
  loop below never reaches, because `--only` never enters the pool loop at all.
- **`pnpm josh backlog:budget` answering `stop`** — the single decision, covering an idle watch
  running out, the backlog emptying with the watch turned off, the maximum being reached, a parked
  backlog, an unreadable listing, and the whole-run bound.
- **The whole-run 8-hour bound is unchanged and outranks both budgets**, and the idle watch lives
  inside it: → "Waiting, and never waiting forever" is still where the figure is stated,
  and `backlog:budget` is what applies it, so a run at the bound stops with candidates in hand and a
  watch still open.
- **Every one of those budgets is counted across this run's own session cuts**, from the record
  `pnpm josh run:carry` keeps rather than from a count held in the current session — "The session cut
  is inside the invocation" above. A resumed run that started its budget over would stop 8 hours after
  the _last_ cut instead of after the invocation, which is no bound at all.
- **The guards in → "Guards"** apply unchanged, counted over the whole `backlogrun`
  rather than per epic: children per run, Issues filed per run, and consecutive child failures. The
  maximum above is a person's declaration of scale and does not replace any of them — whichever binds
  first ends the run.
- **A `needs-human-review` child stops the whole run** before its commit — `SKILL.md` → §2z, which is
  the single source, and → "`needs-human-review` — the one stop that is not a park" for
  what happens to its lane.
- **The hand-off check** — `pnpm josh cost --over 300000` at every child's merge, and the lane hand-over
  that follows an `over` — is → "The hand-off", unchanged. **300,000 is a temporary
  experiment rather than a settled number** (joshuafolkken/kit#1775) — the figure it replaces, the
  retreat and its review point are all in that same single source. It is **not** asked during an
  idle watch: "The cost check is not asked during a watch" above is why.

## What happens to a child that cannot finish

Nothing here is new, and nothing here is restated — a `backlogrun` child is a `fullrun` under a batch
authorization, whether it came from a named epic or from the opted-in pool:

- **A stop that would end the run parks one issue and the run continues** — → "park
  and continue", which is that rule's single source, including what happens to the issue's lane.
- **A prerequisite discovered mid-run is recorded as a dependency rather than parked** —
  → "A prerequisite discovered mid-run", and `SKILL.md` → §2d for the three-way
  distinction between a prerequisite, a split and an upstream defect. **One thing is genuinely
  different**: with no epic, there is no `pnpm josh epic --add` to record the ordering into, so the
  prerequisite is filed with `route:tier-a` and the blocked issue is parked with `needs-decision`
  naming it. The parked issue returns to the pool when a person clears the label, and the
  prerequisite is offered on the next ask if it carries `auto-ok`.
- **A split found mid-run** files the children and the epic and does not stop the batch, because the
  keyword already authorized a batch — `split-assessment.md` for the assessment, → "Splitting a child
  mid-run" for the branch.
- **`in-progress` left behind by an interrupted run** is → "`in-progress` is removed by
  whoever finds it stale".
- **A child released from `needs-decision` is re-dispatched to a lane, never implemented by the
  parent.** The parent is an orchestrator: → "The parent orchestrates and never
  implements a child in its own context" is the single source, and → "Removing the label
  is Tier A" carries the re-dispatch itself. A released child takes a lane exactly as any batch child
  does.

## What runs once per session, not once per issue

All of these are this file's, and are reached here in the same order and for the same reasons:

| Step | Where it is defined |
| --- | --- |
| `git switch main && git pull`, then `pnpm josh latest:scope`, then `pnpm josh lane:prune` — in the primary checkout, before the first lane opens | → "Once per repository, before the first lane opens" |
| `josh latest` on `required` only, asked once at the first child and never in a lane | → "`josh latest` runs once per session, not once per child" |
| `pnpm josh run:hold <N>`'s preflight check, before each child that is not in a lane | → "Preflight" |
| `pnpm josh run:progress --wait` in the background, `--mark` at every real report | → "Progress while the run is quiet" |
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

## Running a child — the shared mechanics

Everything below runs **one child** — of a named epic, or of the opted-in backlog. It was the `epicrun` procedure until joshuafolkken/kit#1985 folded that keyword into `backlogrun`; a single-issue named item, a named epic's child and a bare backlog child all run the same `fullrun` in the same way, and this part is the single source of how. A named epic runs these mechanics over its own children until every one is processed, then the run advances to the next named item.

## When `#N` is not an epic

`backlogrun` accepts an ordinary Issue as well as an epic. `backlogrun #<N>` on an Issue with no task list
runs `#<N>` as a `fullrun` and then finishes. Typing `backlogrun` up front is the batch authorization
given once, before anything is known; a `fullrun` that discovers a split has to stop because it only
had one Issue's authorization. So inside `backlogrun #<N>`, a prerequisite or a split found mid-run does
**not** stop the run:

1. File the new Issue(s) with the matching route label — `route:split` for a split, `route:tier-a`
   for a prerequisite — no confirmation.
2. **Stash the work in progress and remove `in-progress` from `#<N>`**, exactly as steps 2 and 4 of
   "A prerequisite discovered mid-run" do — `git stash push -u -m "..."` with the `-u`, the
   `gh api repos/{owner}/{repo}/issues/<N>/comments` post that records the stash, and
   `gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/in-progress 2>/dev/null || true`.
3. **Ask `pnpm josh epic:bundle <N>` whether an epic already tracks `#<N>` before creating one.** It
   names the epic rather than only reporting that one exists — creating a second epic over it gives
   the auto-close two task lists to disagree about.

   | Answer | What to do |
   | --- | --- |
   | An epic `#<E>` already tracks `#<N>` | `pnpm josh epic --add <E> <P> --before <N>` for a prerequisite, or `--add <E> <N1> ...` for a split. **Do not create a second epic.** Continue the loop against `#<E>` |
   | No epic tracks it | Create one — the command depends on what was found (table below) |
   | **The command could not answer** — a non-zero exit, `Could not confirm which epic already tracks these — do not place this issue in one.`, or a ⚠ warning about a truncated listing (beginning `⚠ The epic listing …`, in either form `hit its …-epic cap` / `stopped at the …-issue page ceiling`) above a `Nothing to bundle.` verdict; `⚠ Could not read #N.` is one failed relation read and voids nothing, and a definitive answer stands even beside a warning | Park `#<N>` with `needs-decision` and report. "Could not tell" is not "no epic tracks it" |

   When creating one, `#<N>` is itself one of the deliverables — this path always takes the
   keep-as-a-child arm of `split-assessment.md`'s promote-or-create branch. Which command depends on
   what was found, because `--ordered` makes the argument order the dependency chain:

   | Found | Command |
   | --- | --- |
   | A prerequisite `<P>` | `pnpm josh epic "<title>" <P> <N> --ordered` — the prerequisite comes **first** |
   | A split into independent children | `pnpm josh epic "<title>" <N> <N1> ...` — **no `--ordered`** |
   | A split whose children do have an order | `pnpm josh epic "<title>" ... --ordered`, arguments in that order |

4. **Run `pnpm josh epic:audit <E>` now**, not earlier — there is no epic to audit until step 3, and
   `epic:audit` refuses an Issue with no task list exactly as `epic:next` does.
5. **Do not stop.** Continue into the loop below against the new epic `#<E>`.

**Nothing found means no epic.** If `#<N>` reaches its merge without a prerequisite or a split turning
up, the run finishes there. An epic is created only when there is a second child to put in it.

**Every guard below applies on this path unchanged** — 30 children, 10 Issues filed, 3 consecutive
failures.

**This does not let `fullrun` promote itself.** A `fullrun` that discovered a split still files the
children and the epic and then **stops** (`split-assessment.md` → "Finding a split mid-run stops the
run").

**`josh epic:next` is not changed by any of this.** It still refuses an Issue with no task list; the
acceptance of a bare Issue belongs to `backlogrun`.

**Naming a bare Issue beside an epic is a mistyped command rather than a second entry.** Where one
reference is named, the refusal is the whole answer. Where several are, a task-listless reference is
**skipped** so the other epics keep running — `backlogrun #<E> --only #<N>` with `#<N>` an ordinary Issue exits
0, notes the skip on standard error, and **never runs `#<N>`**. A run that means to do both types
`backlogrun #<N>` on its own after the epic.
## Each child runs in a delegated unit

**A child is not run in the parent loop's context.** One child goes to an isolated execution unit,
and only its summary comes back.

**The parent orchestrates and never implements a child in its own context.** *Every* child takes a
delegated unit — a fresh one and **a child just released from `needs-decision`** alike. The rule is
one sentence: **whatever offers a child — the loop, or a person clearing a label — the child is handed
to a lane, never to the parent.**

**The mechanism is the one `pnpm josh delegate` defines** — the enumeration plus the command — with
the unit changed from one step of a run to one child of an epic. Building a second is the clone
`CLAUDE.md` prohibits. Ask the command rather than deciding:

```bash
pnpm josh delegate epic-child   # → delegate
```

**In a lane, that unit is a detached operating-system process rather than a subagent of this
session.** The verifier is still `pnpm josh issue:state <N>` read from GitHub, and the summary is
still bounded at 25 lines. An in-process subagent could not survive the session cut the hand-off
takes. `pnpm josh lane:dispatch` is where a lane's child is started; "Handing the child over" below
carries the command.

**The lane child is launched with an explicit model and effort.** It is started as
`claude -p --model <model> --effort <effort> fullrun #<N>`, defaulting to model `opus` and effort
`medium`, each overridable in `.env` with `JOSH_LANE_MODEL` / `JOSH_LANE_EFFORT`; an effort outside
`low|medium|high|xhigh|max` refuses the launch. `docs/josh-commands.md` → "`josh lane:dispatch`" is
the single source.

**The parent reads GitHub, never the summary.** That is `epic-child`'s verifier: a unit that reports
a child finished without its PR merged leaves that child open, and `pnpm josh issue:state <N>` says so
in one call. The child's own gate, `/code-review` and CI run inside the unit. **Never advance the
loop on the summary alone** — that discards the verifier.

### What the summary carries, and how long it may be

**The summary's only job is to carry what GitHub does not.** Anything already on GitHub is re-billed
on every remaining turn of the run if it is put in the summary too. **"Make it shorter" is not the
rule, because it deletes the wrong half** — a report cut by feel loses the observation nobody else
recorded and keeps the file list anyone could have fetched. So both lists are written out, and the
brief hands them to the unit.

**Always kept — five things, because none of them is anywhere else:**

1. **`Cause` / `Fix` / `Result`**, the three plain lines — the parent's orientation.
2. **Every verification result the run did not close in the ordinary way**, named as such. A result
   nobody obtained must never reach the parent as a run that passed.
3. **Observations that could bite later** — something noticed and not filed, a flaky check, a
   surprising diff, work a later child will collide with. **This is the only route a child's
   discretionary observation has**: a child files `route:tier-a` and `route:interrupt` only, and the
   parent files what survives — `SKILL.md` → §2i, the single source. **What the parent does with the
   rest is append it, not drop it**: an observation that cannot cite the depth-0 work it blocked
   becomes one line in `docs/observations.md`, and a second line under the same key files it. **The
   child never writes that file** — it cannot tell its observation from the sibling lane's.
4. **Decisions taken and why**, where the decision was not already logged as an Issue comment.
5. **What was left undone**, and under whose authority.

**Always cut — three things, because GitHub already holds them:** the changed-file enumeration (the
pull request's own file list), the per-round review detail (each round's verdict is one line; the
findings are on the pull request), and restatements of rules the parent already holds.

**The bound is 25 lines, and it is a number so that it is not a judgement.** A summary that cannot be
said in 25 lines is describing the work rather than reporting it. **The brief states the bound**,
because a unit never told it writes to the length its own report format suggests.

**This does not shorten the person-facing completion report.**
`prompts/collaboration-workflow/report-format.md` → 「完了報告（セッション向け）」 is unchanged. What is
bounded here is the child's hand-back to the parent, because the hand-back is re-read.

**Read the state directly rather than asking `epic:next` again.** A child that did not finish still
carries `in-progress`, which `epic:next` classifies as waiting on time before it consults any blocker.

**The merge authorization reaches the unit**, and **so does the explicit invocation** — `CLAUDE.md` →
"Explicit invocation required" forbids *inferring* a workflow, not requiring the keystroke in the
unit's own transcript. **The brief therefore names the invocation it descends from** — `backlogrun #<E> --only`,
the child number, and that the child is to be run as `fullrun #<N>` under that authorization. A brief
that omits it is the defect: the unit is then guessing, and refusing is the correct answer to a guess.

**Where no isolated unit exists, run the child in the parent's context.** The hand-off below is asked
at every merge; delegation keeps each child's own context small and the hand-off bounds the parent
session's length, so it is not an alternative to it.

## A delegated unit that stopped without reporting

**A unit can be stopped from outside, and a stop leaves no notification behind** — and a stopped unit
trips none of this file's guards, which all assume it is running. **So the parent checks rather than
waiting — which means it must not be waiting.** **Hand the child to the unit without blocking on its
return, and poll** at the loop's polling interval; ask once the unit's output has been unchanged for
the silent-unit window (`| Silent delegated unit | 30 min |` below).

**Note where the unit writes at hand-off; the modification time is read from the file, not carried.**
**Where the child runs in a lane, that note goes into the lane rather than the conversation** —
`pnpm josh lane:output <N> <path>`, in the same turn as the dispatch, so it comes back from
`pnpm josh lane:output <N>` in any session.

**Ask the command rather than combining the traces yourself.** Traces are read **in the checkout the
unit was given** — this session's own unless the unit was handed a separate work tree, and the stash in
the recovery below is taken there too.

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

**Two `undetermined` answers in a row is a fault in the check, not a slow unit.** The second
consecutive `undetermined` on the same child ends the polling: send a `confirmation` Telegram naming
the trace that failed, and stop. **It is never escalated to a `stopped`** — nothing was read.

**Silence and no process together — never either one alone**, because each alone has an innocent reading
(a unit inside a long check writes nothing; a unit only reading has no check process) and together they
do not. **Which way an error falls is the whole design**: a live unit booked as stopped has its work
killed, a stopped one booked as alive only costs waiting — so **a trace that could not be read answers
`undetermined`, never `stopped`**, and a process trace nobody gave is an unasked question rather than
"no process". **Output that moved answers `alive` on its own; a live process is weighed only once every
trace has answered.**

**The path passed to `--output` is absolute** — the command refuses a relative one. **The process
trace is the one the command does not read for itself**: run it in the unit's checkout and read the
command lines rather than the names — `pgrep -laf 'josh gate'` etc. — looking for one naming **that
checkout's path**, since several kit projects may run at once. **Read the file the path points at, not
the link**: a transcript path is a symlink whose own modification time never changes, so a `stat` typed
by hand needs `-L` (`run:liveness` follows the link itself).

**A clean checkout is not evidence that the unit is alive** — a stop can come while the unit is still
reading the skill and the issue. The checkout is read only for whether there is work to stash before
the child is parked; **"nothing was ever opened for the child" is `pnpm josh run:hold`'s preflight check
at the start of the next child, not this one's.**

**What follows is what a failed child already gets.** Re-read the child first with
`pnpm josh issue:state <N>`; then, while it is still `state: OPEN` and not carrying `needs-decision`.
**A re-read carrying `needs-decision`** means the unit parked the child and then stopped, so fall
through to the loop's park branch: leave the label on, count nothing against the consecutive-failure
guard, and go back to step 1.

1. **Stash the half-finished work** — `git stash push -u -m "backlogrun: stopped unit for #<N>"` — and
   record it on the Issue. `-u` is not optional, and the comment is what gets the stash popped.
2. **Remove `in-progress`** — `gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/in-progress 2>/dev/null || true`.
3. **Count it against the consecutive-failure guard and park it** with `needs-decision` and a comment
   naming what `run:liveness` answered and what it read.
4. **Go back to step 1 of the loop.**

**It is booked as a failure rather than restarted.** A silent retry re-runs a child whose tree may be
half-written, and the consecutive-failure guard is the only thing that notices the environment rather
than the children is at fault.

## Concurrency: as many children per repository as it has free lanes

Execution state lives on GitHub and nowhere else, so **an `backlogrun` need not be a single session.** One
session per repository; each calls `josh epic:next <E> --repo <owner/repo>` and runs only its own
repository's children.

```bash
# In the kit checkout
pnpm josh epic:next 858 --repo joshuafolkken/kit
```

A child in another repository is read against that repository through `gh api`, so no clone is needed
to learn its state — only to implement it. A repository with no checkout here says so rather than being
cloned.

**A dependency that crosses a repository is not satisfied when the blocking issue closes.** Merging
kit's issue does not publish kit, so such a dependency resolves only once the blocker is closed *and*
its release has appeared in the registry — and while the blocker is still open the registry is never
consulted. **Unless that repository publishes nothing** — no `package.json` on its default branch, or
one declaring `private` — in which case a closed blocker there resolves. The answer is read from the
blocker repository's manifest, never from the registry (a 404 also means "this token may not see it").

**The lane count is per repository, and `epic:next` is what applies it.** When it has a child to offer,
it first asks that repository **how many of its lanes are already running something**: every open issue
carrying `in-progress` and not parked counts for one — whichever epic it belongs to. What is left of
`JOSH_LANE_LIMIT` (**default 6**) is what gets offered, and at zero the answer is `wait`. It is asked
**only when there is a candidate**. A **parked** issue does not hold a lane: `needs-decision` outranks
`in-progress` here exactly as in the classification. A child stopped by `needs-human-review` is
deliberately not parked and goes on holding its lane, because its uncommitted work is still in that
checkout.

**It is advisory and not atomic.** The label is applied when a child is dispatched — the parent claims
it in `lane:dispatch` before the child process starts, and a standalone `fullrun` / `halfrun` claims it
the moment `run:hold` answers `hold` — *after* this read, so two sessions starting in the same instant
can both read the same free lane. What the check closes is the window that actually occurs — a
dispatched lane holds the label from the launch onward, not the tens of minutes it took when the
child's own `fullrun` had to reach its own apply first. It is a guard that makes the invariant
mechanical, not a mutex.

**It is scoped to the resource, not the epic.** A lane is its own checkout with its own branch and
ports, so the repository-wide number is a **ceiling on how many lanes run at once**. How a session
drives more than one child at a time is "Lanes — running more than one child at a time" below.

**A stale label holds a lane, so the stale rule reaches past this epic's own children** — "`in-progress`
is removed by whoever finds it stale" below applies to **any** open issue in the repository. `epic:next`
names the holders on standard error, and the 90-minute stale window bounds the wait.

**A listing it could not read is not an idle repository.** `epic:next` answers `wait` there rather than
offering the child — reading a failed read as "nothing is running" is the one direction this guard may
not fail in, because that answer *starts* work. **A listing that was *cut short* is the same answer**: a
short one with no visible holder is `wait`, with its own message.

**Two children of one repository may run at once, and the section below is how.** The guard is a
ceiling rather than a prohibition, scoped to the lane rather than to the epic. **Do not read this as
"concurrency needs no coordination"**: the coordination is this section plus the one below, and
switching the guard off is not one of the ways to get parallelism.

Parallelism only helps children that do not depend on each other. When app-kit's child needs kit's new
feature, that is recorded as `blocked-by` and `epic:next` makes it wait.

## Lanes — running more than one child at a time

`pnpm josh epic:next <E> --repo <owner/repo> --lanes` answers with **one issue number per line**, up to
the number of free lanes, and each of those children runs in a **lane** of its own: a linked git work
tree with its own branch, its own `.env` and its own dev and preview ports (`docs/josh-commands.md` →
"`josh lane:open` / `josh lane:close` / `josh lane:list` / `josh lane:prune`"). **Implementation, the
verification gate and the review run in parallel; the merges stay serial** — each one lands on the
`main` the next is then measured against.

**A lane child may cut its own turn before the gate.** Implementation done, it ends its process and a
fresh one resumes the same lane from the gate onward — the boundary, the two commands and the resume
verification are `pre-gate-cut.md`, the single source. **The child is told apart from a person, and its
resume stage is handed to it, by a mark the dispatch sets** — `JOSH_LANE_CHILD`, the lane's issue
number (`pre-gate-cut.md` → "The dispatch mark" and "The stage is passed to the resumed child").

**One kind of child takes no lane beside anything: an interrupt whose subject is a defect in the
verification path itself.** It runs alone, and the batch resumes only once it has merged. **Decide it
from the enumeration, never from how serious it looks** — does the defect reach the verification gate
(lint / type check / spell check / unit tests), the code review, the pre-push hook, or the merge
checks? One of those, and the offered children wait; none, and it fills a lane like any other child.
**Ask it of what `epic:next --lanes` just offered, before opening a second lane**; the rule is
`prompts/collaboration-workflow/wip-cap.md` → 「実行のしかた」, its single source.

**A lane's review does not inherit the lane, and `pnpm josh review:brief` is what closes that.**
`/code-review` is forked by the harness into the **session's** working directory, which during a lane
run is a different tree — usually the default branch. Reading that, the review finds nothing wrong and
**the failure arrives as approval**: the child counts the round as clean and commits a diff nobody
read. **So the path is no longer something a brief has to remember to carry**: `pnpm josh review:brief`
prints the lane's absolute root, branch and HEAD, hands over targets written `git -C <root> …`, and
prints a nonce the review attests with `pnpm josh review:attest <nonce>` from the checkout it actually
read. **The child asks `pnpm josh review:attest --check` before it counts a round**, and
`pnpm josh followup` asks again before it merges; `missing` and `mismatch` are both refusals. A clean
round is therefore the case to check hardest, not the case to skip the check on.

**A lane's branch is `<N>-lane`, and the issue number leads it so that the commit path accepts it.**
`pnpm josh git` refuses to commit from a branch that is neither the default branch nor one sharing the
child's `<N>-` prefix (`scripts/git/git-branch.ts` → `has_same_issue_prefix`, `/^\d+-/`). **Switching
the lane to another branch is not the way round it**: `lane-registry.ts` → `branch_issue` identifies a
lane **by** that branch name, so a switched lane drops out of `list_lanes()` — losing its seat, its
listing and its isolation. So `epic:next` is asked **with** `--lanes`, and everything below runs as
written.

**Running unattended gets harder, not easier, and that is the honest trade.** Many lanes make the
overlap between children real, and every overlap that becomes a conflict costs the child that loses the
race a resolution, a re-run gate and a review ("Conflicts are not predicted" below), and parks it
outright under that section's four conditions. The run finishes more work per hour **and** spends more
of each child's budget on merge races. Do not report the first without the second.

### Once per repository, before the first lane opens

In the **primary checkout**, in this order, and never again per lane:

1. `git switch main && git pull` — every lane is branched from this ref.
2. `pnpm josh latest:scope`, and the update on `required` — "`josh latest` runs once per session" above.
3. `pnpm josh lane:prune` — closes the lanes an interruption left registered without a work tree.

**`pnpm josh latest` is never run inside a lane, whatever `latest:scope` answers there.** The
elapsed-time window is keyed to the project root, and a lane's project root is its own directory, so a
fresh lane has no stamp, is told `required`, and every lane runs a dependency update. **Ask it in the
primary checkout; in a lane, do not ask at all.**

**The rewritten lock file still has to reach a pull request**, and with lanes no child runs in the
primary checkout to carry it. `git stash` is a repository-level ref shared by every work tree:

```bash
git stash push -u -m "backlogrun: josh latest before lanes"   # primary checkout, only if the update rewrote anything
git -C "$dir" stash pop                                    # the first lane opened, after `lane:open`'s own install
```

Record it on that first child's Issue — the comment is what gets it popped if the run dies in between.

### Opening one lane

```bash
dir=$(pnpm josh lane:open "$n") || exit 1   # the directory on stdout, nothing else; alias: josh lno
git -C "$dir" stash pop || exit 1           # the first lane only, and only if `josh latest` stashed
pnpm --dir "$dir" install --frozen-lockfile                 # only after a pop, which changed the lock
```

- **A refusal is an empty capture beside a non-zero exit**, with the reason on standard error: `full`,
  `already-open`, and a **failed install** — which leaves a real work tree behind holding its seat, so
  the next `lane:open` answers `already-open` and never retries. **Park that child and name
  `pnpm josh lane:close <N>`** — a lock the lane cannot build is a state a person fixes. **The guard is
  in the snippet** — without it the next two lines run `--dir ""`.
- **`lane:open` installs; the third line is a *re*-install, and only the popping lane needs it.** A
  failed install fails `lane:open`, so a directory on standard output is the guarantee the lane runs.
- **What the pop changes is the lock, which is why that one lane installs twice.** The pop brings in
  the `pnpm-lock.yaml` that `josh latest` rewrote, which this child's gate must build against. **A pop
  that fails stops the lane** rather than re-installing anyway.
- **A `<N>-lane` that already exists is attached to, and `lane:open` says so on standard error** — the
  way back to a child parked after it pushed: a local branch of that name gets the work tree put on it,
  and where there is none the **remote** is asked (`ls-remote`, fetched first) and the lane cut from
  `origin/<N>-lane` where the branch survives — otherwise from the default branch. **A reused branch is
  not a fresh lane.** Nothing deletes a branch to open a lane, so a reopen cannot cost the pushed work.
- **Nothing switches the lane's branch** — the registry identifies a lane by that branch, so a switch
  costs it its seat, listing and isolation, and `<N>-lane` is already a name `pnpm josh git` commits
  from.
- **`pnpm josh run:hold`'s preflight check is not asked in a lane; `lane:open`'s own answer replaces it.** A fresh
  lane is clean by construction, preflight's `reclaim` arm (HEAD != default branch) is true of every
  lane, and its recovery (`git switch <default>`) cannot run in a linked work tree. What a leftover
  looks like here is `lane:open` answering `already-open`.
- **`pnpm josh run:hold` is unchanged, and is claimed inside the lane** — it keys on
  `git rev-parse --absolute-git-dir` (`.git/worktrees/<name>`), so each lane holds independently.

### Handing the child over

The child runs as `fullrun #<N>` in that lane, and neither `josh latest` nor a progress watcher is
started there. Everything else — the plan, the gate, `/code-review`, `pnpm josh git`,
`pnpm josh followup` — is unchanged, and `pnpm josh followup` releases that lane's hold at the merge.

**The child is started as a process of its own, not as a subagent of this session.** One command does
it, in the lane that was just opened:

```bash
pid=$(pnpm josh lane:dispatch "$n") || exit 1   # the child's pid on stdout, nothing else; alias: josh lnd
```

- **It records where the child writes as it starts it** — the dispatch's own
  `<temp>/josh-lane-dispatch-<N>.log` — so "this lane records no path" is no longer a state the hand-off
  has to except.
- **A refusal is an empty capture beside a non-zero exit**, and every refusal also sends a `warning`
  Telegram — no lane open, a path that could not be recorded, a launch that failed. **Park that child
  and name the log the message carries**; do not re-dispatch into the same lane without reading it.
- **A child that started with nowhere to write exits zero and warns.** The launcher starts the session
  even when it could not open the log, so the child really is running. **Poll that lane on the process
  trace alone**, because its log will never grow.
- **The brief the child used to be handed is now the invocation itself.** The child is started as
  `fullrun #<N>` with the lane as its working directory. The batch a person approved by typing
  `backlogrun` covers the child.
- **It does not pass `--dangerously-skip-permissions`.** What the child may do is the checkout's own
  `.claude/settings.json` to decide; a headless child reaches `gh` and merges through `pnpm josh
  followup` without the flag, and the run reports what stopped rather than loosening it.

**Start each child without blocking on it, and poll them all.** That is "A delegated unit that stopped
without reporting" above applied N times, and `pnpm josh run:liveness <N> --output <path> --process
alive` is read **in that child's lane**. **Run `pgrep -laf "fullrun #<N>$"` first and pass what it
found** — `alive` where the child is there, `none` where it is not, and never `alive` merely because the
child was dispatched. The child's command line is `claude … fullrun #<N>` and carries no path; the `$`
anchor keeps `#12` from matching a running `#123`.

**`git switch main && git pull` is the parent's now, not the child's.** No lane can switch to the
default branch, so the refresh moves to the primary checkout **before each `lane:open`** — the ref the
lane is cut from.

### Conflicts are not predicted

**The child merges `origin/main` into its lane before its gate now, so this path is the fallback rather
than the first line.** Every `fullrun` runs `pnpm josh main:merge` ahead of the gate
(`chain-rule.md` → "origin/main is merged in before the gate", the single source), so an overlap
already on `main` is resolved before the gate reads the tree. What this section covers is an overlap
that lands on `main` *after* it, which `followup` still reports as a conflict.

**Nothing here forecasts which children will overlap.** The overlap surfaces where GitHub already
reports it: a pull request that conflicts with its base comes back `mergeStateStatus: DIRTY`, which
`git-pr-checks-eval.ts` reads as a **failure** rather than polling through it — so `pnpm josh followup`
ends that child with a named conflict in about ten seconds.

**That child does not stop: it resolves the conflict in its own lane.** It is **not** counted against
the consecutive-failure guard either way — a lost merge race is an ordinary outcome of running many
lanes.

**Nothing is at risk while it resolves, because the work is already committed and pushed.** The pull
request holds the branch, `git merge --abort` puts the tree back, and no step below rewrites a pushed
commit. **The merge direction is `origin/main` into the lane's branch, never a rebase** — a rebase would
rewrite pushed commits and need a force push, which this package denies.

1. **Resolve in the lane.** `git fetch origin main`, merge `origin/main` into the lane's branch, resolve
   in place. Do not close the lane, open another, or switch its branch. **`pnpm josh lane:open` can now
   reattach to a pushed branch**, so a lane closed by mistake here is recoverable; staying put is still
   what keeps the run clear of the question.
2. **Re-run the whole gate.** The tree changed, so the green recorded before the conflict is void:
   `pnpm josh lint:related` and `pnpm josh test:related`, then `pnpm josh gate`.
3. **Review the resolution, one round.** Brief it with `pnpm josh review:brief` and run `/code-review`
   over the resolution diff, then require `pnpm josh review:attest --check` to answer `ok`. That round
   is a different subject and does not spend one of the two the cap allows — `prompts/review.md` →
   "Review round cap" carries the exception.
4. **Conclude the merge and push it, with `pnpm josh git -y`.** Without this step nothing changes on
   `origin`: GitHub still returns `mergeStateStatus: DIRTY`, step 5 reports the same conflict, and
   condition 3 reads that as a second one and parks the child for good. The distributed
   `.claude/settings.json` denies `Bash(git commit*)` and `Bash(git add*)`, so the node script is the
   only sanctioned way. **Record the resolution on the Issue in this same step** — a comment naming the
   conflicting paths — because condition 3 counts resolutions off the Issue comments, not off memory.
5. **Merge**, by re-running `pnpm josh followup` exactly as before.

**The safeguard is the re-run verification, not who holds the pen.** What is dangerous is unreviewed
code merging onto a branch whose review has converged, and that happens identically whichever hand did
the work — so routing the decision to a person does not address it, while re-running the gate and the
review does. **In this repository routing it to a person does not even resolve it**: the user does not
read code, so a code-level conflict handed over is a deferral rather than a decision.

**The run steps back under these four conditions, and under no others. The list is exhaustive and
carries no judgement.**

1. **The resolution requires deleting the other side's change.** That decides intended behavior, not
   text. It goes to the user as a **specification** question — "behavior A or behavior B" — never as a
   diff.
2. **Both sides rewrote the same lines** — overlapping, not adjacent. Read off the structure of the
   conflict hunks, so it needs no interpretation.
3. **A second conflict on the same child.** One resolution per child; the count is read off the Issue
   comments step 4 writes, so it survives an interrupt.
4. **The re-run gate did not come back green, or the resolution review returned a High.** Not only a
   High: a lint error, a failing test or a spell-check hit that merging a moved `main` introduced is
   this condition too.

Meeting any of the four, the child is parked — `needs-decision` plus a comment naming which of the four
it was — and its lane is **kept**, because the pushed branch is the resume path (the table below).

**Leave the tree clean before parking: `git merge --abort` precedes a park under conditions 1, 2 or 4.**
Conditions 1 and 2 are read mid-merge with conflict markers still in the tree, condition 4 after a merge
that is resolved but not committed; condition 3 fires before any merge is started, so there is nothing
to abort.

### What happens to a lane

| When | The lane | Why |
| --- | --- | --- |
| The child **merged** | `pnpm josh lane:close <N>` | `followup` released the hold and the branch is on `main`; nothing in that tree is wanted |
| The child was **parked before its commit** | `git -C <dir> stash push -u -m "backlogrun: parked #<N>"`, record it on the Issue, then `pnpm josh lane:close <N>` | The stash is a repository-level ref, so it outlives the work tree — and `lane:close` is a **forced** removal that would otherwise take the work. `epic:next` counts a parked child's lane as released, so a lane left open holds a seat the count believes is free |
| The child was **parked after its commit and push** | **Left open**, its directory and held seat recorded on the Issue | The stash step is a **no-op** (tree clean because committed). What `lane:close` would take is the **local branch**, which is the resume path |
| The child hit a **merge conflict** | **Left open** — the resolution happens in it | The child resolves in place ("Conflicts are not predicted"). Closing it would delete the local branch the pull request carries — **`lane:open` does now put that branch back**, so a mistaken close is recoverable. A park under that section's four conditions takes the row above |
| The child stopped on **`needs-human-review`** | **Left open and untouched** | The uncommitted work *is* the artifact a person has to look at. Name the lane directory in the stop report and in the Telegram |
| The child **failed** | Whichever of the two parked rows applies, plus the consecutive-failure count | Same reasoning; only the counter differs. **A merge conflict is not this row** — it takes the row above, and it is not counted |
| **`lane:open` failed on the install** | `pnpm josh lane:close <N>`, then park the child | A lane exists that no `pnpm josh …` runs in and the next `lane:open` answers `already-open`. Closing frees the seat; parking is right because the cause is one a person fixes. Carry pnpm's reason into the park note |
| The run was **interrupted** | Nothing to do — the work tree survives on disk | The next session's `pnpm josh lane:prune` closes what git no longer has a tree for. **Park that child**, naming the lane and `pnpm josh lane:close <N>` as the way out |

**A committed child's lane is kept because it is the cheapest resume, not because closing it is final.**
`lane:close` follows the work-tree removal with `git branch -D <N>-lane` (the force flag is there so an
unmerged lane branch goes too), and resume is a re-run of `pnpm josh followup`, which reads the branch
**locally** (a `git diff` against the merge base) — so with no local branch the gate cannot be
re-evaluated. Keeping the lane is worth a seat: the tree, the branch and its `node_modules` are still
there, and the resume is one command.

**What is no longer true is that closing it is unrecoverable.** `pnpm josh lane:open <N>` now attaches
to a `<N>-lane` that exists locally and creates one from `origin/<N>-lane` where only the remote has it,
saying on standard error which it reused. So a lane closed after a push is reopened rather than lost.
**The branch still has to have reached the remote for that to hold** — a child parked before its commit
has nothing on `origin`, which is why that row stashes first and this one does not.

**Which row a child takes is decided by what `followup` printed, not by reading the situation.** **What
it prints is `PR checks failed (merge conflict)`** — that string is what reaches you;
`mergeStateStatus: DIRTY` is the internal spelling `git-pr-checks-eval.ts` compares against, never an
output line to search for. That string sends the child to resolve the conflict in the lane it is
standing in. Do not grep the output for `mergeable_state`: that is the REST field name, normalized away
before anything prints it. **Every after-commit park now keeps its lane, with no exception left in this
table.**

**A kept lane holds its seat, and that is the price rather than an oversight.** Seats are read back out
of the live work trees, so `lane:open` answers `full` rather than handing out ports twice. The optimism
is `epic:next`'s — it counts a parked child as having released its lane — and it costs one child offered
that cannot get a lane, which is visible and recoverable. **Say it in the park comment**: the lane
directory, that its seat is held, and `pnpm josh lane:close <N>` as the way to give it back.

**Release the hold on either parked arm, and leave the lane before closing it.** `pnpm josh followup`
releases the working-tree hold at the **merge**, so a parked child's is still held: run
`pnpm josh run:release <N>` in the lane — **a release names the run it belongs to**, and the child's own
number is what that record carries. **A `needs-human-review` stop is not a park and keeps its hold.**
`lane:close` does not release the hold for you — the record is keyed to the work tree's git directory,
so removing the tree strands it. And `cd` out of the lane **before** `pnpm josh lane:close <N>`: the
close removes the directory the shell is sitting in.

**A `needs-human-review` stop ends the run, and the lanes already in flight are allowed to finish.** No
new lane is opened, but killing units mid-gate would strand as many trees as there are lanes. When the
others have merged or parked, report and stop.

### CI concurrency

Past a GitHub account's concurrency entitlement, jobs **queue** rather than fail, which could cancel out
what the lanes bought; **`JOSH_LANE_LIMIT` lowers the ceiling with no code**. `ci.yml`'s concurrency
group is keyed on `${{ github.ref }}`, so N lanes on N branches are N independent groups and no lane
cancels another's run. Whether queueing bites is read from the multi-day backlog timing report — a
`checks-wait` that grows with the lane count is the queueing.

## Audit before the first child

Run `pnpm josh epic:audit <E>` before step 1 below. **When the run began from a bare Issue there is
nothing to audit yet** — that path runs the audit at the moment it creates the epic instead. An epic
whose children contradict each other stalls the moment the run reaches the contradiction, and
unattended is the worst time to find that out. Errors stop the run; warnings are read and carried on
past. Fixing what it finds is Tier A.

## `josh latest` runs once per session, not once per child

`josh latest` belongs to the **session**, not to a child. Ask once, the first time the loop below hands
back a child number — before implementing that child — and never again:

```bash
pnpm josh latest:scope   # → required | skip ; the reason on stderr
git stash push -u        # only if the tree has staged or modified files — never conditional on the answer
git switch main && git pull
pnpm josh latest         # on `required` only
git stash pop            # only if you stashed above
```

On `required`, load the `dependency-update` skill and follow its procedure — the overrides in **both**
`pnpm-workspace.yaml` and `package.json`, and the one expected `devEngines` pnpm bump. **The answer is
the command's, never a judgement**, and `latest-gate.md` is its single source.

**Session, not run** — the two differ whenever an epic spans repositories. Each session runs one
repository's children, so each updates its own checkout: a second session that read "once per run" and
skipped it would merge that repository's children against stale dependencies and never run `pnpm audit`
there.

**Waiting until a child is in hand is what keeps the tree clean.** Run it before the first `epic:next`
and a run whose first answer is `wait`, `stop` or `complete` leaves a rewritten `pnpm-lock.yaml`
modified on the default branch with nothing to commit it, which the next `git pull` refuses to merge
over.

**The lock file the update rewrites lands with the first child.** The first child's `pnpm josh git -y`
commits it — so that one PR carries the dependency bumps. What the hoist removes is the other N-1
children carrying them; each child's PR would otherwise carry unrelated bumps that `/code-review` and
CodeRabbit read, whose CI failures are attributed to the child, and which miss the eslint cache key
(`hashFiles('pnpm-lock.yaml')`) on every PR. Should the first child fail CI on a bump, fix it forward
before parking it.

**`git switch main && git pull` stays per child** — it brings the previous child's merge into the tree,
and a child that skips it implements on a stale main. Only the dependency update moves to the run. **In
lanes it changes hands**: no lane can switch to the default branch, so the parent runs it in the primary
checkout **before each `lane:open`**. **And in a lane `josh latest` is not even asked** — its
`latest:scope` always answers `required`; the reason and the stash that carries the lock file into the
first lane are in "Once per repository, before the first lane opens" above.

This is the same rule `latest-gate.md` is the single source of.

**A resumed `backlogrun` is a new session**, so it asks once again before its first child. The tree the
resumed session finds may be days old — a session resumed within the window is told `skip`, one resumed
a day later `required`.

## Preflight — reclaim what an interrupted run left, before the next child starts

**An unattended run ends abnormally** — a crash, a Ctrl-C, a laptop asleep, an expired token — and what
it leaves is a **working tree**: a feature branch, an open pull request, uncommitted changes. The loop
opens every child with `git switch main && git pull`, which refuses over a dirty tree, while an agent
may not reach for `git stash` on its own judgement. So an unattended batch could not recover from its
own crash.

**The child's claim is what asks it.** `pnpm josh run:hold <N>` — the first call of the child's
`fullrun` procedure — now runs the preflight check before it takes the tree
(joshuafolkken/kit#1965): it hands back a hold **only on a clean tree**, and returns
`reclaim` / `resume` / `park` without claiming otherwise. There is no separate command to ask first;
the two-step "preflight, then hold" is one call.

```bash
answer=$(pnpm josh run:hold 926)   # alias: josh rh ; one token on stdout, prose on stderr
```

| Answer    | What it found                                                         | What to do                                                                                                                                                                                                                                                                       |
| --------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hold`    | Nothing left behind; the tree is claimed                             | Start the child. This is the ordinary answer.                                                                                                                                                                                                                                     |
| `reclaim` | Uncommitted changes, or HEAD off the default branch                   | Run what stderr printed: `git stash push -u -m "run:hold reclaimed before #<N>"`, then `git switch <default> && git pull`. **`-u` is not optional** (a new `*.test.ts` is untracked). **Then record the stash on `#<N>` as a comment, and ask `run:hold` again** — the check is re-askable. |
| `resume`  | A branch for `#<N>`, or an open pull request, is still here           | **Reuse it and run the whole verification gate from the start** — never only the part the interrupted run had not reached. The tools are idempotent; what was missing was that **nobody had verified what the dead run already committed**.                                          |
| `park`    | The pull request for `#<N>` is **merged** or **closed**               | **Park the child** — `needs-decision` plus a comment naming what was found — and continue. Carrying on over a merged PR duplicates work; over a closed one revives rejected work. Do not delete the branch, reopen the PR, or commit on top of it.                                   |
| `busy`    | Another **live** run holds this tree                                  | Stop before filing anything — `run:hold`'s own answer, unchanged.                                                                                                                                                                                                                 |
| `unknown` | The tree could not be read                                            | Stop the session and report. It is not "the tree is clean".                                                                                                                                                                                                                       |

**The rule answers, so the run does not judge.** "There is a branch, I will carry on" and "there is a
branch, I had better stop" are both defensible in the moment, which is why the choice is not left to it.

**The `git stash` above is one of the flows that authorizes automatic stashing**
(`prompts/collaboration-workflow/operating-rules.md` → the `git stash` bullet). **It is the one entry
there not followed by `git stash pop`**: what is stashed belongs to a run that is gone, so **the Issue
comment is the only thing that can bring it back**.

**Report what was reclaimed** — a child that started from a `reclaim` or a `resume` says so, with the
stash reference where there was one.

**The claim and the preflight are one call now** (joshuafolkken/kit#1965). `run:hold` used to ask only
*whether another live run owns this tree* — claimed once, per child — while a separate `run:preflight`
asked *what a dead run left in it*. The claim now does both, taking the tree only when the preflight
reads `clean`. The `reclaim` arm stays re-askable, because the check writes nothing: recover what it
named and ask `run:hold` once more, and the now-clean tree is claimed.

**It is not asked in a lane.** Every lane's HEAD is on `<N>-lane`, so the `reclaim` arm would fire on
all of them and its recovery cannot run in a linked work tree — so `run:hold` claimed inside a lane
skips the check, and `lane:open`'s own answer covers an interrupted lane instead. **Asked in the
primary checkout while a lane for that child is open, `run:hold` would read `resume`, which is
correct** — the branch read `git branch --list '<N>-*'` matches `<N>-lane`. The loop never reaches it
that way, because `epic:next` does not offer a child already carrying `in-progress`.

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
2. When it exits, **present what it printed in the labelled form below**, closing with the next report
   time.
3. **In that same turn, start the next one.** The interval is measured from the last report.

**The line is presented with a label in front of every field, never handed over as printed.** What the
command emits is one `·`-joined run of unlabelled values —
`⏳ at 2026-09-09 13:27+07:00 / 2026-09-09T06:27Z · quiet 29m · #1631 in-progress,route:split PR:open · lanes none · load 4.7 · record unread · unchanged 0m · next 2026-09-09 13:47+07:00 / 2026-09-09T06:47Z`
— a person cannot read it. Present **four field lines then a fifth for the next report time:**

1. **the observation instant** — the `at` stamp, copied exactly as printed, local first and UTC beside
   it;
2. **how long it has been quiet**, and **how long the observation has been unchanged**;
3. **the children in flight** — each one's number, labels and pull request state;
4. **the lanes, the load average, and the unit-output age** (the `record` field);
5. **the `next` field**, the one line about a moment yet to come, carrying the schedule wording.

**Every value is carried across unchanged; the presentation adds a label and nothing else.** No
rounding, no rephrasing of a value into a state. **Naming a field is not interpreting it**: `quiet 29m`
may be labelled *quiet* and may not become *stalled*. **Never present an unmeasured field as a
measurement** — `record unread` means no `--output` path was given, never *not stalled*; `lanes none` is
*no lane is open*, never *nothing is running*. **The next report time is an absolute instant in both
clocks** (`2026-09-09 13:42+07:00 / 2026-09-09T06:42Z`), **printed and copied, never computed** — it is
labelled a schedule (the time *if the silence continues*, superseded when a real report resets the clock
through `--mark`); **a line with no `next` field gets none** — say the field was absent. **The five
lines are that one line rendered readably**; the two lines of the run's own prose below are counted
separately, and five lines with no table is a cost that does not compound with the run's length.

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
no gate, no CI, no check rollup, because the command reads none of them. **It goes to the session only**:
no Telegram, because `confirmation` and `completion` are what interrupt a person. **Across a `backlogrun`
session cut it is still session-only, but the session is no longer the person's** — after a cut the
parent is a headless `claude -p backlogrun` the `run:wake` supervisor started, so the watcher persists
each line into the report record and `pnpm josh run:wake --list` relays the last one verbatim; it stays
a pull, which is why `--mark` keeps rather than blanks it.

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
   lane — and poll.** Blocking on the return leaves the parent with no turn in which to notice the return
   is never coming. **Start no wait of your own** — the next turn is the one the progress watcher's exit
   delivers ("The parent keeps no clock of its own" below) — and on that wake ask `pnpm josh run:liveness
   <N> --output <path> --process <what `pgrep -laf "fullrun #<N>$"` found>` where that file has been
   unchanged for the silent-unit window. **The flag is what you saw, never what kind of child it is.**

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

   **A merge is one event, and it is one turn of the parent's — never a chain of them.** **None of the
   reads a merge needs takes another's result** (`prompts/collaboration-workflow/turn-batching.md`), so
   `pnpm josh issue:state <N>` — with `--repo <owner/repo>` for a cross-repository child —
   `pnpm josh lane:list` and `pnpm josh cost --over 300000` go out **together**. **The acting half is
   the next turn, and it is also one**: `pnpm josh ms`, `pnpm josh lane:close <N>`, the counters comment
   and the next `epic:next` ask take that classification and none of them takes another. **In steady
   state that is one parent call per event.** **A turn whose whole content is one read, or one two-line
   progress report, is the shape this forbids.**

   **The counters go into the epic progress comment in that acting turn** — children run, Issues filed,
   **consecutive failures**, and the time the run started — at **every** child's
   merge (see "The counters live in the conversation" below). Their **values** are counted inside the
   run, so only the write waits for the merge (`background-commands.md`).

   **The hand-off check is asked at every child's merge, delegated or not** — `pnpm josh cost --over
   300000`, in the reading turn above. Go back to step 1 on `under`; on `over` **the run hands its lanes
   over and stops in that same turn** — no new child is taken, the lanes already in flight keep running,
   and the next session picks them up from `lane:list` and `pnpm josh lane:output` (see "The hand-off"
   below). The one reading that does not stop is a lane nobody could poll — `unreadable`, or `open` with
   no recorded path. **Never read the condition off `pnpm josh delegate epic-child`** — a static policy
   lookup that answers `delegate` everywhere, so a gate built on it never fires.
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
with it** (→ "The session cut is inside the invocation"). The cut is where a `backlogrun` spans several
sessions; it is not a stop.

```bash
pnpm josh cost --over 300000
```

It prints `over` or `under` on standard output and the measured figure on standard error. `over` means
the next turn of this session costs more than the threshold in billed input, and the number is passed
explicitly so a run cannot drift it by remembering it wrong.

**300,000 is a temporary experiment, not a settled number** — read it as under test. **If the total cost
per session gets worse, retreat to the previous 150,000** (compare with the run-timing report, same
definitions before and after: median requests per run, billed input per request, Issues finished per
session, cuts reached). **The retreat is more than deleting this note**: enumerate every reference with
`grep -rnE '\b300,?000\b' --include='*.md' --include='*.ts' .` (the word boundary keeps `run:wake`'s
`3000000` out), set the code constant back to 150,000, and drop the "temporary experiment" wording. **The
150,000 output ceiling and the 150,000 entry-read character figure are separate systems — do not sweep
them into the replace.** **The threshold expresses the balance between tokens and human effort**: cutting
every child would make a person retype the command every time and lose the unattended property.

### The check is asked at every merge, and delegation does not excuse it

**A delegating parent reaches the threshold too**, because most of its billed input is conversation
history rather than resident preamble, and the cost is not linear — n requests bill about n²/2, so a
condition that delays the first cut multiplies a cost rather than deferring it. **So there is no
condition: `pnpm josh cost --over 300000` is asked after every child's merge**, delegated or not.
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
context with **this command** at a threshold of its own — `run_cut.IMPLEMENTATION_CONTEXT_THRESHOLD`,
200_000 — and cuts with `pnpm josh run:cut --impl <N>`. **The measurement is single-sourced here**:
`cost_verdict.per_request_cost` is what both seams compare, and only the threshold differs (the parent's
300_000, the child's 200_000). The boundary and the resume are `pre-gate-cut.md` → "The
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
  the path each one records** so the resumed session can find them. → "The session cut is inside the
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

### The counters live in the conversation

**Write the run's counters into the epic progress comment at every child's merge, and read them back
after a compaction** — children run, Issues filed, **consecutive failures**, and the time the run
started, counted in the conversation and nowhere else. **It is every merge and not only an
`over` reading**, because a compaction happens under context pressure at whatever moment it arrives, so
counters persisted only where the run expected to stop are taken anyway. **The consecutive-failure count
is the one that matters** — it is what the stopped-unit section leans on to notice the environment is at
fault; lost, a run keeps feeding children into a broken environment and never reaches three. **This is
not what "Nothing is carried in the conversation" denies**: that is about the state a *next session*
needs, all of it on GitHub, while the counters are about *this* run's own guards.

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

## `needs-human-review` — the one stop that is not a park

A child carrying **`needs-human-review`** is degraded to a `halfrun`-shaped stop and **the whole run ends
there** — implementation and the verification gate run, nothing is committed, the working tree is left
dirty and unstashed, a `confirmation` Telegram carrying the resume command goes out, and the remaining
children are not started.

**This is the exception to park-and-continue below, and it is not an oversight.** Parking works because
the parked child leaves the checkout clean; this child does not. Its uncommitted work is the artifact a
person has to look at — which is why the alternative that kept the batch running (commit, open a PR,
merge nothing) was rejected: it satisfies "a person approves publication" and fails "a person chooses".

**The child goes on holding its repository.** `needs-decision` outranks `in-progress` in the
per-repository exclusion so a parked child releases the checkout; this label deliberately does not,
because releasing it would start the next child on top of uncommitted work. **Its lane is left open and
untouched**, for the same reason. **Name the lane directory in the stop report and in the Telegram** — a
person told to look at a working tree and not told which one has been told nothing. The lanes already in
flight finish; no new lane is opened.

**Never apply or remove the label** — `auto-ok`'s rule, at `auto-ok`'s strength. Full definition and the
`needs-decision` comparison: `SKILL.md` → §2z, which is the single source.

## park and continue

When a child hits something this run may not decide — a Tier B toss-up, a Tier C action, an upstream
defect, a split that needs a person — **park the child and keep going.**

```bash
gh api repos/{owner}/{repo}/issues/<N>/labels -f 'labels[]=needs-decision'
gh api repos/{owner}/{repo}/issues/<N>/comments -f body="<what needs deciding, and the options>"
```

`in-progress` is left as it is, and the parked child does **not** hold the repository — `epic:next` gives
`needs-decision` precedence over `in-progress`, so the next child is offered normally. Then return to
step 1; the other children are unaffected unless they depend on this one.

**What happens to a parked child's lane depends on whether it had committed, and the two answers are
opposite.** **Parked before its commit**, the lane is stashed and closed:
`git -C <dir> stash push -u -m "backlogrun: parked #<N>"`, the stash recorded on the Issue, then
`pnpm josh lane:close <N>` (`epic:next` counts a parked child's lane as released, and `lane:close`
removes the work tree by force). **Parked after its commit and push**, the lane is *kept*: nothing to
stash, and closing would delete the local branch the resume needs. **A lost merge race is not one of
these rows** — it resolves in its lane ("Conflicts are not predicted" above), and parks only under that
section's four conditions, which take the after-commit row. Both rows and the `pnpm josh run:release
<N>` every parked ending owes are "What happens to a lane" above, the single source.

**Parking replaces stopping the session, not the rule that produced the stop.** An upstream defect is
still filed immediately and unconditionally (Tier A for a first-party target), and a workaround is still
forbidden. **A placement choice is not one of the things this run may not decide.** `epic:bundle`'s
`ask` is Tier A: choose the epic you recommend, add it with `pnpm josh epic --add <E> <N> --after <M>`,
and record the decision on both the new Issue and that epic's `## Decisions`. What remains a park is a
genuine toss-up between two equally apt epics, and that is rare.

**Removing the label is Tier A — do it without asking.** When the decision is recorded (to the epic's
`## Decisions`), remove the label; the state is on GitHub, so the run picks up where it left off.

```bash
gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/needs-decision 2>/dev/null || true
```

**The released child goes back to a lane, never into the parent's own context.** A parent that is
*already* running, and clears a label mid-run because a person just answered, dispatches it the same way
rather than picking up its diff itself — `pnpm josh lane:open <N>` then `pnpm josh lane:dispatch <N>`. A
parent that implements the released child inline is the failure the orchestrator rule is written against:
"The parent orchestrates and never implements a child in its own context" above.

Without removing the label the parked child never runs again — it is the second half of the
human-in-the-loop cycle, not an optional tidy-up.

## `in-progress` is removed by whoever finds it stale

Nothing in the codebase removes `in-progress`; a normal finish closes the issue. An interrupted run
leaves it behind, and a child that carries it is excluded from every future `epic:next` — permanently.
**A session that detects a stale child removes the label itself** (Tier A) and reports it, before
continuing the loop.

**It costs more than that one child now.** An open issue carrying `in-progress` occupies one of the
repository's lanes — whichever epic it belongs to — so a stale label narrows every epic that touches
that checkout. **The rule therefore applies to any open issue in the repository, not only to this epic's
children**, and `epic:next` names the holders on standard error. **Age alone is not the test.** Check the
90-minute window below *and* look at what is holding it, because three states hold the label legitimately
for longer: a `halfrun` stopped for manual verification, any run paused mid-child, and a child stopped by
`needs-human-review` (which waits on a person reading an artifact, and carries its own label alongside
`in-progress`). **All three leave uncommitted work in the checkout**, so `git status` there is the
decisive read: a dirty tree means the hold is real — leave the label alone and report, never strip it and
start a second child on top of that work.

**A closed issue's labels are neither a finding nor something to clean up.** A closed issue holds no lane
(`epic-busy.ts` counts holders from the open listing alone) and `epic:next` never offers it, so
`in-progress` left behind on one changes nothing. **Do not report it, and do not strip it** — a report is
read as something that needs attention, so a run that lists non-findings is a run whose real findings are
harder to see.

```bash
gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/in-progress 2>/dev/null || true
```

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
the transcript parsing is what the `diag` skill forbids, and the re-measurement belongs to
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

## A prerequisite discovered mid-run

Finding that something else in **this** repository has to land first is not a split, and not an upstream
defect. The child in hand is still one deliverable; it just needs another one before it. The three-way
distinction, the `route:tier-a` filing command and the filing ceiling are `SKILL.md` → §2d, the single
source; what follows is this entry's branch.

`<M>` below is the child being implemented when the prerequisite turned up; `<N>` is the new Issue.

1. File the prerequisite Issue `<N>` with the `route:tier-a` label — Tier A for a first-party
   repository, no confirmation. It is filed **first** because the next step names it.
2. **Stash the work in progress.** A child is implemented on the default branch with an uncommitted tree,
   so `<M>`'s half-finished edits are sitting there, and the next child's `git switch main && git pull`
   would refuse or carry them into the prerequisite's branch and PR.

   ```bash
   git stash push -u -m "backlogrun: paused #<M> for prerequisite #<N>"
   gh api repos/{owner}/{repo}/issues/<M>/comments -f body="<what was stashed, and that #<N> must land first>"
   ```

   **`-u` is not optional** (a new `*.test.ts` is untracked). The comment makes the paused state
   auditable and tells the session that resumes `<M>` a stash is waiting. `git stash pop` when
   `epic:next` offers `<M>` again, after its `git switch main && git pull` — the prerequisite has merged
   by then, so expect to resolve conflicts.

3. `pnpm josh epic --add <E> <N> --before <M>` — one command writes the task-list row, the declaration
   and the `blocked-by` relation together. Never edit the body by hand: the declaration and the relations
   then disagree, `epic:next` returns `error`, and the unattended run stops.
4. **Remove `in-progress` from `<M>`** — `gh api -X DELETE repos/{owner}/{repo}/issues/<M>/labels/in-progress 2>/dev/null || true`.
   This is what lets `<M>` run again: `epic:next` classifies a child carrying `in-progress` as waiting on
   time **before** it looks at any blocker, so a child left labelled is never offered again.
5. **Do not park.** Go back to step 1 of the loop. `epic:next` classifies the original child as resolving
   on its own and hands back the prerequisite first, so the order is kept with no human input.

**Parking is only for a prerequisite that cannot be expressed as a dependency** — one that needs a design
decision nobody has made, or that is a Tier B toss-up or a Tier C action. Parking one that *can* be
expressed inverts the whole point: `needs-decision` is cleared by a person.

## Splitting a child mid-run

Discovering that a child is really several is not a reason to stop. File the new children with the
`route:split` label (Tier A for a first-party repository — no confirmation), then add them with
`pnpm josh epic --add <E> <N...> [--before <M> | --after <M>]` rather than editing the epic body by hand.
Use the same split criteria as `kickoff`. If what remains of the original child needs a person, park
**that** child and move on.

## Guards

| Guard | Limit | On reaching it |
| --- | --- | --- |
| Children per run | 30 | Stop and report; an epic this large should be split. |
| Issues filed per run | 10 | Stop and report; a run filing more than this has lost the plot. |
| Consecutive child failures | 3 | Stop and report; something is wrong with the environment, not the children. |

A failure that is not consecutive parks its child and the run continues.

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

## Stopping conditions

`backlogrun` stops only here:

1. `epic:next` reports `complete`, and the summary has been sent.
2. `epic:next` reports `stop` — every remaining child needs a person; report them.
3. `epic:next` reports `error` — a cyclic or contradictory graph.
4. A guard above was reached.
5. A timeout above elapsed.
6. `pnpm josh cost --over 300000` answered `over` — or could not answer — just after a child merged, and
   every lane still in flight records the path the next session will poll it on. This is the one stopping
   condition that is not a problem: nothing is parked, nothing is filed, the epic is unchanged, and the
   lanes keep running. **The reading stops the run in its own turn** — with the one exception that a lane
   nobody could poll, `unreadable` or `open` with no recorded path, sends it back to step 1 instead.

**A child that needs a decision is not on this list.** It is parked, and the run continues. **Neither is
a delegated unit that stopped without reporting** — booked as a failure and parked, the loop goes on;
only the consecutive-failure guard can turn it into a stop.
## This file is the single source of the `backlogrun` procedure

`CLAUDE.md` carries the keyword's row in the shorthand table and the explicit-invocation rule;
`SKILL.md` → §1 routes here. Everything else about a `backlogrun` is either in this file or in
this file, and where the two could disagree, the rule is that this file adds nothing to a child's
procedure — it only says which children there are.
