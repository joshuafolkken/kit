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
3. **The verdict words are `wait`, `stop`, `error` and `none`** — `none` is `epic:next`'s `complete`
   under this command's spelling, and there is no `complete` here.
4. **Exit code 0 covers all four verdicts, and 1 means the listing could not be read** — no answer at
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
| `error` | The graph could not be resolved — report what the command printed on standard error and finish. **Never re-ask hoping for a different answer**, and never fall back to picking an issue by hand: that would be the run choosing its own membership | `unreadable` |
| `none` | Nothing opted in is left | `exhausted` |
| Exit 1, empty standard output | The listing could not be read. Report it and finish — **it is not `none`**, and reading it as one would report an empty backlog that was never seen | `unreadable` |

**Feed every issue this run has merged back through `--exclude`.** GitHub applies `closes #N`
asynchronously, so a just-merged issue can still read as open on the next ask and be offered a second
time. The flag takes a comma-separated list and may be repeated; it drops the issue from every bucket
rather than only from the offer.

**A short offer is not proof the backlog is empty.** The standalone half of the pool is capped at the
same five rows the `🗒 Next issues` display shows, so a sixth opted-in issue simply appears on the
next ask. An epic's children are not capped that way — they come through the epic's own graph.

**The epic side is found server-side by the `epic` label.** An epic that never received the label is
invisible to the listing, and its children can still be offered as standalone issues where they carry
`auto-ok` of their own (joshuafolkken/kit#1633). This is a known limit of the listing, recorded rather
than worked around; do not assert the opposite anywhere.

**New work is picked up without restarting anything.** The command re-derives its pool from GitHub
labels on every ask, so an issue filed and opted in while the run is going is offered on the next
iteration.

### The two budgets

**A `backlogrun` may declare how long it will watch an empty backlog and how many issues it may
take** (joshuafolkken/kit#1632). Both are written on the keyword, and **both are off by default**, so
`backlogrun` with neither behaves exactly as it did before they existed:

```
backlogrun
backlogrun --idle 30
backlogrun --max 5
backlogrun --idle 30 --max 5
```

| Budget | Written | Default | What it does |
| --- | --- | --- | --- |
| Idle watch | `--idle <minutes>` | off | After the candidates run out, keep polling this long for a new one. A candidate that appears restarts the watch from that moment |
| Maximum issues | `--max <count>` | unlimited | How many issues this invocation may take. On reaching it the run reports and finishes |

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

| Verdict | What the loop does |
| --- | --- |
| `run` | Start what `backlog:next` offered, up to the free lanes. The reason names how many more the maximum still allows; start no more than that |
| `watch` | Sleep the polling interval and ask both commands again. **Nothing is held while watching** — the working tree's hold was released at the last child's merge and each drained lane was closed there, so a watching run blocks no other run |
| `stop` | Report and finish. The reason it printed **is** the termination reason the completion report carries |

`--started` is when the invocation began; `--active` is when it last had work — the most recent ask
that was **not** `exhausted`, and the run start before there is one. **Refreshing `--active` is what
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

### Where the run stops

Termination is decided by what the loop is told, never by a judgement that enough has been done:

- **`pnpm josh backlog:budget` answering `stop`** — the single decision, covering the backlog
  emptying with no idle watch, an idle watch running out, the maximum being reached, a parked
  backlog, an unreadable listing, and the whole-run bound.
- **The whole-run 8-hour bound is unchanged and outranks both budgets**, and the idle watch lives
  inside it: `epicrun.md` → "Waiting, and never waiting forever" is still where the figure is stated,
  and `backlog:budget` is what applies it, so a run at the bound stops with candidates in hand and a
  watch still open.
- **The guards in `epicrun.md` → "Guards"** apply unchanged, counted over the whole `backlogrun`
  rather than per epic: children per run, Issues filed per run, and consecutive child failures. The
  maximum above is a person's declaration of scale and does not replace any of them — whichever binds
  first ends the run.
- **A `needs-human-review` child stops the whole run** before its commit — `SKILL.md` → §2z, which is
  the single source, and `epicrun.md` → "`needs-human-review` — the one stop that is not a park" for
  what happens to its lane.
- **The hand-off check** — `pnpm josh cost --over 400000` at every child's merge, and the lane drain
  that follows an `over` — is `epicrun.md` → "The hand-off", unchanged.

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

**`pnpm josh epic:audit` is not run.** There is no epic to audit — the run began from the backlog, the
same reason `epicrun.md` skips it when it began from a bare Issue. The dependency graph the loop acts
on is still audited in effect, because `backlog:next` reuses `epic:next`'s own read and classify and
answers `error` rather than guessing when it cannot resolve one.

## This file is the single source of the `backlogrun` procedure

`CLAUDE.md` carries the keyword's row in the shorthand table and the explicit-invocation rule;
`SKILL.md` → §1 routes here. Everything else about a `backlogrun` is either in this file or in
`epicrun.md`, and where the two could disagree, the rule is that this file adds nothing to a child's
procedure — it only says which children there are.
