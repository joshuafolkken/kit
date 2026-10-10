# Observation filing — rationale

This is maintainer-only rationale behind `.claude/skills/workflow-commands/observation-filing.md`: the
measurements, the history and the arguments that justify the depth test and the depth-0 share; the
ledger's are in `observation-ledger-rationale.md`. It is never read during a run — every trigger, command, verdict and bound an agent
acts on stays in the procedure document, and a change to this file changes no rule.

## Why depth gates a discretionary filing

**A run that has just spent an hour inside the workflow tooling files findings about the workflow
tooling** (joshuafolkken/kit#1698). Measured on the `backlogrun` of 2026-09-09: 5 Issues shipped and
15 filed, of which 13 were discretionary — and all 20 were about this package's own run
orchestration or the tools that measure it, with not one change a consumer of the package would see.
**A listing that measures itself has no natural stopping condition**, because every measurement
creates something new to measure. So the condition comes from outside, and **depth is what supplies
it — read off the subject rather than judged**.

**This is not the count cap that was rejected.** A cap is rationing — past the number the finding is
lost, and nothing about it says which findings were worth having. The depth test changes what counts
as a finding at all, so what it excludes is excluded for a reason a reader can check.

**Why depth 2 carries a further requirement** (joshuafolkken/kit#1975). The citation the depth-0 gate
asks for is one a slow run can always produce, so it barely bites on a measurement Issue: "runs are
slow" and "the diff is large" both name depth-0 work, while the number the Issue proposes to produce
changes nothing — and a listing that measures itself has no natural stopping condition precisely there.

**Why a PR that adds a measurement names its reader.** It is joshuafolkken/kit#2012's test, the one
that retired every column no decision reads, moved to the moment a column is proposed so the
retirement never has to be filed again.

## Why the depth label is applied at filing

- **Not at completion:** a depth assigned when the work finishes is assigned by whoever happens to
  close it, and the depth-0 share is a question about the _open_ backlog — an Issue that never carried
  the label was never in the numerator's reach.
- **The lowest-depth tie-break** is fixed rather than a preference: without one the same backlog
  measured twice can answer twice, which is the whole defect joshuafolkken/kit#1729 was filed for.
- **No label on an epic:** a depth label present on an Issue the count skips is exactly the ambiguity
  the label section exists to remove.

## Why a review branch-2 filing skips the depth test

**That bar is the reason, and the subject's depth is not** — the sentence in the procedure used to say
that a defect in a `josh` command's behavior is depth 0 by construction, and joshuafolkken/kit#1694
and joshuafolkken/kit#1703 are both branch-2 filings whose subject is the epic tooling, which the depth
table puts at depth 1 (joshuafolkken/kit#1675).

## Why the depth-0 denominator is fixed

**joshuafolkken/kit#1698 set a measurable target: the share of open Issues at depth 0** — 3/23
≈ 13% on 2026-09-09 (joshuafolkken/kit#1729). Counted by eye it is not reproducible: done again on
2026-09-10 it produced 3/14 ≈ 21%, and the two figures **are not comparable**: they took different
denominators, and neither said which. So the denominator is fixed as a rule rather than left to the
counter.

- **`epic` is excluded** because an epic is a container for other Issues rather than a deliverable of
  its own — counting one counts its children twice, and an epic has no subject of its own to read a
  depth off.
- **`route:tier-a` and `route:interrupt` are counted** because, excluded, a run could improve the
  share by choosing a filing route.
- **An unlabelled Issue stays in the denominator** because, left out, the share would improve every
  time a filing skipped the label — the one direction a measurement must never be able to move on its
  own.

The fixed rule is what lets two readings of the same backlog give the same number, which is what the
hand counts could not do.

## Why a delegated child neither files nor appends

**The ledger's whole value is that one key means one phenomenon**, and a child holding one Issue's
worth of context cannot tell its observation from the sibling lane's: eight children appending in
parallel would write the same thing under eight keys, and every one of them would then read as a
first sighting.

**Two reasons, and a child can solve neither for itself.** It holds one Issue's worth of context, so
**it cannot tell its observation from the one a sibling filed twenty minutes earlier** — the 15
filings of 2026-09-09 were collapsed to 12 within that same day, which means they were collapsible
at the moment they were made. And **the 10-per-run ceiling for this route is the parent's to
count**: six children counting two or three filings each never reach it, which is why it did not
fire once on the run that filed fifteen.

## Where each rule came from

- The procedure moved out of the entry into its own file, read when an observation turns up —
  joshuafolkken/kit#1797; nothing under `prompts/collaboration-workflow/` restates it —
  joshuafolkken/kit#1649, joshuafolkken/kit#1797.
- The ledger and the user-reported-bug record split out to `observation-ledger.md`, and `issue:file`
  provisions missing depth labels itself — joshuafolkken/kit#3176.
- The `Stop` hook sends an unattended run's filing offer back — joshuafolkken/kit#2422.
- The depth table and the depth-0 share as a target — joshuafolkken/kit#1698.
- The depth label applied at filing, and the fixed depth-0 denominator — joshuafolkken/kit#1729.
  Changing what `backlog:next` offers on the share, and setting a target value, were recorded as out
  of scope there.
- The further requirement on a depth-2 filing — joshuafolkken/kit#1975.
- A PR that adds a measurement names its reader — joshuafolkken/kit#2012.
