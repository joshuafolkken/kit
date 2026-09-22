# The pre-gate cut — a lane child ends its turn before the gate

A lane child is a detached `fullrun #<N>` process, and the thinking it accumulates while implementing
rides on every later API call in the same session (measured at **176K of 204K output tokens** on
joshuafolkken/kit#1837). The **pre-gate cut** drops that accumulation: the child ends its process the
moment implementation is done, and a **fresh** process resumes the same lane from the gate onward.

This file is the single source of the boundary. `run:cut` takes it, and `run:cut --resume` is the
check a fresh process makes at its own entry. The rule is reached only **during** a lane child's run,
after the workflow skill has been read, so it is not an entry read — `fullrun.md`, `chain-rule.md` and
`backlogrun.md` name it with a plain mention and route here. **A second boundary is added below** — the
implementation-phase cut (joshuafolkken/kit#1933), at a context threshold _during_ implementation.
Everything through "What is carried" describes the pre-gate cut; the later section states only what
differs.

## Where the boundary is

**After implementation and the refactor, before `pnpm josh gate`** — the same boundary
joshuafolkken/kit#1837 puts the `origin/main` merge at: implementation complete, nothing committed,
the gate not started. Everything before it produced the thinking to be dropped; everything after it
(gate → review → commit → push → merge) is verification the fresh process runs on the tree.

## It applies to a dispatched lane child, and to nothing else

The cut is for a **detached** `fullrun` a lane dispatched. A person's interactive `fullrun` must not
relaunch itself, so a dispatched child is told apart **mechanically, by a mark the dispatch sets** —
never by the model reading the shape of its own prompt (joshuafolkken/kit#1904).

### The dispatch mark

`lane:dispatch` starts each child generation with the environment variable **`JOSH_LANE_CHILD`** set
to the lane's issue number. `scripts/lane/lane-child-marker.ts` is its one definition.

- **Meaning**: "this session was launched for issue `<N>`, not typed by a person."
- **Lifetime**: the child process — set at launch, read at the gate, never written by the run itself (a
  mark a run could set for itself would be no mark at all).
- **Trust**: only where its value equals the lane's own issue. A mark that leaked in from a parent
  session — naming another issue, or none — is read as a person, so a leak cannot make the guard fire
  on a checkout it does not belong to.

The name, meaning and lifetime are documented here and nowhere else.

`run:cut` decides the same fact its own way: it looks for an **open lane** for the issue, answering a
checkout with none `not-a-lane`. So the command is safe to issue unconditionally — a no-op in the main
checkout, a cut in a lane.

## Taking the cut

**The order is fixed in the chain, not left to the refusal to enforce** (joshuafolkken/kit#2177).
`chain-rule.md` step 1 issues `pnpm josh run:cut <N>` after `pnpm josh main:merge`, before the scoped
pair and the gate, so the default path takes the cut before anything reads the tree — removing the
wasted round trip joshuafolkken/kit#2160 measured (an uncut gate refused, its batched `review:brief`
cancelled, then cut and resume). **The command is still issued unconditionally**; `run:cut` itself
decides whether the cut is warranted (joshuafolkken/kit#2312), so a short lane with nothing to drop is
answered `under-threshold` and walks on to the gate rather than relaunching.

At the pre-gate boundary, issue:

```bash
pnpm josh run:cut <N>          # alias: josh rct
```

- `cut` (0) — record written and handed to the lane's launch owner (OpenAI supervisor starts the
  successor after this process exits; Anthropic relaunches directly). **End the turn immediately** —
  the fresh process owns the run.
- `under-threshold` (0) — the recent-window per-request cost is under the shared `CONTEXT_CUT_THRESHOLD`
  (joshuafolkken/kit#2312), so the accumulation a cut would drop is not worth a resume's cost. Nothing
  was cut; **continue to the gate.**
- `not-a-lane` (0) — no open lane for this issue, so not a dispatched child. **Continue to the gate.**
- `unready` (1) — the tree is clean or on the default branch, nothing to carry. Continue to the gate.
- `busy` (1) — a cut is already in flight for this tree (the double-cut guard). Do not relaunch.
- `failed` (1) — no live OpenAI supervisor, or the Anthropic relaunch could not start. Continue.
- `unknown` (1) — the git directory could not be read. Continue to the gate.

**`cut` is the only verdict that ends the turn.** Every other one — `under-threshold` included — leaves
the current process to carry the run on itself.

### The gate refuses until the cut has been taken (joshuafolkken/kit#1864)

**This step was carried as prose and fired exactly never.** joshuafolkken/kit#1850 measured six lane
children and the cut was taken **0 times**: four issued the *entry* check
`pnpm josh run:cut --resume <N>` and were answered `fresh`, not one issued the call above. A step a run
is free to skip is the step skipped under time pressure — so `pnpm josh rule:guard` **refuses
`pnpm josh gate`** while this checkout is a lane and no cut record is carried, handing back the command
above. With the ordered step above (joshuafolkken/kit#2177) the refusal is insurance, not the primary
trigger.

- **It fires for a marked child and nowhere else** (joshuafolkken/kit#1904). The `PreToolUse` hook
  reads two facts: the working directory is a lane — `<lane root>/<issue number>` — **and**
  `JOSH_LANE_CHILD` names that same issue. An interactive `fullrun` carries no mark and runs its gate
  untouched. `run:cut` draws its own line its own way — an open-lane lookup — which is why the guard and
  the command need not agree byte for byte; the mark makes the guard's half mechanical.
- **It fires only when the recent-window context warrants a cut** (joshuafolkken/kit#2312). The guard
  reads the same `cost_cli.session_verdict` `run:cut` reads, so an `under`-threshold lane is let through
  to the gate rather than refused — the guard and the command never disagree about whether a cut was
  due. The context read is lazy, after the command and lane checks, so an ordinary run pays nothing for
  it.
- **It is silent once the cut is carried**, so the resumed process goes straight to the gate.
- **It fires once per run.** Five of the six verdicts leave this process holding the run, each needing
  the reissued gate call to pass — a refusal that repeated would wedge exactly the runs that obeyed.
- **`--resume`, `--end` and `--json` do not count as taking the cut**, because they ask about one
  rather than take it — counting them would have credited four of the six measured children.

The row, its trigger and the enumeration it joins are
`prompts/collaboration-workflow/rule-delivery.md`; `scripts/rules/pre-gate-cut.test.ts` pins it.

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
- `resume-impl` (0) — like `resume`, but the cut was taken **during** implementation
  (joshuafolkken/kit#1933). Skip the title, the plan, the fresh hold claim and the split assessment,
  re-read the plan, then **continue implementation** — do **not** go straight to the gate.
- `handed-off` (0) — a successor has already adopted this cut, `is_handed_off` is spent
  (joshuafolkken/kit#1935). This process was woken **after** its own cut. **End the turn quietly and do
  nothing**: a benign stop, no Telegram owed.
- `stale` (1) — the record does not match the tree (wrong branch, a clean tree, an expired record, or
  an unknown hand-off state). **A resume failure**: send a `confirmation` Telegram and stop; never gate
  the wrong tree.
- `busy` (1) — another process already owns the resume. Send a `confirmation` Telegram and stop.

**A resume is never reported as a success it did not earn.** `stale` and `busy` stop the run rather
than gating, so a cut that lost its work, or one two processes reached at once, is caught.

### The stage is passed to the resumed child, not reconstructed by it

(joshuafolkken/kit#1904) A resumed child arrives with `JOSH_LANE_CHILD` still set and `run:cut
--resume` reads the record the cut left, so it learns *where to resume from* at its entry. **Skip the
entry it has already done**: do not re-read the workflow skill, repeat the split assessment or
re-normalize the title; the plan and decisions are read back from the issue. This removes the
reconstruction a stopped child used to redo on every resume (2.6 minutes / ~150K tokens on
joshuafolkken/kit#1876).

## What is carried, and what is not

- **The working tree is not in the record, because it never left the disk.** The record carries only
  what a fresh process cannot recover — the issue, the branch, the invocation, and that a **declared
  cut** put it here.
- **The conversation is not carried** (joshuafolkken/kit#1567 found compaction does not reduce
  billing); the fresh process reads the plan and auto-decisions back off GitHub.
- **The hold is kept, not released** — the uncommitted work is what a second run would trample, so the
  resumed process adopts the `run:hold` record and `pnpm josh followup` releases it at the merge.
- **The dispatch mark is re-applied, not inherited** (joshuafolkken/kit#1904): the relaunch strips the
  parent's environment and sets `JOSH_LANE_CHILD` afresh from the lane's issue.

## Verification, uniqueness and double-launch

- **The resume verifies the tree against the record**: the branch matches, the tree is dirty, the
  issue matches, and the tree is still under the cutting run's hold. Any mismatch is `stale`.
- **No owner is recorded on the cut.** OpenAI keeps a separate per-worktree supervisor owner record and
  generation state; the cut is the stage hand-off alone.
- **The cut is exclusive** — `run:cut` writes the record with an exclusive create, so a second cut on
  the same tree is refused `busy`.
- **The resume is unique.** Taking the hand-off over spends it — a second `run:cut --resume` reads a
  spent record and is answered `handed-off` (joshuafolkken/kit#1935), and the take-over is itself an
  exclusive create, so two resumes racing cannot both win. One lane crosses the pre-gate boundary
  exactly once.

## The implementation-phase cut — a lane child cuts before the gate too

**The pre-gate cut drops the thinking accumulated _before_ the gate; it does nothing about the thinking
accumulated _during_ implementation** (joshuafolkken/kit#1933). A lane child re-reads its whole
conversation on every request, so a long implementation is billed like a long `backlogrun` parent (the
2026-09-13 `backlogrun` measured **208k–386k** median context per request), and the pre-gate boundary
fires only once implementation is done. The **implementation-phase cut** caps that growth — the child
ends its process mid-implementation and a fresh one resumes the same lane **back into implementation**.

### The measurement is the parent hand-off's, never a second one

The guard below decides whether to refuse with the same measurement the parent uses between children —
`cost_verdict.per_request_cost`, read through `cost_cli.session_verdict` (the read-only form of
`pnpm josh cost --cut`, the verdict the conditional pre-gate cut reads too, joshuafolkken/kit#2312),
whose single source is `backlogrun-progress.md` → "The hand-off". The parent's seam and the child's
`run_cut.IMPLEMENTATION_CONTEXT_THRESHOLD` both use the shared **200_000** constant
(`CONTEXT_CUT_THRESHOLD`, aliased so the procedure, scheduler and worker tests cannot drift). No
separate measurement or threshold is built for the lane child.

### It is a guard, fired at the edit that crosses the threshold (joshuafolkken/kit#2310)

**This step was carried as prose and fired exactly never** — the fate the pre-gate cut met before
joshuafolkken/kit#1864. joshuafolkken/kit#1933 reasoned it *could not* be a guard, because the
per-request cost was read **asynchronously**; but `cost_cli.session_verdict` is synchronous and is the
exact verdict `pnpm josh cost --cut` prints — the same statistic against the same `CONTEXT_CUT_THRESHOLD`,
no second measurement. joshuafolkken/kit#2310 measured the cost of leaving the check to the child:
across five lanes (#2304 #2294 #2297 #2296 #2298) the verdict was read once each at session entry, where
the context has not yet grown, so the cut fired **0 times** while 33.9% of their requests ran past
200,000 tokens.

So `pnpm josh rule:guard` **refuses an `Edit` / `Write`** while this checkout is a dispatched lane child
whose recent-context cost is over threshold, handing back `pnpm josh run:cut --impl <N>` — a
`PreToolUse` refusal lands *before* the edit does, so the tree is at the consistent state the previous
edit left it, never mid-edit. Issue it: `cut` ends the turn, the rest leave this process implementing;
a fresh process's `pnpm josh run:cut --resume <N>` then answers **`resume-impl`**, so it **skips the
title, plan, hold claim and split assessment** and **continues implementation** rather than gating. The
exclusive create and spent hand-off (joshuafolkken/kit#1935) hold here too, so a lane may cross the
boundary several times, each with exactly one successor.

- **It fires for a marked child and nowhere else** — the dispatch mark against this lane's own issue,
  as the pre-gate cut reads it, so a person editing in a lane sees no refusal.
- **It fires once per run** — after the cut the fresh transcript reads under threshold, so the row
  re-arms per resume, not per edit; the verdicts that leave this process implementing each need the
  reissued edit to go through, so refusing every time would wedge them.
- **It is silent between a cut and its resume** — a carried record naming this issue keeps it quiet.

`scripts/rules/implementation-cut.ts` implements the trigger, `scripts/rules/implementation-cut.test.ts`
pins it, and the row joins `prompts/collaboration-workflow/rule-delivery.md`. **A child that ended
without cutting is still detected after the fact by `pnpm josh run:ending <N> --output <path>`**
(joshuafolkken/kit#2139). **A single check (`lint:related` / `test:related`) is run after a batch of
edits, not after each one** — every check is a request too (joshuafolkken/kit#1383).

## The threshold, and the statistic it is measured against

**The 200_000 `CONTEXT_CUT_THRESHOLD` is unchanged; what joshuafolkken/kit#2295 changed is the
statistic — `cost_verdict.per_request_cost` now averages the most recent `RECENT_REQUEST_WINDOW` (10)
requests rather than the whole session.** The measurement is still *one* both read; only its definition
changed. This supersedes joshuafolkken/kit#2282, which had kept the whole-session average and rejected
this recent-context option on the batch it measured — short-lived lane children that never contained a
parent session (joshuafolkken/kit#2295), for which the two averages nearly coincide.

- **The safety net now fires.** The implementation-phase cut was built (joshuafolkken/kit#1933) for a
  pathological regime a typical lane never enters, and 200_000 sits below the 208k floor of that regime,
  so a genuinely runaway implementation still trips it — and joshuafolkken/kit#2310 made the guard trip
  it actively at the edit that crosses the threshold, closing the "it never fired" gap the net had been
  waiting on.
- **The recent window catches the long parent the whole-session average missed.** The 2026-09-21
  parent session `567f8eac` (186 requests, 7 hours) first crossed 200k at request 65, but its
  whole-session average did not cross until request 150 — **85 requests (~4 hours) later**, ~$7.88
  keeping an oversized parent supervising past the point a cut was due. The recent-10 average removes
  that lag.
- **It is not the forbidden second measurement.** joshuafolkken/kit#1933 forbids the child pricing its
  cut on a statistic the parent does not share; #2295 keeps one statistic both read and redefines it.
  On a short session the recent-10 average tracks the whole-session average, so a lane child cuts where
  it always did; only the long parent hands off earlier.

### The cut is conditional, and the resume side is why (joshuafolkken/kit#2312)

**Until joshuafolkken/kit#2312 the pre-gate cut was _unconditional_, and the case for it recorded only
the gain** — the context reduction it carries single-handed (~130k → ~60k per request). **The resume
side was never priced.** A cut relaunches a fresh process that re-reads the plan and the recorded
decisions off GitHub before the gate — a fixed re-launch ramp of ~12 requests per session. That ramp was
**$81.01 of $435.09 (19%)** across the 32 lanes of 2026-09-21, falling hardest on the short lanes with
the least to drop: #2282 spent **58%** of its billing on it at a 60k median context, #2295 **39%** at
74k, #2289 **37%** at 81k — each with **0%** of its requests over 200k, billed for a resume against an
accumulation that was never there.

**So the cut is now taken only when the recent-window per-request cost is over `CONTEXT_CUT_THRESHOLD`**
— the same statistic and threshold the implementation-phase cut reads, so **no second threshold is
introduced**. Below it `run:cut` answers `under-threshold` and the gate runs uncut; the guard reads the
same verdict and stays silent, so the two never disagree. A lane like #2298 (31% of requests over 200k)
still cuts exactly as before, keeping the ~130k → ~60k gain where the accumulation is real, and an
**unmeasurable** session keeps the old unconditional cut so a lane whose context cannot be read is never
left uncut.

## Consistency with the chain rule

`chain-rule.md` and `background-commands.md` forbid ending a turn at the push, where the review and
commit are behind you and CI is in flight with nothing set to resume. **The pre-gate cut is the
opposite case and a sanctioned boundary**: it ends the turn *before* the gate and relaunches a fresh
process in the same act, so the run continues rather than stalling — and the resumed process runs gate
→ review → commit → push → merge **without ending**, so "the turn never ends at the push" holds for it.
The implementation-phase cut is the same pattern one boundary earlier still (joshuafolkken/kit#1933):
it adds turn boundaries and removes no prohibition.

## A lane child records its park before it stops

**A dispatched lane child records its park on the Issue before it stops for a decision**
(joshuafolkken/kit#2034). A headless child's only route to ask a person anything is to park the Issue —
`needs-decision` and a comment carrying the question. Measured twice on 2026-09-14: **#2012**'s child
had its `AskUserQuestion` refused and **#2011** wrote a Tier B decision, both to their final message,
and neither left a label or comment — so the parent found an OPEN Issue with `in-progress` and no
question. The child is the only process that knows the question, so it records the park itself rather
than leaving the parent to reconstruct it from a log.

**The record, before the Telegram, is the park procedure exactly** — `needs-decision` plus a comment
carrying the question, the options, and whether work was stashed. Its single source is
`backlogrun-park.md` → "park and continue", followed against the child's own Issue before the
`confirmation` notify; with the label on the Issue, the parent's `pnpm josh run:liveness` reads the
child as `settled`.

**A `needs-human-review` or `already-done` stop needs nothing added** — those labels are already on the
Issue. It is only a decision-stop (a Tier B toss-up, a Tier C action, an upstream defect, a split) that
would otherwise leave the Issue bare.

### The stop notify refuses until the park is recorded

**This was prose that would have fired never**: a step a child is free to skip under time pressure is
the step it skips. So `pnpm josh rule:guard` **refuses `pnpm josh notify --task-type confirmation`**
while this checkout is a lane child — the mark `JOSH_LANE_CHILD` names this lane's own issue — handing
back the park commands.

- **It fires for a marked child and nowhere else.** A person's own `fullrun` carries no mark and sends
  its stop notify untouched.
- **It fires once per run.** The child records the park and reissues the same notify; a
  `needs-human-review` or `already-done` stop reissues after the one delivery, since its label is
  already on the Issue.
- **The park state is not readable synchronously.** A `PreToolUse` guard makes no network call and the
  park is a GitHub label, so the delivery is a checklist rather than an accusation — one wasted reissue
  on the compliant path is safe.

This section is the single source of the lane-child park rule; `scripts/rules/lane-park.ts` implements
the trigger, `scripts/rules/lane-park.test.ts` pins it, and the row joins the enumeration in
`prompts/collaboration-workflow/rule-delivery.md`.

### The interactive ask is refused one call earlier

**The stop-notify guard fired one tool-call too late** (joshuafolkken/kit#2201). A child that reaches
for `AskUserQuestion` never reaches the notify: the harness refuses an interactive ask in a headless
session by **ending the turn**, so the notify guard never fires and the question dies in the exit
record's `permission_denials`. Measured on 2026-09-20 inside `backlogrun #2163 --only`: **#2178**'s
child hit a Tier B branch, called `AskUserQuestion`, was refused, and left an OPEN Issue with
`in-progress` and no question — the failure joshuafolkken/kit#2034 set out to prevent, one call
upstream.

So `pnpm josh rule:guard` **refuses `AskUserQuestion` for a marked lane child**, one call before the
stop it would have reached. A hook deny returns to the model rather than ending the turn, so the
refusal becomes an instruction — park the question. It fires on **every occurrence** and stays silent
for a person working in a lane.

**A child that slips past it is still recoverable** — `pnpm josh run:ending` lifts the refused ask out
of the exit record's `permission_denials` into the `abandoned` verdict's park basis, so the parent puts
it into the park comment. `scripts/rules/lane-interactive-ask.ts` implements the trigger,
`scripts/rules/lane-interactive-ask.test.ts` pins it, and `scripts/agent/interactive-ask.ts` is the
shared extractor the guard and `run:ending` both read.

This file is the single source of the rule.
