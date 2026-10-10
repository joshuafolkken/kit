# The open-Issue WIP cap (30) — rationale

This is maintainer-only rationale behind `prompts/collaboration-workflow/wip-cap.md` — the
measurements and arguments that justify the procedure's boundaries, exemptions and numbers. No run
reads it. Every trigger, command, verdict and boundary an agent follows stays in the procedure, and a
change to this file changes no rule.

## Tests that pin the wording

`scripts/backlog/backlog-manufacturing-rule.test.ts` pins what the hold message `HELD_MESSAGE`
(`scripts/issue/issue-wip.ts`) carries. Since joshuafolkken/kit#3423 there is no delivered row: the
command counts and holds on the first call, so a refusal ahead of it was a pure round trip.

`scripts/gh/gh-document-guard.test.ts` pins why `gh issue list` is not used: the only `gh` a
distributed document may put in an executable block is REST, and `gh issue list` goes through GraphQL,
which answers 403 in a cloud session.

## Why a cap is needed — the measurement

In the 7 days up to 2026-09-06, 257 Issues were filed and 163 closed — **+13.4 a day**. Over the
latest 14 days, filings outran closures on every single day. Meanwhile `fullrun` took a median of
about 10 minutes from PR creation to merge, so **throughput was not the problem**. Arrivals kept
outrunning processing, and with no cap on the open count the growth piled up where nobody saw it.

**The cap is an enforcement device that makes growth visible**, not a goal of fewer Issues. Its only
job is to make a filing over the cap ask once whether this one Issue is worth adding.

## Why a filing a run is blocked by is not stopped

Stopping it because of the cap would let a rule meant to reduce production stop execution, leaving
things "worse than now".

The same holds for a split's children. Stopping their filing and carrying on as one Issue breaks the
stop rule "file the children and the epic, then **STOP**", widening one Issue's approval to N — a
heavier harm than the one the cap exists to prevent.

## Where the interrupt category comes from

joshuafolkken/kit#1517 was a defect that made parallel runs impossible, but it did not block the run
that found it at that moment, so it fell on the discretionary side and survived **only inside a
comment on another Issue**. Had the user not happened to read that comment, it would have been lost.

Reading an interrupt caused by another package (file upstream and stop) and an interrupt from a
defect in this repository that does not block the run as the same thing is exactly the path by which
joshuafolkken/kit#1517 was dropped.

## Why self-reported severity is not a condition

The moment "I think it is serious" becomes a condition, the interrupt is a loophole anyone can walk
through, and the cap means nothing. The three conditions are written so that **someone else reaches
the same answer** about whether they hold, and that is their only job.

The solo-run verdict (`backlogrun-lanes.md`) excludes self-reported severity for the same reason: the
moment it is a condition, that category becomes a loophole too.

## Why an addition names no position

`--before` / `--after` actually write a `blocked-by` relation (`docs/josh-commands-backlog.md` →
"`josh epic --add`"), so `epic:next` stops offering the child being implemented, as "blocked by the
interrupt". An addition with no position declares no dependency at all, so what is picked up next is
the runner's choice, not a declared relation. `--order-before <M>` (joshuafolkken/kit#1738) only
moves the task-list line and writes neither a dependency nor `blocked-by`, so it is not prohibited —
**what is prohibited is `--before` / `--after`, which write a dependency, not ordering itself.**
`epic:next` offers the runnable children in task-list order (joshuafolkken/kit#1583), so an addition
with no position means "offered last"; to have the interrupt picked up next, move only its line
forward.

joshuafolkken/kit#1253 is what stopped an addition with no position from writing a dependency; the
remaining routes, such as appending with `--after`, are **still open** in joshuafolkken/kit#1080 —
the procedure asks for an addition with no position so the run does not route around the
closed side and rebuild here the defect the open side still has.

## Why a solo run

"Landed" means merged because this section rests on not running a batch over broken verification, so
**the fix takes effect at the moment of the merge**.

The original procedure gave two reasons and called either one alone enough to run solo:

1. **A batch run on broken verification leaves nobody's result trustworthy.** Run six lanes in
   parallel and six gates or reviews are void together. Everything is redone after the fix, so running
   solo is not even the slower choice.
2. **The interrupt's own verification sits under the defect it is fixing.** joshuafolkken/kit#1515
   (tests hit the real network) and joshuafolkken/kit#1517 (concurrent suites shared a temporary
   directory) both carried that self-reference, and both were run solo.

**Only reason 1 justifies stopping the other lanes** (joshuafolkken/kit#3024). Reason 2 is about how far that Issue's own
verification can be trusted; checking with the verification after the fix is enough, and stopping
unrelated lanes does not help it. Reason 1 holds only for **a defect in kit's own verification that
makes today's `main` misjudge unrelated PRs**.

**Why the condition was narrowed.** The earlier verdict asked only whether the issue touched a
verification surface (gate / review / push hook / merge check), and `docs/how-to/run-backlog.md`
widened it further to "an Issue that changes a verification path". Among Issues closed from
2026-09-01, 19 were `run:solo` and 76 `run:lane` — about one in five stopped parallel work. Eight of
the 19 were improvements or tidy-ups, not even `bug` (#2966, #2945, #2903, #2888 and others), and the
rest included CI / template defects in consumer projects (#3013, #2815, #2814, #2765), an efficiency
problem (#2980) and a storage-format change (#2919). None met reason 1. So the verdict became the AND
of three conditions: it is a defect, it is a defect in kit's own verification, and it makes today's
`main` misjudge unrelated PRs. Applied to the past 19, only about #2961 / #2841 / #2770 / #2851 stay
solo.
The enforcing code (`scripts/epic/epic-solo.ts` and the like) only reads the label, so it did not
change.

**The section exists because the verdict wavered.** joshuafolkken/kit#1522 (a lane child's review
read the session's checkout rather than the lane's) had the same shape as #1515 / #1517, yet right
after filing it was treated as a member of a parallel batch and was moved back to solo only when the
user pointed it out. The same judge gave opposite answers in the same week, which showed that
**without an enumeration the verdict is not consistent**. And #1522 returned a **false green**, not a
false red — the more dangerous side.

## Changing the cap itself

**The number is not Tier C** — raising or lowering it may be proposed with a measurement. But **a
change always moves `WIP_CAP` and the one line in `wip-cap.md`'s rule section in the same commit**;
moving one alone fails the test that pins them equal.

**"It feels tight" is not a reason to raise it.** Raise it only when the open count keeps falling on
a 7-day moving average and the cap is still stopping filings — that is, when the device has done its
job.

## The three move together

The cap does not work alone. **A cap without stopping the production side stops only execution while
production carries on.**

| Producer                   | Change                                                              | Single source                                                           |
| -------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| The split assessment       | Default to "do not split"; the guideline lives in the single source | `.claude/skills/workflow-commands/split-assessment.md` → "The question" |
| Review round 2's leftovers | Default to branch 3 (one line in the PR, then drop)                 | `prompts/review.md` → "Three-way disposition after the cap"             |
| The open count             | The WIP cap                                                         | `prompts/collaboration-workflow/wip-cap.md`                             |

## Why the three landed in one commit

A cap without stopping the production side stops only execution while production carries on. So joshuafolkken/kit#1469
landed the split-assessment default, the default for review round 2's leftovers and the 30-Issue WIP
cap together in one commit.
