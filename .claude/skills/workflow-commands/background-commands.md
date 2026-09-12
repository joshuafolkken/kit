# A command that can take minutes is issued in the background

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

**Which commands, and the one that is deliberately not among them:**

- **`pnpm josh git -y` — background.** Commit, the pre-push hook's unit suite, the push (120 seconds
  with one automatic retry, `scripts/git/git-push-transport.ts`) and the pull request. It is about a
  minute in the ordinary case and reached 19m26s once, on a transport fault.
- **`pnpm josh gate` — background, and already so.** It is *started* when `/code-review` starts and
  *joined* before the commit (`SKILL.md` → §2, joshuafolkken/kit#1242); that is backgrounding under
  an older name, and nothing about it changes here.
- **`pnpm josh eval` — background**, started with the review and read after it, on `required` only
  (`eval-gate.md`).
- **`pnpm josh followup` — foreground, and that is the boundary rather than an exception.** Nearly
  every step after it reads its result — the one that does not is named below — so detaching it
  would move the reading rather than overlap anything, and would buy an empty turn. **`followup.md`
  is read in full in the turn that issues the call, and not at the entry** (`SKILL.md` → §1, "Five
  documents are read at the point of use"); `followup.md` →
  "Always run `pnpm josh followup` in the foreground" stays exactly as it is, and shell `&`
  backgrounding is a different thing again — it never works at all.

**A tail does follow the merge, and it is not small** (joshuafolkken/kit#1462). This section first
gave a different reason for that last bullet — that the merge ends the run, leaving no tail to
overlap — and the measurement says otherwise. `pnpm josh time` charges to **`post-run`** exactly what runs
after the last `followup` span ends: **3.0 min, 5.9% of a 50.5-minute run**, in the lane child
`--issue 1599` (PR #1602); **2 min 31 s, 14% of 20m15s**, in the plain `fullrun #1597` (PR #1603);
**3.1 min** hand-measured in run #1441's delegated child, which is where this Issue started. **What
was wrong is the premise, not the conclusion** — `followup` stays foreground, and what changes is
*where the tail's work is done*.

**So the tail is emptied before `followup` is issued, rather than worked through after it returns.**
One question decides each step, and it is asked of the step rather than judged: **does it read the
merge result?**

- **It does — the step stays after `followup`.** `pnpm josh ms`, `pnpm josh issue:state <N>`,
  `pnpm josh epic:next`, `pnpm josh auto-ok:next --exclude <N>`, and `pnpm josh lane:close` /
  `pnpm josh lane:list`. Each is a verifier or is keyed to a merge that has to have happened, and
  bringing one forward would have it read a state nobody has reached yet. **De-duplicating a step is
  not removing it**: the parent reads the child's state from GitHub *because* a summary is not a
  verifier ("Each child runs in a delegated unit"), so none of these may be dropped or answered from
  memory.
- **It does not — the step is composed in the turn that issues `followup`.** The epic progress
  comment's counter *values* (children run, Issues filed, consecutive failures, `auto-ok` pickups,
  the run's start time) are all counted inside the run, and the completion report body is already
  placed beside `pnpm josh git -y` in the table below. **Only the write follows the merge.** The
  comment exists because a compaction takes the counters at a moment nobody chooses (`epicrun.md` →
  "The counters live in the conversation"), so composing the values earlier moves no write and loses
  no counter.
- **`pnpm josh cost --over 300000` stays after the merge, and reads nothing from it.** It measures
  this session's own transcript, so the question above would bring it forward — but its answer grows
  with the session, and asking it a call early under-reads the very number the hand-off is decided
  on. It is seconds of tail against a guard on session size, so it keeps its documented seam
  (`epicrun.md` → "The check is asked at every merge").

**What runs beside a backgrounded command is the work that writes nothing to the working tree.** That
is the whole test, and it is the same one that lets the gate and the review overlap (`SKILL.md` →
§2): a step that edits makes the background command's result stale, so it is not something to overlap
with. Applied to the three waits a run actually has:

| While this runs | Do this beside it |
| --------------- | ----------------- |
| `pnpm josh gate` | a subagent running `/code-review` with the brief `pnpm josh review:brief` prints, and `pnpm josh eval` where `eval:scope` answered `required` |
| `pnpm josh git -y` | Write the completion notification body to a file for `--notify-message-file`, and settle the three-way disposition of any remaining non-High finding |
| CI, after the push | The second review round where one is due, the branch-2 filing, and `pnpm josh epic:bundle <new>` (`prompts/review.md` → "Review round cap") |
| `pnpm josh followup` | Nothing — it is foreground and holds the session. **The post-merge tail is what overlaps here, and it is taken before the call rather than beside it**: compose the epic progress counters first, and leave after the merge only the steps that read its result, plus `pnpm josh cost --over 300000` |

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

This section is the single source of the rule. `followup.md`, `eval-gate.md`, `chain-rule.md` and
`epicrun.md` → "Progress while the run is quiet" route here for it rather than restating it.
