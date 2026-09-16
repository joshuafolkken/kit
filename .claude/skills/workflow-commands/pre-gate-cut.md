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
`fullrun.md`, `chain-rule.md` and `backlogrun.md` name it with a plain mention and route here.

**A second boundary is added below** — the implementation-phase cut (joshuafolkken/kit#1933), which
takes the same `run:cut` record and relaunch at a context threshold _during_ implementation.
Everything through "What is carried" describes the pre-gate cut; the implementation-phase section
states only what differs.

## Where the boundary is

**After implementation and the refactor, before `pnpm josh gate`.** It is the same boundary
joshuafolkken/kit#1837 puts the `origin/main` merge at: implementation is complete, nothing is
committed, and the gate has not started. Everything before it (reading the issue, the plan, the
implementation) is what produced the thinking to be dropped; everything after it (gate → review →
commit → push → merge) is verification the fresh process runs on the tree the cut left behind.

## It applies to a dispatched lane child, and to nothing else

The cut is for a **detached** `fullrun` a lane dispatched — a process whose turn end is its process
end. A person's interactive `fullrun` is driven by that person and must not relaunch itself, so a
dispatched child is told apart from a person **mechanically, by a mark the dispatch sets** — never by
the model reading the shape of its own prompt (joshuafolkken/kit#1904).

### The dispatch mark

`lane:dispatch` starts each child generation with the environment variable
**`JOSH_LANE_CHILD`** set to the lane's issue number. `scripts/lane/lane-child-marker.ts` is its one
definition.

- **Meaning**: "this session was launched for issue `<N>`, not typed by a person."
- **Lifetime**: the child process. It is set at launch, read at the gate, and never written by the run
  itself — a mark a run could set for itself would be no mark at all.
- **Trust**: only where its value equals the lane's own issue. A mark that leaked in from a parent
  session — naming another issue, or none — is read as a person, so a leak cannot make the guard fire
  on a checkout it does not belong to.

The name, the meaning and the lifetime are documented here and nowhere else.

`run:cut`, the command that takes the cut, decides the same fact its own way: it looks for an **open
lane** for the issue, and a checkout with none is answered `not-a-lane` and changes nothing. So the
command is safe to issue unconditionally at the boundary — in the main checkout it is a no-op, and in
a lane it cuts.

## Taking the cut

At the pre-gate boundary, issue:

```bash
pnpm josh run:cut <N>          # alias: josh rct
```

| Verdict      | Exit | What it means, and what to do                                                                                                   |
| ------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------- |
| `cut`        | 0    | The record was written and handed to the lane's launch owner: the OpenAI supervisor starts the successor after this process exits; Anthropic relaunches directly. **End the turn immediately** — do not continue to the gate; the fresh process owns the run from here |
| `not-a-lane` | 0    | No open lane for this issue, so this is not a dispatched child. **Continue to the gate in this process** as an uncut run does    |
| `unready`    | 1    | The tree is clean or on the default branch, so there is nothing to carry. Continue to the gate in this process                  |
| `busy`       | 1    | A cut is already in flight for this tree — the double-cut guard. Do not relaunch a second one                                    |
| `failed`     | 1    | No matching OpenAI supervisor was live, or the Anthropic relaunch could not start. No OpenAI cut was created; an Anthropic relaunch failure clears its cut. Continue to the gate in this process |
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

- **It fires for a marked child and nowhere else** (joshuafolkken/kit#1904). The `PreToolUse` hook
  answers synchronously, so it reads two facts off the world: the working directory is a lane —
  `<lane root>/<issue number>` — **and** `JOSH_LANE_CHILD` names that same issue. An interactive
  `fullrun`, in the main checkout or inside a lane a person is working in, carries no mark and runs its
  gate untouched — so a person is **no longer on the firing side**, and the wasted round trip the old
  path-only test cost them is gone. `run:cut` draws its own line its own way — an open-lane lookup —
  which is why the guard and the command need not agree byte for byte; the mark is what makes the
  guard's half mechanical rather than a judgement left to the model.
- **It is silent once the cut is carried**, so the resumed process goes straight to the gate as this
  file says it should. `adopt_cut` leaves the record in place, and that record is what says the cut
  already happened.
- **It fires once per run.** Five of the six verdicts above leave this process holding the run, and
  each of them needs the reissued gate call to pass — a refusal that repeated would wedge exactly the
  runs that obeyed.
- **`--resume`, `--end` and `--json` do not count as taking the cut**, because they ask about one
  rather than take it. Counting them would have credited four of the six measured children.
- **The denominator `rule:value` scores the row over asks two things, not one**
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
| `resume-impl` | 0 | Like `resume`, but the cut was taken **during** implementation (joshuafolkken/kit#1933). Skip the title, the plan, the fresh hold claim and the split assessment; re-read the plan and the recorded decisions, then **continue implementation** — implementation is not finished, so do **not** go straight to the gate |
| `handed-off` | 0 | A successor has already adopted this cut — `is_handed_off` is spent (joshuafolkken/kit#1935). This process was woken **after** its own cut — a background task's notification, or an interactive session that never ended — and the run is being carried on elsewhere. **End the turn quietly and do nothing**: it is a benign stop, not a failure, so no Telegram is owed and the tree is left for the successor that owns it |
| `stale`   | 1    | The record does not match the tree — wrong branch, a clean tree (the implementation is gone), an expired record, or a record whose hand-off state is unknown. **A resume failure**: send a `confirmation` Telegram and stop; never gate the wrong tree |
| `busy`    | 1    | Another process already owns the resume — a double launch. Send a `confirmation` Telegram and stop                                        |

**A resume is never reported as a success it did not earn.** `stale` and `busy` stop the run rather
than gating, so a cut that lost its work, or one two processes reached at once, is caught rather than
merged.

### The stage is passed to the resumed child

**It is not reconstructed by it** (joshuafolkken/kit#1904). A resumed child arrives with
`JOSH_LANE_CHILD` still set — the relaunch re-applies it — and `run:cut --resume` reads the record the
cut left, so the child learns *where to resume from* at its entry. **Skip the entry it has already
done**: do not re-read the workflow skill to work out its own situation, do not repeat the split
assessment, and do not re-normalize the title. The `resume` verdict is the stage, and the plan and the
recorded decisions are read back from the issue. This is the reconstruction a stopped child used to
redo on every resume — measured at 2.6 minutes and about 150K tokens on the joshuafolkken/kit#1876
run — removed.

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
- **The dispatch mark is re-applied, not inherited** (joshuafolkken/kit#1904). The relaunch strips the
  parent session's environment on the way in, so it sets `JOSH_LANE_CHILD` afresh from the lane's
  issue; the resumed child is a dispatched child to the pre-gate cut exactly as the first one was.

## Verification, uniqueness and double-launch

- **The resume verifies the tree against the record**: the branch matches, the tree is dirty (the
  implementation is present), the issue matches, and the tree is still under the hold the cutting run
  held. Any mismatch is `stale`.
- **No owner is recorded on the cut.** OpenAI keeps a separate immutable, per-worktree supervisor
  owner record and mutable generation state; the cut remains the stage hand-off alone. A dead owner
  can be replaced without starting beside its still-live child, and a standing hand-off is resumed
  before an ordinary initial generation.
- **The cut is exclusive.** `run:cut` writes the record with an exclusive create, so a second cut on
  the same tree is refused `busy` and never relaunches a second process.
- **The resume is unique.** Taking the hand-off over spends it — a second `run:cut --resume` reads a
  record whose hand-off is already spent and is answered `handed-off` (joshuafolkken/kit#1935), a
  benign stop that tells a process woken after its own cut to do nothing rather than investigate — and
  the take-over itself is an exclusive create, so two resumes racing cannot both win. A resumed
  process that reaches the boundary again and reissues `run:cut <N>` is likewise refused `busy` by that
  exclusive create, so one lane crosses the pre-gate boundary exactly once.

## The implementation-phase cut — a lane child cuts before the gate too

**The pre-gate cut drops the thinking accumulated _before_ the gate; it does nothing about the
thinking accumulated _during_ implementation** (joshuafolkken/kit#1933). A lane child re-reads its
whole conversation on every request, so a long implementation is billed the way a long `backlogrun`
parent is: the 2026-09-13 `backlogrun` measured lane bodies at **208k / 240k / 283k / 386k** median
context per request, the second half of a run costing about twice the first. The pre-gate boundary
fires only once implementation is done, so it never caps that growth. The **implementation-phase
cut** does — the child ends its process mid-implementation, at a consistent boundary, and a fresh one
resumes the same lane **back into implementation** carrying none of the thinking.

### The measurement is the parent hand-off's, never a second one

The child decides whether to cut with the same measurement the parent uses between children —
`pnpm josh cost --over <threshold>` (`cost_verdict.per_request_cost`, billed input tokens per
request), whose single source is `backlogrun-progress.md` → "The hand-off". **Only the threshold differs**: the
parent's seam is 300_000, the child's is `run_cut.IMPLEMENTATION_CONTEXT_THRESHOLD` — **200_000
initially**. No separate measurement is built for the lane child.

```bash
pnpm josh cost --over 200000     # over → cut ; under → keep implementing
```

**200_000 is the initial value, and its derivation is recorded here.** The lane bodies above ran at
208k–386k while implementing, and joshuafolkken/kit#1837's cap simulation put a 200k per-request cap
at 71% of the final 427k (300k at 89%) — so cutting at 200k during implementation caps an
accumulation the pre-gate boundary alone left uncapped. The value is a single constant,
`run_cut.IMPLEMENTATION_CONTEXT_THRESHOLD`, so this figure and the test cannot drift.

### Where the boundary is

**At a consistent working-tree boundary, never mid-edit.** The cut leaves the uncommitted
implementation on disk for the fresh process to verify against, so it may be taken only where the
tree is coherent — the natural one is **right after a single check (`lint:related` / `test:related`)
has gone green**, between edit batches. A cut taken in the middle of an `Edit` sequence would hand
the fresh process a half-written tree, which the resume verification would reject.

### Taking it

At such a boundary, when `pnpm josh cost --over 200000` answers `over`, issue:

```bash
pnpm josh run:cut --impl <N>
```

The verdicts are the pre-gate cut's exactly — `cut` ends the turn (the fresh process owns the run
from here), and `not-a-lane`, `unready`, `busy`, `failed` and `unknown` each leave this process to
carry on implementing. The only thing that differs is what the record stores: the implementation
phase, which the resume reads.

### Resuming continues implementation

A fresh process's `pnpm josh run:cut --resume <N>` answers **`resume-impl`** for an
implementation-phase cut rather than `resume`. **Skip the title, the plan, the fresh hold claim and
the split assessment** — the entry a resumed child has already done — re-read the issue body and
comments for the plan and the recorded decisions, and **continue implementation**; do not go to the
gate, because implementation is not finished. Everything else — the tree verification, the kept hold,
the re-applied dispatch mark, and the `stale` / `busy` / `handed-off` failures — is the pre-gate
resume's, unchanged.

### One cut per boundary, one successor across all of them

The exclusive create and the spent hand-off (joshuafolkken/kit#1935) hold across the
implementation-phase cut exactly as across the pre-gate one: a second cut on the same tree is refused
`busy`, and a second resume of the same cut is answered `handed-off`. A lane may cross the
implementation boundary several times over a long implementation — each crossing dropping the
thinking — and each one has exactly one successor.

### It is procedure, not a guard — and why

The pre-gate cut is enforced by a `PreToolUse` refusal because it fires unconditionally at one place.
The implementation cut cannot be: its trigger is the per-request cost, and that is read from the
transcript **asynchronously** (`cost --over` loads the corpus), while a `PreToolUse` guard answers
synchronously or not at all — and a synchronous approximation would be the very "separate measurement
for the lane child" joshuafolkken/kit#1933 forbids. So the child runs `pnpm josh cost --over 200000`
at each boundary itself, and whether the run held to it is read from the run-timing report and
`pnpm josh cost` on a real dispatched run (see "Measurement" below) — the same feedback loop the
pre-gate cut's own measurement uses.

### Edit in bulk, then check once

**A single check (`lint:related` / `test:related`) is run after a batch of edits, not after each
one.** Every check is a boundary this cut can be taken at, but it is also a request, and running one
after every small edit grows the context this cut exists to bound. This is consistent with
joshuafolkken/kit#1383 — a single check answers once per tree — and observable in the run-timing report's
`Single checks:` block, whose repeat and unchanged-call counts rise when checks outnumber edit
batches.

## Consistency with the chain rule

`chain-rule.md` and `background-commands.md` forbid ending a turn at the push, because there the review and
the commit are behind you and CI is in flight with nothing set to resume. **The pre-gate cut is the
opposite case and a sanctioned boundary**: it ends the turn *before* the gate, and it relaunches a
fresh process in the same act, so the run continues rather than stalling. The resumed process then
runs gate → review → commit → push → merge **without ending** — so the chain rule's "the turn never
ends at the push" holds for it exactly as for an uncut run. The cut adds one earlier turn boundary; it
removes none of the later prohibitions.

**The implementation-phase cut is the same sanctioned pattern, one boundary earlier still**
(joshuafolkken/kit#1933). It ends the turn _during_ implementation and relaunches a fresh process in
the same act, so the run continues rather than stalling — and the resumed process implements on to
the gate, review, commit, push and merge without ending. It adds turn boundaries and removes no
prohibition.

## Measurement

The mechanism is what makes the per-call context drop possible; the drop itself is measured on a real
dispatched lane run with `pnpm josh cost` and the run-timing report, comparing the average context per
request before and after. **Until that run is measured it is reported as unmeasured** — the bytes a
record holds, the cache a session keeps and the billed cost are distinct, and only a measured run
tells whether the average fell.

**The implementation-phase cut's drop is measured the same way, and is likewise unmeasured until
then** (joshuafolkken/kit#1933): one changed `backlogrun` compares the average and maximum context
per request of each lane against the 2026-09-13 run recorded in the issue, and until that run exists
the effect of the 200_000 threshold is reported as unmeasured.

## A lane child records its park before it stops

**A dispatched lane child records its park on the Issue before it stops for a decision**
(joshuafolkken/kit#2034). A `backlogrun` runs each child as a detached `fullrun #<N>`, and a headless
child's only route to ask a person anything is to park the Issue — `needs-decision` and a comment
carrying the question. Measured twice in one run on 2026-09-14: **#2012**'s child had its
`AskUserQuestion` refused (it is headless), wrote the question into its final message, sent a
`confirmation` Telegram and exited; **#2011** wrote a Tier B decision to its final message and exited
the same way. Neither left a label or a comment, so the parent found an OPEN Issue with `in-progress`
and no question, and a person looking at it could not tell what to answer. The child is the only
process that knows the question, the options and whether it stashed, so it records the park itself
rather than leaving the parent to reconstruct it from a log.

**The record, before the Telegram, is the park procedure exactly** — `needs-decision` plus a comment
carrying the question, the options, and whether work was stashed. The procedure is not restated here:
its single source is `backlogrun-park.md` → "park and continue", and the child follows it against its
own Issue before sending the `confirmation` notify. With the label on the Issue, the parent's
`pnpm josh run:liveness` reads the child as `settled` and treats it as parked from GitHub state alone —
no change to the parent, and no `run:liveness` guess from the child's last log line.

**A `needs-human-review` or `already-done` stop needs nothing added.** Those labels are already on the
Issue — one applied by a person, one by the child's own verified-merged exit — so the stop is already
recorded. It is only a decision-stop (a Tier B toss-up, a Tier C action, an upstream defect, a split
that needs a person) that would otherwise leave the Issue bare.

### The stop notify refuses until the park is recorded

**This was prose that would have fired never**, the same measurement this file's own gate rule rests
on: a step a child is free to skip under time pressure is the step it skips. So `pnpm josh rule:guard`
**refuses `pnpm josh notify --task-type confirmation`** while this checkout is a lane child — the
dispatch mark `JOSH_LANE_CHILD` names this lane's own issue — and hands back the park commands.

- **It fires for a marked child and nowhere else.** A person's own `fullrun`, in the main checkout or
  in a lane they are working in, carries no mark and sends its stop notify untouched.
- **It fires once per run.** The child records the park and reissues the same notify; a refusal that
  repeated would block the very stop it just asked the child to record. A `needs-human-review` or
  `already-done` stop reissues after the one delivery, since its label is already on the Issue.
- **The park state is not readable synchronously.** A `PreToolUse` guard answers without a network
  call, and the park is a GitHub label — so the guard cannot stay silent only on the non-compliant
  stop the way the pre-gate cut reads its local cut record. Scanning the transcript tail for the label
  instead would read a child that merely *read* `backlogrun-park.md`, whose prose carries the command,
  as compliant and fall silent on a real violation. So the delivery is a checklist rather than an
  accusation, and one wasted reissue on the compliant path is the safe direction.

This section is the single source of the lane-child park rule; `scripts/rules/lane-park.ts` implements
the trigger, `scripts/rules/lane-park.test.ts` pins that it fires for a marked child on a stop notify
and stays silent everywhere else, and the row joins the enumeration in
`prompts/collaboration-workflow/rule-delivery.md`.

This file is the single source of the rule.
