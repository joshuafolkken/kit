# The pre-gate cut — a lane child ends its turn before the gate

A lane child is a detached `fullrun #<N>` process, and the thinking it accumulates while implementing
rides on every later API call in the same session. The **pre-gate cut** drops that accumulation: the
child ends its process the moment implementation is done, and a **fresh** process resumes the same lane
from the gate onward. Rationale: `docs/maintainers/pre-gate-cut-rationale.md` → "Why the cut exists".

This file is the single source of the boundary. `run:cut` takes it, and `run:cut --resume` is the
check a fresh process makes at its own entry. **A second boundary is added below** — the
implementation-phase cut, at a context threshold _during_ implementation.
Everything through "What is carried" describes the pre-gate cut; the later section states only what
differs.

## Where the boundary is

**After implementation and the refactor, before `pnpm josh gate`**: implementation complete, nothing
committed, the gate not started. Everything after it (gate → review → commit → push → merge) is
verification the fresh process runs on the tree.

**A lane child first hands it to a detached supervisor** (`chain-rule.md` step 0); the cut is the fallback.

## It applies to a dispatched lane child, and to nothing else

The cut is for a **detached** `fullrun` a lane dispatched; a person's interactive `fullrun` never
relaunches itself. A dispatched child is told apart **mechanically, by a mark the dispatch sets** — never
by the model reading the shape of its own prompt.

### The dispatch mark

`lane:dispatch` starts each child generation with the environment variable **`JOSH_LANE_CHILD`** set
to the lane's issue number. `scripts/lane/lane-child-marker.ts` is its one definition.

- **Meaning**: "this session was launched for issue `<N>`, not typed by a person."
- **Lifetime**: the child process — set at launch, read at the gate, never written by the run itself.
- **Trust**: only where its value equals the lane's own issue. A mark that leaked in from a parent
  session — naming another issue, or none — is read as a person, so a leak cannot make the guard fire
  on a checkout it does not belong to.

The name, meaning and lifetime are documented here and nowhere else.

`run:cut` decides the same fact its own way: it looks for an **open lane** for the issue, answering a
checkout with none `not-a-lane`. So the command is safe to issue unconditionally — a no-op in the main
checkout, a cut in a lane.

## Taking the cut

**The order is fixed in the chain**: `chain-rule.md` step 1 issues
`pnpm josh run:cut <N>` after `pnpm josh main:merge`, before the scoped pair and the gate. **The command
is issued unconditionally**; `run:cut` itself decides whether the cut is warranted, so a short lane with nothing to drop is answered `under-threshold` and walks on
to the gate rather than relaunching.

At the pre-gate boundary, issue:

```bash
pnpm josh run:cut <N>
```

- `cut` (0) — record written and handed to the lane's launch owner (OpenAI supervisor starts the
  successor after this process exits; Anthropic relaunches directly). **End the turn immediately** —
  the fresh process owns the run.
- `under-threshold` (0) — the newest request's billed input is under the shared `CONTEXT_CUT_THRESHOLD`,
  so nothing was cut; **continue to the gate.**
- `not-a-lane` (0) — no open lane for this issue, so not a dispatched child. **Continue to the gate.**
- `unready` (1) — the tree is clean or on the default branch, nothing to carry. Continue to the gate.
- `busy` (1) — a cut is already in flight for this tree (the double-cut guard). Do not relaunch.
- `failed` (1) — no live OpenAI supervisor, or the Anthropic relaunch could not start. Continue.
- `unknown` (1) — the git directory could not be read. Continue to the gate.

**`cut` is the only verdict that ends the turn.** Every other one — `under-threshold` included — leaves
the current process to carry the run on itself.

### The gate refuses until the cut has been taken

`pnpm josh rule:guard` **refuses `pnpm josh gate`** while this checkout is a lane and no cut record is
carried, handing back the command above. Rationale:
`docs/maintainers/pre-gate-cut-rationale.md` → "Why the rules are guards, not prose".

