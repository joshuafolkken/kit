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
- `under-threshold` (0) — the recent-window per-request cost is under the shared `CONTEXT_CUT_THRESHOLD`,
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
- **It fires only when the recent-window context warrants a cut**. The guard
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
- `handed-off` (0) — a successor has already adopted this cut, `is_handed_off` is spent
  (joshuafolkken/kit#1935). This process was woken **after** its own cut. **End the turn quietly and do
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
  spent record and is answered `handed-off` (joshuafolkken/kit#1935), and the take-over is itself an
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

Rationale: `docs/maintainers/pre-gate-cut-rationale.md` → "Why the rules are guards, not prose".
`pnpm josh rule:guard` **refuses an `Edit` / `Write`** while this checkout is a dispatched lane child
whose recent-context cost is over threshold, handing back `pnpm josh run:cut --impl <N> --handoff <path>` — the
refusal lands _before_ the edit. `cut` ends the turn, the rest leave this process implementing; a fresh
process's `pnpm josh run:cut --resume <N>` then answers **`resume-impl`**, so it **skips the title, plan,
hold claim and split assessment** and **continues implementation** rather than gating. Unlike the
pre-gate cut, **the implementation resume clears the record** — it may fire again, unlike the
once-per-lane pre-gate cut (joshuafolkken/kit#1935); `begin_cut`'s exclusive create still gives each
crossing one successor.

- **It fires for a marked child, or a run held outside a lane on a measured `over`**
  (joshuafolkken/kit#2760); a person's tree holds no run. Outside a lane `cut` relaunches nothing: keep
  the hold, send a `confirmation` Telegram naming `fullrun #<N>`, end the turn.
- **It fires on every threshold crossing, not once per run** — it re-asks on
  each over-threshold edit, including after a `busy` / `failed` / `unready` verdict.
- **An edit reissued right after a refusal passes** — so a `busy` / `failed` cut cannot wedge the run:
  the reissue lands inside a short window and goes through, a genuinely new crossing past it refuses
  again.
- **An unmeasurable session warrants the cut** in a lane, as the pre-gate cut's does.
- **It is silent between a cut and its resume** — a carried record naming this issue keeps it quiet; the
  resume clears it, and the fresh process reads its own transcript under threshold.
- **The verdict read is reused over a short window** — cached per checkout for a few seconds, so a
  turn's burst of edits shares one read.

`scripts/rules/implementation-cut.ts` implements the trigger, and the row joins
`prompts/collaboration-workflow/rule-delivery.md`. **A child that ended
without cutting is still detected after the fact by `pnpm josh run:ending <N> --output <path>`**
(joshuafolkken/kit#2139). **A single check (`lint:related` / `test:related`) is run after a batch of
edits, not after each one.**

## The threshold, and the statistic it is measured against

**`CONTEXT_CUT_THRESHOLD` (135_000) is one value, and `cost_verdict.per_request_cost` — the one
statistic the parent and the lane child both read — averages the most recent `RECENT_REQUEST_WINDOW`
(10) requests, not the whole session**. The value is computed by
`scripts/cost-runtime/context-cut-payback.ts`, its single source.

**The cut is conditional**: taken only when the recent-window per-request cost
is over `CONTEXT_CUT_THRESHOLD` — the same statistic and threshold the implementation-phase cut reads, so
no second threshold exists. Below it `run:cut` answers `under-threshold` and the gate runs uncut; the
guard reads the same verdict and stays silent. An **unmeasurable** session is always cut.
Rationale: `docs/maintainers/pre-gate-cut-rationale.md` → "Why the threshold is a break-even".

## Consistency with the chain rule

The chain forbids ending a turn at the push, with CI in flight and nothing set to resume. **The pre-gate
cut and the detached hand-off end it _before_ the gate** and start what carries the run on in the same
act — a fresh process, or the supervisor — so the push is never a turn boundary. The implementation-phase
cut is the same pattern one boundary earlier.

## A lane child records its park before it stops

**A dispatched lane child records its park on the Issue before it stops for a decision**
(joshuafolkken/kit#2034). A headless child's only route to ask a person is to park the Issue (#2012,
#2011). Rationale:
`docs/maintainers/pre-gate-cut-rationale.md` → "Why the rules are guards, not prose".

**The record, before the Telegram, is the park procedure exactly** — `needs-decision` plus a comment
carrying the question, the options, and whether work was stashed. Its single source is
`backlogrun-park.md` → "park and continue", followed against the child's own Issue before the
`confirmation` notify; with the label on the Issue, the parent's `pnpm josh run:liveness` reads the
child as `settled`.

**A `needs-human-review` or `already-done` stop needs nothing added** — those labels are already on the
Issue. It is only a decision-stop (a Tier B toss-up, a Tier C action, an upstream defect, a split) that
would otherwise leave the Issue bare.

### The stop notify refuses until the park is recorded

`pnpm josh rule:guard` **refuses `pnpm josh notify --task-type confirmation`** while this checkout is a
lane child — the mark `JOSH_LANE_CHILD` names this lane's own issue — handing back the park commands.

- **It fires for a marked child and nowhere else.** A person's own `fullrun` carries no mark and sends
  its stop notify untouched.
- **It fires once per run.** The child records the park and reissues the same notify; a
  `needs-human-review` or `already-done` stop reissues after the one delivery, its label already on the
  Issue.
- **The park state is not readable synchronously**, so the delivery is a checklist — one wasted reissue
  on the compliant path is safe.

This section is the single source of the lane-child park rule; `scripts/rules/lane-park.ts` implements
the trigger, and the row joins the enumeration in
`prompts/collaboration-workflow/rule-delivery.md`.

### The interactive ask is refused one call earlier

(joshuafolkken/kit#2201) The harness refuses an interactive ask in a headless session by **ending the
turn**, so the notify guard never fires (#2178 — the failure joshuafolkken/kit#2034 set out to prevent,
one call upstream). So `pnpm josh rule:guard` **refuses `AskUserQuestion` for a marked lane child**; the
deny returns to the model, and the instruction is to park the question. It fires on **every occurrence**
and stays silent for a person working in a lane. Rationale:
`docs/maintainers/pre-gate-cut-rationale.md` → "Why the rules are guards, not prose".

**A child that slips past it is still recoverable** — `pnpm josh run:ending` lifts the refused ask out
of the exit record's `permission_denials` into the `abandoned` verdict's park basis, so the parent puts
it into the park comment. `scripts/rules/lane-interactive-ask.ts` implements the trigger, and
`scripts/agent/interactive-ask.ts` is the
shared extractor the guard and `run:ending` both read.

This file is the single source of the rule.
