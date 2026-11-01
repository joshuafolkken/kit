# The pre-gate cut — a lane child ends its turn before the gate

The **pre-gate cut**: a dispatched lane child ends its process the moment implementation is done, and a
**fresh** process resumes the same lane from the gate onward, without the implementation's accumulated
context.

`run:cut` takes the boundary, `run:cut --resume` is the fresh
process's entry check. A second boundary — the implementation-phase cut, _during_ implementation — is
below; it states only what differs.

## Where the boundary is

**After implementation and the refactor, before `pnpm josh gate`**: nothing committed, the gate not
started. **A lane child first hands it to a detached supervisor** (`chain-rule.md` step 0); the cut is
the fallback.

## It applies to a dispatched lane child, and to nothing else

A person's interactive `fullrun` never relaunches itself. A dispatched child is told apart
**mechanically, by the `JOSH_LANE_CHILD` mark the dispatch sets** — never by reading its own prompt
(`docs/josh-commands-run.md` → "`josh run:cut`").

An interactive `fullrun` carries no mark, and every
guard in this file holds that boundary: **It fires for a marked child and nowhere else**. `run:cut`
answers `not-a-lane` outside a lane, so it is safe to issue unconditionally.

## Taking the cut

`chain-rule.md` step 1 issues it before `pnpm josh run:chain <N>`, the scoped pair and the gate —
**unconditionally**:

```bash
pnpm josh run:cut <N>
```

- `cut` (0) — record written and handed to the lane's launch owner (OpenAI supervisor starts the
  successor after this process exits; Anthropic relaunches directly). **End the turn immediately.**
- `under-threshold` (0) — the newest request's billed input is under the `pnpm josh cost --cut` threshold; **continue to the gate.**
- `not-a-lane` (0) — not a dispatched child. **Continue to the gate.**
- `unready` (1) — the tree is clean or on the default branch. Continue to the gate.
- `busy` (1) — a cut is already in flight for this tree. Do not relaunch.
- `failed` (1) — no live OpenAI supervisor, or the Anthropic relaunch could not start. Continue.
- `unknown` (1) — the git directory could not be read. Continue to the gate.
- `split-unresolved` (1) — `split-assessment.md` → "Over the guide before the gate".

**`cut` is the only verdict that ends the turn.**

### The gate refuses until the cut has been taken

The `pre-gate-cut` row of `pnpm josh rule:list` **refuses `pnpm josh gate`** in a lane with no cut record carried, handing back
the command above — run it. When the guard fires: `docs/josh-commands-run.md` → "`josh run:cut`"; its
row: `prompts/collaboration-workflow/rule-delivery.md`.

## Resuming — the fresh process's entry check

A fresh `fullrun #<N>` runs this **at its entry, before `run:hold` and the session-boundary check**:

```bash
pnpm josh run:cut --resume <N>
```

- `fresh` (0) — an ordinary run; normal entry.
- `resume` (0) — a verified pre-gate cut. **Skip the title, the plan, the fresh hold claim and the
  implementation**; re-read the issue body and comments, then go straight to `pnpm josh gate`.
- `resume-impl` (0) — the cut was taken **during** implementation. Skip the title, the plan, the
  fresh hold claim and the split assessment, re-read the plan, then **continue implementation** — do
  **not** go straight to the gate. A round 1 the resume prints is continued, not rerun
  (`scripts/run/cut/run-cut-review.ts`).
- `handed-off` (0) — a successor already adopted this cut. **End the turn quietly and do nothing**;
  no Telegram owed.
- `stale` (1) — the record does not match the tree (branch, clean tree, expired, or unknown hand-off).
  **A resume failure**: send a `confirmation` Telegram and stop; never gate the wrong tree.
- `busy` (1) — another process owns the resume. Send a `confirmation` Telegram and stop.

### The stage is passed to the resumed child, not reconstructed by it

**Skip the entry it has already done**: do not re-read the workflow skill, repeat the split assessment
or re-normalize the title; the plan and decisions are read back from the issue.

## What is carried, and what is not