- **It fires for a marked child and nowhere else**: the working directory is a lane —
  `<lane root>/<issue number>` — **and** `JOSH_LANE_CHILD` names that same issue. An interactive
  `fullrun` carries no mark and runs its gate untouched. `run:cut` uses an open-lane lookup instead, so
  the guard and the command need not agree byte for byte.
- **It fires only when the current context warrants a cut**. The guard
  reads the same `cost_cli.session_verdict` `run:cut` reads, so an `under`-threshold lane is let through
  to the gate rather than refused.
- **It is silent once the cut is carried**, so the resumed process goes straight to the gate.
- **It fires once per run.**
- **`--resume`, `--end` and `--json` do not count as taking the cut.**

The row, its trigger and the enumeration it joins are
`prompts/collaboration-workflow/rule-delivery.md`. The suites that pin this and the three guards below:
`docs/maintainers/pre-gate-cut-rationale.md` → "Which suites pin each guard".

## Resuming — the fresh process's entry check

A fresh `fullrun #<N>` runs this **at its entry, before `run:hold` and the session-boundary check**,
because whether it is fresh or resumed decides everything that follows:

```bash
pnpm josh run:cut --resume <N>
```

- `fresh` (0) — no cut record, an ordinary run. Proceed with the normal entry: claim the hold, ask the
  session boundary, read the issue, implement.
- `resume` (0) — a declared pre-gate cut whose tree matches was verified and taken over. **Skip the
  title, the plan, the fresh hold claim and the implementation**; re-read the issue body and comments
  for the plan and the recorded decisions, then go straight to `pnpm josh gate`.
- `resume-impl` (0) — like `resume`, but the cut was taken **during** implementation. Skip the title, the plan, the fresh hold claim and the split assessment,
  re-read the plan, then **continue implementation** — do **not** go straight to the gate.
- `handed-off` (0) — a successor has already adopted this cut, `is_handed_off` is spent.
  This process was woken **after** its own cut. **End the turn quietly and do
  nothing**: a benign stop, no Telegram owed.
- `stale` (1) — the record does not match the tree (wrong branch, a clean tree, an expired record, or
  an unknown hand-off state). **A resume failure**: send a `confirmation` Telegram and stop; never gate
  the wrong tree.
- `busy` (1) — another process already owns the resume. Send a `confirmation` Telegram and stop.

**A resume is never reported as a success it did not earn**: `stale` and `busy` stop the run rather
than gating.

### The stage is passed to the resumed child, not reconstructed by it

A resumed child arrives with `JOSH_LANE_CHILD` still set and `run:cut --resume` reads the record the cut
left, so it learns _where to resume from_ at its entry. **Skip the entry it has already done**: do not
re-read the workflow skill, repeat the split assessment or re-normalize the title; the plan and
decisions are read back from the issue. Rationale:
`docs/maintainers/pre-gate-cut-rationale.md` → "Why the resume carries what it carries".

## What is carried, and what is not

- **The working tree is not in the record, because it never left the disk.** The record carries only
  what a fresh process cannot recover — the issue, the branch, the invocation, and that a **declared
  cut** put it here. **The conversation is not carried**; the fresh process reads the plan and
  auto-decisions back off GitHub.
- **The hold is kept, not released** — the resumed process adopts the `run:hold` record and
  `pnpm josh followup` releases it at the merge.
- **The dispatch mark is re-applied, not inherited**: the relaunch strips the parent's environment and
  sets `JOSH_LANE_CHILD` afresh from the lane's issue.

## Verification, uniqueness and double-launch

- **The resume verifies the tree against the record**: the branch matches, the tree is dirty, the
  issue matches, and the tree is still under the cutting run's hold. Any mismatch is `stale`.
- **No owner is recorded on the cut** — the cut is the stage hand-off alone (OpenAI keeps its
  supervisor owner separately).
- **The cut is exclusive** — `run:cut` writes the record with an exclusive create, so a second cut on
  the same tree is refused `busy`.
- **The resume is unique.** Taking the hand-off over spends it — a second `run:cut --resume` reads a
  spent record and is answered `handed-off`, and the take-over is itself an
  exclusive create, so two resumes racing cannot both win. One lane crosses the pre-gate boundary
  exactly once.

