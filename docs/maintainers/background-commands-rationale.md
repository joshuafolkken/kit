# Background commands — rationale

This is maintainer-only rationale behind `.claude/skills/workflow-commands/background-commands.md`:
the measurements and history behind backgrounding the gate and the push. It is never read during a run
— every rule, table and refusal an agent acts on stays in the procedure document, and a change to this
file changes no rule.

The procedure is read at its point of use, not at the entry: it binds only after the first edit — at
the gate, the push, the CI wait and `pnpm josh followup` — so it is fetched in full, in the turn that
reaches the first backgroundable command (`pnpm josh gate`), by the run that has to obey it (`SKILL.md`
→ §1, "Four documents are read at the point of use"). `background-commands.md` is the resident
pointer to it, and carries the one thing it does not: the same rule at a batch's scale.

## Where each rule came from

- The clean path folding the gate-to-merge region into one backgrounded `pnpm josh ship` —
  joshuafolkken/kit#2398.
- Recording before the CI wait ends, never after the merge — joshuafolkken/kit#2763.

## Why a poll loop is refused

Either way a hand-written `sleep` loop ends — a regex that never matches, or one that matches a mid-run
line — a full-context round trip is spent for nothing. Six lanes lost about 45 minutes, 13% of their
wall clock, to exactly this (joshuafolkken/kit#2371), and in the worst case a lane grepped a merged
PR's output file for 30 minutes after the merge had already landed. The refusal makes the guarantee a
mechanism rather than prose to remember.

`early-heartbeat` (joshuafolkken/kit#1570) leaves this loop alone by design, because a loop ends on a
condition rather than a clock — and here the condition it ends on is the wrong one, which is why a
separate row refuses it.

## Why the tail collects idle time

**A run's idle time collects in its tail, and the two ways it collects there are one mistake**
(joshuafolkken/kit#1510). `fullrun #1501` ran 45m03s on about 17 minutes of work. Of the 25 minutes
nothing was running, **6m28s** was a `pnpm josh git -y` issued in the **foreground** with a
900-second tool timeout — above the harness's own 600-second cap, so the harness detached it at the
cap and nothing read the output file for six and a half minutes afterwards — and **6m06s** was bare
CI: the push landed, the turn ended, and the merge started only once the person asked whether it was
merging. Both halves handed the deciding of _when to look back_ to something that was never going to
decide it. A further outlier was a 19m26s push transport fault.

The cap decides how long a foreground call waits, not the number passed to it, so a number above the
cap chooses the detached path without choosing the completion notification that should come with it.
A call issued detached from the start re-invokes the run when it exits — which is what makes the
completion _delivered_ rather than something to remember to poll for.

**A tail does follow the merge, and it is not small** (joshuafolkken/kit#1462). The procedure first
gave a different reason for keeping `followup` in the foreground — that the merge ends the run, leaving
no tail to overlap — and the measurement says otherwise. The run-timing report charges to
**`post-run`** exactly what runs after the last `followup` span ends: **3.0 min, 5.9% of a 50.5-minute
run**, in the lane child `--issue 1599` (PR #1602); **2 min 31 s, 14% of 20m15s**, in the plain
`fullrun #1597` (PR #1603); **3.1 min** hand-measured in run #1441's delegated child. **What was wrong
is the premise, not the conclusion** — `followup` stays foreground, and what changes is _where the
tail's work is done_.

The steps that stay after `followup` are each a verifier or keyed to a merge that has to have happened,
and bringing one forward would have it read a state nobody has reached yet; the parent reads the
child's state from GitHub _because_ a summary is not a verifier. The epic progress comment's counters
can be composed early because they are all counted inside the run, and the comment exists because a
compaction takes the counters at a moment nobody chooses — composing the values earlier moves no write
and loses no counter. `pnpm josh cost --cut` would be brought forward by the "does it read the merge
result?" question, but asking it a call early under-reads the very number the hand-off is decided on;
it is seconds of tail against a guard on session size.

The "writes nothing to the working tree" test for overlap is the same one that lets the gate and the
review overlap (`SKILL.md` → §2).

## Why the push is guarded

joshuafolkken/kit#1333 had already settled the "the turn never ends at the push" end state for a clean
second round, and the 6m06s of unattended CI above is its regression — so the guarantee is a mechanism
and not only the procedure. A turn _ending_ is the absence of a call and no `PreToolUse` hook can see
one, so the last call before the seam is where the rule can be put; the push reissued detached is not
refused again, so a run that obeys pays nothing.

The pre-gate cut (joshuafolkken/kit#1839) is the one sanctioned turn-end before the push because it
relaunches a fresh process in the same act, so the run continues rather than stalling. A headless lane
child kills its background Bash tasks at its turn end (joshuafolkken/kit#2704), and a backgrounded
`ship` dies before its supervisor exists (joshuafolkken/kit#3027), which is why that child hands the
region to a foreground `pnpm josh ship --detach`. Because a foreground `ship` in a child already
detaches itself after its preflight, the `PreToolUse` hook rewrites a backgrounded `ship` issued alone
into that foreground call (`updatedInput`) instead of refusing it — the refusal only ever asked for the
same call again (joshuafolkken/kit#3154).