- **The working tree is not in the record, because it never left the disk.** The record carries the
  issue, branch, invocation, and that a **declared cut** put it there. **The conversation is not
  carried**; plan and auto-decisions are read back off GitHub.
- **The hold is kept, not released** — `pnpm josh followup` releases it at the merge.
- **The dispatch mark is re-applied, not inherited.**

## Verification, uniqueness and double-launch

- **The resume verifies the tree against the record**: branch, dirty tree, issue, and the cutting
  run's hold. Any mismatch is `stale`.
- **Adoption records its session**; only that session may replace its adopted pre-gate record with an
  implementation cut. An unknown adopter stays protected (OpenAI keeps its supervisor owner separately).
- **The cut is exclusive** — a second cut on the same tree is `busy`.
- **The resume is unique** — a spent record answers `handed-off`, and the take-over is an exclusive
  create. One lane crosses the pre-gate boundary exactly once.

## The implementation-phase cut — a lane child cuts before the gate too

The child ends mid-implementation and a fresh one resumes **back into implementation**.

### The measurement is the parent hand-off's, never a second one

Same `cost_verdict.per_request_cost` through `cost_cli.session_verdict` as `backlogrun-progress.md` →
"The hand-off", against the same threshold `pnpm josh cost --cut` prints.

### It is a guard, fired at the edit that crosses the threshold

**The trigger**: the `implementation-cut` row of `pnpm josh rule:list` refuses an `Edit` / `Write` in a dispatched lane child over
threshold, handing back `pnpm josh run:cut --impl <N> --handoff <path>`. `cut` ends the turn; the
fresh process's `run:cut --resume <N>` answers `resume-impl` — **the implementation resume clears the
record**, so the cut may fire again. **A cut that relaunches its successor owes no Telegram** — the
`Stop` hook reads the relaunch off the turn's own `run:cut` output, not off the record the resume
clears. Outside a
lane, `run:cut --impl` prints the held run's instruction: on `over`, keep the hold, send a
`confirmation` Telegram naming `fullrun #<N>`, end the turn. **It fires on every threshold crossing,
not once per run**; **An edit reissued right after a refusal passes**; **The run's own handoff
`Write` always passes**; **An unmeasurable session
warrants the cut**; **It is silent between a cut and its resume** (`scripts/rules/implementation-cut.ts`).
A child that ended without cutting is detected by
`pnpm josh run:ending <N> --output <path>`.

## The threshold

The threshold is the break-even context `scripts/cost-runtime/context-cut-payback.ts` prices at the
session's model — `pnpm josh cost --cut` prints it, no fixed figure fits every model; both cuts and the parent hand-off read the same verdict,
and an unmeasurable session is always cut. Both cuts end the turn **before** the gate, so the push is never a
turn boundary (`chain-rule.md`).

## A lane child records its park before it stops

**The trigger**: a dispatched lane child about to stop for a decision (Tier B, Tier C, an upstream
defect) parks its own Issue first — `backlogrun-park.md` → "park and continue" — so `pnpm josh
run:liveness` reads it `settled`. A `needs-human-review` or `already-done` stop already carries its
label. The `lane-park` row of `pnpm josh rule:list` refuses `pnpm josh notify --task-type confirmation` from a marked child
until `pnpm josh run:park` has recorded the park — **It fires once per run.** (`scripts/rules/lane-park.ts`).

**A split is not a park**: a child that promoted its Issue to an `epic` stops without
`needs-decision` — `backlogrun-park.md` → "Splitting a child mid-run". The `lane-split-park` row of `pnpm josh rule:list` refuses a
`needs-decision` write onto that epic, on every occurrence (`scripts/rules/lane-split-park.ts`).

### The interactive ask is refused one call earlier

**The trigger**: a headless session ends the turn on an interactive ask, so the notify guard never
fires; the `lane-interactive-ask` row of `pnpm josh rule:list` refuses `AskUserQuestion` for a marked lane child on every occurrence — park the question instead.
`pnpm josh run:ending` lifts a slipped ask into the park basis (`scripts/rules/lane-interactive-ask.ts`,
`scripts/agent/interactive-ask.ts`).