## The implementation-phase cut — a lane child cuts before the gate too

The **implementation-phase cut** caps the context accumulated _during_
implementation — the child ends mid-implementation and a fresh one resumes the lane **back into
implementation**.

### The measurement is the parent hand-off's, never a second one

The guard below refuses on the same measurement the parent uses between children —
`cost_verdict.per_request_cost`, read through `cost_cli.session_verdict` (the read-only form of
`pnpm josh cost --cut`), single-sourced at `backlogrun-progress.md` → "The
hand-off". The parent's seam and the child's `run_cut.IMPLEMENTATION_CONTEXT_THRESHOLD` share the
**135_000** `CONTEXT_CUT_THRESHOLD` (aliased so the tests cannot drift). No separate measurement is
built for the lane child.

### It is a guard, fired at the edit that crosses the threshold

**The trigger**: `pnpm josh rule:guard` refuses an `Edit` / `Write` in a dispatched lane child whose
recent-context cost is over threshold, handing back `pnpm josh run:cut --impl <N> --handoff <path>`.
`cut` ends the turn; a fresh process's `run:cut --resume <N>` answers `resume-impl` and continues
implementation — **the implementation resume clears the record**, so the cut may fire again. Outside
a lane, a held run on a measured `over` keeps the hold, sends a `confirmation` Telegram naming
`fullrun #<N>` and ends the turn. The refusal states the rest — **It fires on every threshold crossing,
not once per run**; **An edit reissued right after a refusal passes**; **An unmeasurable session
warrants the cut**; **It is silent between a cut and its resume**. Rationale:
`docs/maintainers/pre-gate-cut-rationale.md` → "Why the rules are guards, not prose";
`scripts/rules/implementation-cut.ts` implements it. A child that ended without cutting is detected
after the fact by `pnpm josh run:ending <N> --output <path>`.

## The threshold

`CONTEXT_CUT_THRESHOLD` and `cost_verdict.per_request_cost` (the newest request's billed input)
are computed by `scripts/cost-runtime/context-cut-payback.ts`, their
single source; both cuts and the parent hand-off read the same verdict, and an unmeasurable session is
always cut. Rationale: `docs/maintainers/pre-gate-cut-rationale.md` → "Why the threshold is a
break-even". Both cuts end the turn **before** the gate, in the same act that starts the successor, so
the push is never a turn boundary (`chain-rule.md`).

## A lane child records its park before it stops

**The trigger**: a dispatched lane child about to stop for a decision (a Tier B toss-up, a Tier C
action, an upstream defect) parks its own Issue first — `backlogrun-park.md` → "park and
continue" — so the parent's `pnpm josh run:liveness` reads it `settled`. A `needs-human-review` or `already-done` stop already carries its label.
`pnpm josh rule:guard` refuses `pnpm josh notify --task-type confirmation` from a marked child until
then — **It fires once per run.**, and a person's own `fullrun` is never refused
(`scripts/rules/lane-park.ts`).

**A split is not a park**: the parent reads an open Issue carrying `epic` as
a split, so a child that promoted its Issue stops without `needs-decision` — `backlogrun-park.md` →
"Splitting a child mid-run". `pnpm josh rule:guard` refuses a `needs-decision` write onto the epic
the child promoted this run, on every occurrence (`scripts/rules/lane-split-park.ts`).

### The interactive ask is refused one call earlier

**The trigger**: a headless session ends the turn on an interactive ask, so the notify guard never
fires. `pnpm josh rule:guard` therefore refuses `AskUserQuestion` for a marked lane child on
every occurrence — park the question instead.
A child that slips past is recovered by `pnpm josh run:ending`, which lifts
the refused ask into the park basis; `scripts/rules/lane-interactive-ask.ts` and the shared
`scripts/agent/interactive-ask.ts` implement it.

Provenance of each rule: `docs/maintainers/pre-gate-cut-rationale.md` → "Where each rule came from".
