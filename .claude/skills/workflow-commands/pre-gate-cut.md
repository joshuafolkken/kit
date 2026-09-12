# The pre-gate cut — a lane child ends its turn before the gate

A lane child is a detached `fullrun #<N>` process, and the thinking it accumulates while implementing
rides on every later API call in the same session — measured at **176K of 204K output tokens** on
joshuafolkken/kit#1837, which is why the second half of a run costs about twice the first over the
same number of requests. The **pre-gate cut** drops that accumulation: the child ends its process the
moment implementation is done, and a **fresh** process resumes the same lane from the gate onward,
carrying none of the thinking.

This file is the single source of the boundary. `run:cut` is the command that takes it, and
`run:cut --resume` is the check a fresh process makes at its own entry. The rule is reached only
**during** a lane child's run, after the workflow skill has been read, so it is not an entry read —
`fullrun.md`, `chain-rule.md` and `epicrun.md` name it with a plain mention and route here.

## Where the boundary is

**After implementation and the refactor, before `pnpm josh gate`.** It is the same boundary
joshuafolkken/kit#1837 puts the `origin/main` merge at: implementation is complete, nothing is
committed, and the gate has not started. Everything before it (reading the issue, the plan, the
implementation) is what produced the thinking to be dropped; everything after it (gate → review →
commit → push → merge) is verification the fresh process runs on the tree the cut left behind.

## It applies to a dispatched lane child, and to nothing else

The cut is for a **detached** `fullrun` a lane dispatched — a process whose turn end is its process
end. A person's interactive `fullrun` is driven by that person and must not relaunch itself, so the
command decides mechanically rather than by judgement: `run:cut` looks for an **open lane** for the
issue, and a checkout with none is answered `not-a-lane` and changes nothing. So the command is safe
to issue unconditionally at the boundary — in the main checkout it is a no-op, and in a lane it cuts.

## Taking the cut

At the pre-gate boundary, issue:

```bash
pnpm josh run:cut <N>          # alias: josh rct
```

| Verdict      | Exit | What it means, and what to do                                                                                                   |
| ------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------- |
| `cut`        | 0    | The record was written and a fresh `fullrun #<N>` was relaunched in the same lane. **End the turn immediately** — do not continue to the gate; the fresh process owns the run from here |
| `not-a-lane` | 0    | No open lane for this issue, so this is not a dispatched child. **Continue to the gate in this process** as an uncut run does    |
| `unready`    | 1    | The tree is clean or on the default branch, so there is nothing to carry. Continue to the gate in this process                  |
| `busy`       | 1    | A cut is already in flight for this tree — the double-cut guard. Do not relaunch a second one                                    |
| `failed`     | 1    | The relaunch could not be started; **the record was cleared**, so continue to the gate in this process. The run is never lost to a failed hand-off |

**`cut` is the only verdict that ends the turn.** Every other one leaves the current process to carry
the run on itself, which is why a `not-a-lane` or a `failed` is not a stop.

## Resuming — the fresh process's entry check

A fresh `fullrun #<N>` runs this **at its entry, before `run:hold` and before the session-boundary
check**, because whether it is a fresh run or a resumed one decides everything that follows:

```bash
pnpm josh run:cut --resume <N>
```

| Verdict   | Exit | What it means, and what to do                                                                                                              |
| --------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `fresh`   | 0    | No cut record — this is an ordinary run. Proceed with the normal entry: claim the hold, ask the session boundary, read the issue, implement |
| `resume`  | 0    | A declared cut whose tree matches was verified and taken over. **Skip the title, the plan, the fresh hold claim and the implementation**; re-read the issue body and comments for the plan and the recorded decisions, then go straight to `pnpm josh gate` |
| `stale`   | 1    | The record does not match the tree — wrong branch, a clean tree (the implementation is gone), an expired record, or no declared cut. **A resume failure**: send a `confirmation` Telegram and stop; never gate the wrong tree |
| `busy`    | 1    | Another process already owns the resume — a double launch. Send a `confirmation` Telegram and stop                                        |

**A resume is never reported as a success it did not earn.** `stale` and `busy` stop the run rather
than gating, so a cut that lost its work, or one two processes reached at once, is caught rather than
merged.

## What is carried, and what is not

- **The working tree is not in the record, because it never left the disk.** Ending the process does
  not touch the lane directory: the branch and the uncommitted implementation are still there when
  the fresh process starts in the same directory. The record carries only what a fresh process cannot
  recover on its own — the issue, the branch, the invocation, and that a **declared cut** put it here.
- **The conversation is not carried.** joshuafolkken/kit#1567 found a compaction does not reduce
  billing, so nothing is served by persisting the conversation; the fresh process reads the plan and
  the recorded auto-decisions back off GitHub, which is where the workflow already writes them.
- **The hold is kept, not released.** The uncommitted work is exactly what a second run would
  trample, so the cut leaves the `run:hold` record standing; the resumed process adopts it rather than
  claiming a fresh one, and `pnpm josh followup` releases it at the merge as it always has.

## Verification, uniqueness and double-launch

- **The resume verifies the tree against the record**: the branch matches, the tree is dirty (the
  implementation is present), the issue matches, and the tree is still under the hold the cutting run
  held. Any mismatch is `stale`.
- **No owner is recorded on the cut.** A cut relaunches exactly one fresh process, so there is no live
  session a resume must be blocked against; recording the cutting session's pid would only stall the
  resume against a process on its way out. Uniqueness rests on the hand-off and the exclusive create
  below instead.
- **The cut is exclusive.** `run:cut` writes the record with an exclusive create, so a second cut on
  the same tree is refused `busy` and never relaunches a second process.
- **The resume is unique.** Taking the hand-off over spends it — a second `run:cut --resume` reads a
  record whose hand-off is already spent and is answered `stale` — and the take-over itself is an
  exclusive create, so two resumes racing cannot both win.

## Consistency with the chain rule

`chain-rule.md` and `SKILL.md` → §2h forbid ending a turn at the push, because there the review and
the commit are behind you and CI is in flight with nothing set to resume. **The pre-gate cut is the
opposite case and a sanctioned boundary**: it ends the turn *before* the gate, and it relaunches a
fresh process in the same act, so the run continues rather than stalling. The resumed process then
runs gate → review → commit → push → merge **without ending** — so the chain rule's "the turn never
ends at the push" holds for it exactly as for an uncut run. The cut adds one earlier turn boundary; it
removes none of the later prohibitions.

## Measurement

The mechanism is what makes the per-call context drop possible; the drop itself is measured on a real
dispatched lane run with `pnpm josh cost` and `pnpm josh time`, comparing the average context per
request before and after. **Until that run is measured it is reported as unmeasured** — the bytes a
record holds, the cache a session keeps and the billed cost are distinct, and only a measured run
tells whether the average fell.

This file is the single source of the rule.
