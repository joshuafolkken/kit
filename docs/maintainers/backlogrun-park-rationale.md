# `backlogrun` park — rationale

This is the maintainer-only rationale behind `.claude/skills/workflow-commands/backlogrun-park.md`:
the reasons and history behind what a run does with a child that cannot finish. It is never read
during a run — the procedure document carries every trigger, command and prohibition, and points here
only for why they are what they are. A change to this file changes no rule.

## Why `needs-human-review` ends the run instead of parking

The `needs-human-review` stop is the one exception to park-and-continue, and it is not an oversight.
Parking works because the parked child leaves the checkout clean; this child does not. Its uncommitted
work is the artifact a person has to look at — which is why the alternative that kept the batch
running (commit, open a PR, merge nothing) was rejected: it satisfies "a person approves publication"
and fails "a person chooses".

The stop report and the Telegram name the lane directory because a person told to look at a working
tree and not told which one has been told nothing.

## Why a run spends no attention on a non-finding

`needs-decision` is kept to "a person has to choose" because a label a person has to clear for nothing
spends their attention and stalls the child; when in doubt the decision is therefore Tier A.

The same reasoning is why `in-progress` left on a closed issue is neither reported nor stripped: a
report is read as something that needs attention, so a run that lists non-findings is a run whose real
findings are harder to see.

## Where each rule came from

The procedure states these rules without their issue numbers; the provenance is kept here.

- The park procedure is a point-of-use document that `backlogrun.md` points to at the moment a child
  cannot finish, never an entry read — joshuafolkken/kit#2010
- A lane failure whose reason is not on its Issue is investigated by a delegated
  `lane-failure-investigation` unit, never by the parent — joshuafolkken/kit#2947
