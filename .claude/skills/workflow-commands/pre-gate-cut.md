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
| `unknown`    | 1    | This work tree's git directory could not be read, so no record was acted on. Continue to the gate in this process |

**`cut` is the only verdict that ends the turn.** Every other one leaves the current process to carry
the run on itself, which is why a `not-a-lane` or a `failed` is not a stop.

### The gate refuses until the cut has been taken (joshuafolkken/kit#1864)

**This step was carried as prose and fired exactly never.** joshuafolkken/kit#1850 measured six lane
children — #1853, #1849, #1855, #1854, #1856 and #1847 — and the cut was taken **0 times**. Four of
the six issued the *entry* check `pnpm josh run:cut --resume <N>` and were answered `fresh`; not one
issued the call above. The document was read three to five times per run and the step stayed one
sentence in the middle of it, so joshuafolkken/kit#1839's fourth acceptance condition — the drop in
context per request — could not be judged at all.

So `pnpm josh rule:guard` **refuses `pnpm josh gate`** while this checkout is a lane and no cut record
is carried, and hands back the command above with what each verdict obliges. It is the same
conclusion joshuafolkken/kit#1344 and joshuafolkken/kit#1460 each reached after measuring prose that
moved the number not at all: a step a run is free to skip is the step that gets skipped under time
pressure, and `run:hold` — the one boundary step that never gets missed — is the one that refuses.

- **It fires in a lane and nowhere else.** An interactive `fullrun` in the main checkout runs its gate
  untouched. **The line it draws is not the same one `run:cut` draws**, and the difference matters: a
  `PreToolUse` hook answers synchronously, so the guard reads the working directory's shape —
  `<lane root>/<issue number>` — where `run:cut` asks `git worktree list` whether an **open lane**
  exists. The path test is the looser of the two, and a **person** working inside a lane checkout is
  on its firing side. That costs them one round trip rather than a wrong action: the refusal tells
  them not to take the cut — it would launch a detached run behind them — and the row is delivered
  once per run, so reissuing the gate passes.
- **It is silent once the cut is carried**, so the resumed process goes straight to the gate as this
  file says it should. `adopt_cut` leaves the record in place, and that record is what says the cut
  already happened.
- **It fires once per run.** Five of the six verdicts above leave this process holding the run, and
  each of them needs the reissued gate call to pass — a refusal that repeated would wedge exactly the
  runs that obeyed.
- **`--resume`, `--end` and `--json` do not count as taking the cut**, because they ask about one
  rather than take it. Counting them would have credited four of the six measured children.
- **The denominator `pnpm josh rule:value` scores the row over asks two things, not one**
  (joshuafolkken/kit#1867). The cut relaunches a *new session*, which the measurement reads as a run
  of its own and which issues the byte-identical entry check while having no cut left to take — so
  scored on the asking alone, ten perfectly obedient children read as ten kept out of twenty. The row
  therefore also asks whether the run claimed the working-tree hold: `fresh` sends a run on to claim
  it and `resume` tells its counterpart to skip that claim, so the claim is what marks the session on
  the near side of the boundary. Nothing about the delivery changes — this is the reading only.

The row, its trigger and the enumeration it joins are
`prompts/collaboration-workflow/rule-delivery.md`; `scripts/rules/pre-gate-cut.test.ts` pins that it
fires in a lane that has not cut and stays silent everywhere else.

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

`chain-rule.md` and `background-commands.md` forbid ending a turn at the push, because there the review and
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
