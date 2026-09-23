# A command that can take minutes is issued in the background

## Background the gate and push

- **The clean path folds the region into one backgrounded `pnpm josh ship`** (gate → `git -y` →
  foreground `followup` → `run:tail`; joshuafolkken/kit#2398). The calls below serve a due second round.
- Background `pnpm josh gate` beside the review; join it before commit.
- Issue `pnpm josh git -y` in the background; its completion resumes the run, so the turn never ends
  at the push.
- Keep `pnpm josh followup` in the foreground — nearly every following step reads its result.
- Overlap only tree-readers, and compose merge-independent tail data before `followup` (the table
  below is the full mapping); keep `josh ms`, state checks, next-child selection, lane closing and the
  session-cost check after the merge.
- A dispatched lane child's pre-gate cut is the sole turn boundary before the push (`pre-gate-cut.md`).

Use harness detachment so completion returns to the run. Foreground timeouts stay within the cap.

## How the wait ends — the task's exit, never a regex over its output

**Background it from the first, then end the turn.** A command issued with `run_in_background` set
re-invokes the run when it exits, and that completion notification is what ends the wait — on the
task's *exit*, not on a regex match and not on the harness block limit. So the moment you background
a long command there is nothing to wait *on*: end the turn, and the wake-up brings you back with the
command finished.

**Never hand-write a `while`/`until` … `sleep` loop over the output file.** The loop does not know
when the command finished: a regex that never matches waits to the block limit, and one that matches
a mid-run line exits too early — either way a full-context round trip is spent for nothing. Six lanes
lost about 45 minutes, 13% of their wall clock, to exactly this (joshuafolkken/kit#2371), and in the
worst case a lane grepped a merged PR's output file for 30 minutes after the merge had already
landed. `pnpm josh rule:guard` refuses the poll loop and hands back this route, so the guarantee is a
mechanism rather than prose to remember (`prompts/collaboration-workflow/rule-delivery.md`).

**To glance at interim output, `Read` the output file once** — the notification names its path — and
never in a sleep loop. If what you are waiting on is CI, `pnpm josh followup` waits on it for you in
the foreground; a bare `sleep` that arms a progress heartbeat is `run:progress --wait`'s job, refused
in front of a hand-armed timer by `early-heartbeat` (joshuafolkken/kit#1570). This loop is the case
that rule leaves alone by design, because a loop ends on a condition rather than a clock — and here
the condition it ends on is the wrong one.

## Decision record

This document is read at its point of use, not at the entry: it binds only after the first edit —
at the gate, the push, the CI wait and `pnpm josh followup` — so it is fetched in full, in the turn
that reaches the first backgroundable command (`pnpm josh gate`), by the run that has to obey it
(`SKILL.md` → §1, "Five documents are read at the point of use"). `SKILL.md` → §2h is the resident
pointer to it, and carries the one thing it does not: the same rule at a batch's scale.

**A run's idle time collects in its tail, and the two ways it collects there are one mistake**
(joshuafolkken/kit#1510). `fullrun #1501` ran 45m03s on about 17 minutes of work. Of the 25 minutes
nothing was running, **6m28s** was a `pnpm josh git -y` issued in the **foreground** with a
900-second tool timeout — above the harness's own 600-second cap, so the harness detached it at the
cap and nothing read the output file for six and a half minutes afterwards — and **6m06s** was bare
CI: the push landed, the turn ended, and the merge started only once the person asked whether it was
merging. Both halves handed the deciding of *when to look back* to something that was never going to
decide it.

**Issue it in the background, and never give a foreground call a timeout above the harness cap.**
The cap decides how long a foreground call waits, not the number passed to it, so a number above the
cap chooses the detached path without choosing the completion notification that should come with it.
A call issued detached from the start re-invokes the run when it exits — which is what makes the
completion *delivered* rather than something to remember to poll for.

The measured outliers were a 6m28s foreground `git -y`, 6m06s of unattended CI and a 19m26s push
transport fault. The operational section above maps those waits to background gate/push and a
foreground `followup`; `followup.md` remains its command procedure.

**A tail does follow the merge, and it is not small** (joshuafolkken/kit#1462). This section first
gave a different reason for that last bullet — that the merge ends the run, leaving no tail to
overlap — and the measurement says otherwise. The run-timing report charges to **`post-run`** exactly what runs
after the last `followup` span ends: **3.0 min, 5.9% of a 50.5-minute run**, in the lane child
`--issue 1599` (PR #1602); **2 min 31 s, 14% of 20m15s**, in the plain `fullrun #1597` (PR #1603);
**3.1 min** hand-measured in run #1441's delegated child, which is where this Issue started. **What
was wrong is the premise, not the conclusion** — `followup` stays foreground, and what changes is
*where the tail's work is done*.

**So the tail is emptied before `followup` is issued, rather than worked through after it returns.**
One question decides each step, and it is asked of the step rather than judged: **does it read the
merge result?**

- **It does — the step stays after `followup`.** `pnpm josh ms`, `pnpm josh issue:state <N>`,
  `pnpm josh epic:next`, `pnpm josh backlog:next --exclude <N>`, and `pnpm josh lane:close` /
  `pnpm josh lane:list`. Each is a verifier or is keyed to a merge that has to have happened, and
  bringing one forward would have it read a state nobody has reached yet. **De-duplicating a step is
  not removing it**: the parent reads the child's state from GitHub *because* a summary is not a
  verifier ("Each child runs in a delegated unit"), so none of these may be dropped or answered from
  memory.
- **It does not — the step is composed in the turn that issues `followup`.** The epic progress
  comment's counter *values* (children run, Issues filed, consecutive failures, the run's start time)
  are all counted inside the run, and the completion report body is already
  placed beside `pnpm josh git -y` in the table below. **Only the write follows the merge.** The
  comment exists because a compaction takes the counters at a moment nobody chooses (`backlogrun-progress.md` →
  "The counters live in the record"), so composing the values earlier moves no write and loses
  no counter.
- **`pnpm josh cost --cut` stays after the merge, and reads nothing from it.** It measures
  this session's own transcript, so the question above would bring it forward — but its answer grows
  with the session, and asking it a call early under-reads the very number the hand-off is decided
  on. It is seconds of tail against a guard on session size, so it keeps its documented seam
  (`backlogrun-progress.md` → "The check is asked at every merge").

**What runs beside a backgrounded command is the work that writes nothing to the working tree.** That
is the whole test, and it is the same one that lets the gate and the review overlap (`SKILL.md` →
§2): a step that edits makes the background command's result stale, so it is not something to overlap
with. Applied to the three waits a run actually has:

| While this runs | Do this beside it |
| --------------- | ----------------- |
| `pnpm josh gate` | a subagent running `/code-review` with the brief `pnpm josh review:brief` prints |
| `pnpm josh git -y` | Write the completion notification body to a file for `--notify-message-file`, and settle the three-way disposition of any remaining non-High finding |
| CI, after the push | The second review round where one is due, the branch-2 filing, and `pnpm josh epic:bundle <new>` (`prompts/review.md` → "Review round cap") |
| `pnpm josh followup` | Nothing — it is foreground and holds the session. **The post-merge tail is what overlaps here, and it is taken before the call rather than beside it**: compose the epic progress counters first, and leave after the merge only the steps that read its result, plus `pnpm josh cost --cut` |

**The turn never ends at the push.** The completion notification for `pnpm josh git -y` is what
resumes the run, and the turn that reads it goes straight through any branch-2 filing and
`pnpm josh epic:bundle` to `pnpm josh followup`. joshuafolkken/kit#1333 had already settled that end
state for a clean second round, and symptom 2 above is its regression — **so the guarantee is a
mechanism and not only the procedure**: `pnpm josh rule:guard` refuses the foreground push step and
states both halves at that call (`prompts/collaboration-workflow/rule-delivery.md`). A turn *ending*
is the absence of a call and no `PreToolUse` hook can see one, so the last call before the seam is
where the rule can be put; the push reissued detached is not refused again, so a run that obeys pays
nothing.

**One turn does end before the push, and only one: a dispatched lane child's pre-gate cut**
(joshuafolkken/kit#1839). It ends the turn before the gate and relaunches a fresh process in the same
act, so the run continues rather than stalling — the sanctioned boundary distinct from the push
turn-end this section forbids. The boundary, its two commands and the resume verification are the
`pre-gate-cut.md` skill document, its single source.

The operational section above is the single source of the rule. `followup.md`, `chain-rule.md` and
`backlogrun-progress.md` → "Progress while the run is quiet" route here for it rather than restating it.
