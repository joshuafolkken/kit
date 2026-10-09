# `backlogrun` — the detailed procedure behind the manifest

Point-of-use, read one section at a time from `backlogrun.md` → "The route table"; how the driver runs the loop on its own is `docs/maintainers/backlogrun-driver.md`.

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

**An issue found by opted-in work is opted in by default** (joshuafolkken/kit#3213) — this paragraph is
the single source of the `auto-ok` default, and `pnpm josh issue:file` computes it
(`scripts/issue/issue-auto-ok.ts`), printing `auto-ok: applied` or `auto-ok: not applied` with the
reason. It applies `auto-ok` while a `backlogrun` carry record is live, or when the issue the current
branch names carries `auto-ok`, and never on a `--repo` filing to another repository. **Pass
`--no-auto-ok` only when the new issue needs a person's judgement** — a Tier B toss-up or a Tier C
action inside it; a choice with a clear recommendation is Tier A and does not qualify. Outside those
signals `auto-ok` stays a person's to apply. **Which ones carry the label, that rule; in what order and
how many at once, the run** — the brake below bounds the quantity, not the membership. The end-of-run
retrospective files while the record is live, so its filings take the same default and count against
the same brake.

A Tier C action inside a child still stops that child, exactly as it does for any batch child.

**A named issue is approved by the keyword and its number, not by `auto-ok`** (joshuafolkken/kit#1984).
`backlogrun #N1 #N2 …` runs those issues whether or not they carry the label; the pool that follows is
unchanged. "Named issues run first, in order" below is the procedure.

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

**`backlogrun #N1 #N2 …` runs the named issues before it touches the pool** (joshuafolkken/kit#1984),
in the order typed, **one at a time — no lanes**, each as a full `fullrun` in a delegated unit
(`backlogrun-child.md` → "Each child runs in a delegated unit"); the parent reads each one's state back
with `pnpm josh issue:state <N>`, never the unit's summary. `pnpm josh backlog:plan #N1 #N2 …` renders
the order, and `scripts/backlog/backlog-named.ts` is its single source.

**A named issue that cannot finish parks, and the rest of the named list is skipped**; the run then
drains the pool, and the report lists what was not started (`backlog_named.after_failure`). A
`needs-human-review` named issue stops the whole run (`needs-human-review.md`). **`--only` runs the
named list and stops there, draining no pool** — a failure under `--only` ends the run, and `--only`
with no named issues is refused before anything starts (`backlog_named.startup`).

## The session cut is inside the invocation

**This section is the single source of the mechanism.** **A named-issue `backlogrun #N1 #N2 …` pins its
list across the cut**: the record keeps the **opening** list at every cut, and the issues it has
finished live in the record's `done` field rather than shrinking the string — a resumed session reads
`remaining` from `pnpm josh run:carry --json` and runs those, then drains the pool as ever. **`--only`
rides in that invocation string like every other token**, so a resumed session runs the remaining named
issues and **stops** rather than draining the pool the person excluded.

**Typing `backlogrun` once authorizes the declared budget, and a session cut does not end the run.**
`backlogrun-progress.md` → "The hand-off" stops the _session_ at the seam; the next session picks the
same invocation up with the budget already partly spent. The budget is carried in a record rather than
in the conversation:

```bash
pnpm josh run:carry --begin "backlogrun --max 5 --idle 30" --owner "$PPID"
pnpm josh run:carry --json                                                   # read it back in a resumed session
pnpm josh run:wake --start                                                   # same turn as --begin
```

**Always pass `--owner "$PPID"`** — the parent loop's own long-lived process. Left off, `busy` cannot
be answered and every standing record is refused rather than resumed. A live PID whose start token
the sandbox cannot read is held as `busy`.

**Ask it before the plan, in the same turn as the first `pnpm josh ms`.** The contract is
`docs/josh-commands-run.md` → "`josh run:carry`"; what this loop does with each answer is here:

| It answers | What the run does |
| --- | --- |
| `began` | The invocation's first session: report the plan and run the decision pass |
| `resumed` | **A cut run continuing** — take the budget figures from `--json`, never this session's zero; report the plan again and read `backlogrun-progress.md` → "Resuming after a cut" |
| `busy` | Another live parent is spending this budget. **Stop; do not open a lane** — nothing here is yours to end |
| `over` | This session is over the context-cut threshold and claims nothing (joshuafolkken/kit#2760). **End the conversation**; retype the invocation in a fresh session |
| `standing` | An unwatched crash and the command retyped over it. **Stop; do not open a lane**: report `pnpm josh run:carry --resume "<invocation>" --owner "$PPID"` and `pnpm josh run:carry --end` for the person to choose. A crash from a run-tooling defect this run has since fixed you resume yourself (`upstream-interrupt.md` → "実行中のリポジトリ自身のラン機構の不具合") |
| `mismatch` | A record for a **different** invocation. **Stop; do not open a lane**, never resume into it; `--end` it once you know that run is over |
| `expired` | The 8-hour bound is spent. On standard output (a handed-off record): report, stop and `--end` it. On standard error ahead of `began`: a new run replaced it |
| `unreadable` / `unknown` | Report what it printed and **stop before opening a lane** |

**The record is the parent loop's, and a lane never touches it.** A delegated unit is briefed with its
child and nothing about the budget. `--begin` claims the record exclusively, so a second parent is
answered `busy`. Count into it — `--merged <N>`, `--filed 1`, each with `--owner "$PPID"` — and **`--cut`
is the session's last write**: a count after it is refused.

**End the record when the run ends** — `pnpm josh run:report`, then `pnpm josh run:carry --end`, **never
batched with it**: `run:report` scopes by the record `--end` removes. Stop the supervisor in the same
turn with `pnpm josh run:wake --stop`. **Where the run ends by _stopping_ rather than finishing** — a
`stop` verdict or the consecutive-failure guard — **end it with
`pnpm josh run:carry --end --stopped "<one-line reason>"` instead**, which pushes one ⏸️ confirmation
in the session language; a clean completion takes the bare `--end` and stays silent
(`progress-watcher.md` → "Progress while the run is quiet").

**A driver hand-off of `epic #N` is a named epic**: run its children by `backlogrun-progress.md` → "Running a named epic's children", never
the root as a standalone `fullrun`, and once every child has merged or parked record the root with
`pnpm josh run:carry --done <E> --owner "$PPID"` so the next driver pass advances.

**A person keeps control of the supervisor** — `pnpm josh run:wake --list` names it and `--stop` ends it
(`docs/josh-commands-run.md` → "`josh run:wake`"). **A supervisor stopped by a run-tooling defect is
restarted by the AI once the fix lands** — `upstream-interrupt.md` → "実行中のリポジトリ自身のラン機構の不具合".

**The reading is scoped to `backlogrun`.** A `fullrun` cut still waits for a person's keystroke.

Rationale: `docs/maintainers/backlogrun-steps-rationale.md` → "Why a session cut does not end the run"

## The plan, before the first child starts

**A `backlogrun` reports its plan before it starts anything.** Nothing is dispatched, no lane is
opened and no issue is picked up until the plan has been reported and the decision pass below has
run. **The plan is one command's output** — `pnpm josh backlog:plan` — rendered from the same
classified pool `backlog:next` answers from, so **the plan cannot promise an order the run does not
take**. Its four sections:

- **Ready now** — the runnable children, grouped by repository. **The grouping is the parallelism**.
- **Waiting** — every withheld child, each naming **what it is waiting on**.
- **Waiting on a person** — the `needs-decision` children, the next subsection's input.
- **Out of scope** — every open issue the backlog will **not** run, with the reason.

**Report all four to the person, in the session language, before the first child starts**, epic
children enumerated individually, with any truncated-listing `⚠` (the plan is then partial).

### Resolve what the plan can resolve, before starting

**Every `needs-decision` issue the plan listed is settled in one pass at the start, rather than one
stop at a time.**

- **Decide everything decidable from the issue itself.** Read the issue's body **and its comments**
  (`issue-comments.md`), and where the answer is already there, record it as an Issue comment and
  **remove the label** — `CLAUDE.md` → "Decision autonomy" already makes that Tier A. **Read them all in
  one `pnpm josh issue:read <N> <N> …` call**, not a `gh api` pair per issue.
- **Never measure in order to decide.** A question needing a benchmark, a profile, or a run of the
  thing itself is not settled here: it stays labelled and the plan says so.
- **Label what you find.** An issue needing a person's judgement — `backlogrun-park.md` → "Only a
  person's judgement carries `needs-decision`" — gets the label, applied as "park and continue" does. **The next plan classifies it by the label alone**,
  never the body.
- **Order and isolate the pool in the same pass** (joshuafolkken/kit#2776), from the same
  `issue:read`: an issue that must land first (it builds what another reuses, or both edit one code
  path) becomes a native `blocked-by`; an issue meeting all three of the `backlogrun-lanes.md` →
  "A solo run" conditions gets `run:solo`, **every other one `run:lane`**. Comment the reason; the offer commands enforce all
  three, answering `triage` while an issue has neither.
- **`priority:high` puts an issue first** (joshuafolkken/kit#2928; ranking: `docs/josh-commands-backlog.md` →
  `josh backlog:next`). Apply it only on a cited ground — a stated deadline or urgency, or a person's
  written policy — commenting the ground; **never remove it**.
- **Report the order those labels produce — `pnpm josh backlog:plan --waves`** (joshuafolkken/kit#2778),
  `backlog:next` played forward wave by wave. Report it with the plan, never an order derived by hand.
- **Then start the loop.** Whatever is still labelled is reported as parked and left standing; the
  run does not wait on it.

**`needs-decision`, `run:solo`, `run:lane` and `priority:high` are the workflow labels a run may
apply by hand, and none is `auto-ok` or `needs-human-review`.** `needs-human-review` stays a
person's alone (`needs-human-review.md`); `auto-ok` follows "What one invocation approves". A run
parks with `needs-decision` only on `backlogrun-park.md` → "Only a person's judgement carries
`needs-decision`", and a person clears it.

Rationale: `docs/maintainers/backlogrun-steps-rationale.md` → "Why the plan and the decision pass come first"

## The loop

**The loop is computed, not walked by hand.** The `run:wake` supervisor runs `pnpm josh backlog:drive`,
whose head is `pnpm josh backlog:offer` (`docs/josh-commands-backlog.md` → "`josh backlog:offer`" and
"`josh backlog:drive`"). **An AI session reaches this section only when the driver hands a branch
back** — the `Driver result:` line names it, and its `Next:` line is the order: claim the record with
`pnpm josh run:carry --resume "<invocation>" --owner "$PPID"`, act on the branch, then hand the loop
back with `pnpm josh run:carry --cut --owner "$PPID"`. Read only the one section the row names:

| Handed back | What the session judges | Read |
| --- | --- | --- |
| `triage` | Label each issue stderr names `run:solo` or `run:lane` (with `blocked-by` where one must land first); running children continue | "Resolve what the plan can resolve, before starting" above |
| `offer` | `backlog:offer` itself could not answer. Report what stderr printed; **never pick an issue by hand** | — |
| `launch #N` | A lane failed after it opened. Read the lane's log and park `#N` | `backlogrun-park.md` → "park and continue" |
| `merge [<token>] #N` | `run:merge` stopped on `environment`, `busy`, `retry` or `over`, or printed nothing: `environment` ends the run, the others re-read the child | `backlogrun-progress.md` → "Running a named epic's children" |
| `epic #N` | A named epic's turn | "The session cut is inside the invocation" above |
| `watch` | The backlog drained with nothing in flight; the retrospective is owed (`run:step`) | `retrospective.md` |
| `window` | The driver's wait window ran out with nothing to judge; hand the loop back as is | — |

**`window`, `merge busy` and `merge retry` reach a session only after the supervisor's own re-runs run
out** (`run-wake-driver.ts`). **A candidate only in another repository is never a token** — report it
with its checkout and leave it to a session running there (`backlogrun-lanes.md` → "Concurrency").

The budgets (`--idle`, default 30 minutes, `--idle 0` to turn the watch off; `--max`), the
`run` / `watch` / `stop` verdicts, why a watch never reaches the cost check, and every way the run stops
are the driver's own: `docs/maintainers/backlogrun-driver.md` (rationale:
`docs/maintainers/backlogrun-steps-rationale.md` → "Why the idle watch defaults to 30 minutes";
`docs/maintainers/backlogrun-steps-rationale.md` → "Why the cost check skips a watch").

Rationale: `docs/maintainers/backlogrun-steps-rationale.md` → "Why the loop's contract is shaped this way"

## What runs once per session, not once per issue

| Step | Where it is defined |
| --- | --- |
| `pnpm josh run:carry --begin "<the invocation, single-spaced>" --owner "$PPID"` with `pnpm josh run:wake --start` before the plan; `run:carry --end` with `run:wake --stop` when the run ends | "The session cut is inside the invocation" above |
| `pnpm josh ms`, then `pnpm josh latest:scope`, then `pnpm josh lane:prune` — in the primary checkout, before the first lane opens | `backlogrun-lanes.md` → "Once per repository, before the first lane opens" |
| `josh latest` on `required` only, asked once at the first child and never in a lane | `backlogrun-child.md` → "`josh latest` runs once per session, not once per child" |
| `pnpm josh run:hold <N>`'s preflight check, before each child that is not in a lane — act on what it prints | `docs/josh-commands-run.md` → "`josh run:hold`" |
| `pnpm josh run:progress --wait` in the background, `--mark` at every real report | `progress-watcher.md` → "Progress while the run is quiet" |
| `pnpm josh release:scope` once, after the last issue has merged and the last lane is closed | `followup.md` → "When `pnpm josh release` runs" |

**`run:carry --begin` records the invocation in the form the supervisor rebuilds** — one space between
tokens and a plain integer for each budget value, whatever was typed.

**`pnpm josh epic:audit` is not run.** There is no epic to audit — the run began from the backlog.
`backlog:next` reuses `epic:next`'s own read and classify and answers `error` rather than guessing when
it cannot resolve one.
