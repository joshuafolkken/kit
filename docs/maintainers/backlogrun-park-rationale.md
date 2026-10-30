# `backlogrun` park — rationale

Rationale behind `.claude/skills/workflow-commands/backlogrun-park.md`.

## Why `needs-human-review` keeps its lane instead of parking

The stopped child's uncommitted work is the artifact a person has to look at. Its lane keeps its
hold and counts in use, while the parent launches other children in the remaining free lanes.
Committing or opening a PR would change the artifact the person was asked to review.

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
