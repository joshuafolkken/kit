# `backlogrun` lanes — rationale

This is the maintainer-only rationale behind `.claude/skills/workflow-commands/backlogrun-lanes.md`:
the reasons, the history and the arguments that justify its rules. It is never read during a run —
the procedure document carries every trigger, command, bound and prohibition, and points here only for
why they are what they are. The procedure became a point-of-use document, never an entry read, in
joshuafolkken/kit#2010.

## Why the lane ceiling is shaped the way it is

An `backlogrun` need not be a single session because execution state lives on GitHub and nowhere else.

A cross-repository blocker's publish state is read from the blocker repository's manifest rather than
the registry because a registry 404 also means "this token may not see it".

A child stopped by `needs-human-review` goes on holding its lane because its uncommitted work is still
in that checkout.

The count is advisory rather than atomic: two sessions starting in the same instant can both read the
same free lane. What it closes is the window that actually occurs. The label is now claimed in
`lane:dispatch` before the child process starts, so a dispatched lane holds it from the launch onward —
not for the tens of minutes it took when the child's own `fullrun` had to reach its own apply first.
It is a guard that makes the invariant mechanical, not a mutex.

A listing that could not be read, or was cut short, answers `wait` because reading a failed read as
"nothing is running" is the one direction this guard may not fail in: that answer _starts_ work.

## Why a lane's review needs a brief and an attestation

`/code-review` is forked by the harness into the **session's** working directory, which during a lane
run is a different tree — usually the default branch. Reading that, the review finds nothing wrong and
the failure arrives as approval: the child counts the round as clean and commits a diff nobody read.
`pnpm josh review:brief` makes the path something no brief has to remember to carry, and the attestation
proves which checkout the review actually read. A clean round is therefore the case to check hardest.

## Why the lane branch is `<N>-lane` and never switched

`pnpm josh git` refuses to commit from a branch that is neither the default branch nor one sharing the
child's `<N>-` prefix (`scripts/git/git-branch.ts` → `has_same_issue_prefix`, `/^\d+-/`), so the issue
number leads the branch name. `lane-registry.ts` → `branch_issue` identifies a lane **by** that branch
name, so a switched lane drops out of `list_lanes()` — losing its seat, its listing and its isolation.

## Why lanes cost as well as buy throughput

Many lanes make the overlap between children real, and every overlap that becomes a conflict costs the
child that loses the race a resolution, a re-run gate and a review, and parks it outright under the
four conditions. That is why the throughput gain is reported only beside its merge-race cost.

## Why `lane:launch` folds the lane steps into one

`lane:launch` (joshuafolkken/kit#2162) folded four to six turns of the parent into one call. The
`--stash` lane installs twice because the pop brings in the `pnpm-lock.yaml` that `josh latest`
rewrote, which that child's gate must build against.

`run:hold`'s preflight is not asked in a lane because a fresh lane is clean by construction, the
preflight's `reclaim` arm (HEAD != default branch) is true of every lane, and its recovery
(`git switch <default>`) cannot run in a linked work tree.

The dispatch records where the child writes as it starts it, so "this lane records no path" is no longer
a state the hand-off has to except. The brief the child used to be handed was replaced by the
invocation itself.

## Why a committed child's lane is kept

A committed child's lane is kept because it is the cheapest resume, not because closing it is final.
`lane:close` follows the work-tree removal with `git branch -D <N>-lane`, and resume is a re-run of
`pnpm josh followup`, which reads the branch **locally** (a `git diff` against the merge base) — so with
no local branch the gate cannot be re-evaluated. Keeping the lane is worth a seat: the tree, the branch
and its `node_modules` are still there, and the resume is one command.

Closing it used to be unrecoverable. `pnpm josh lane:open <N>` now attaches to a `<N>-lane` that exists
locally and creates one from `origin/<N>-lane` where only the remote has it, so a lane closed after a
push is reopened rather than lost. Every after-commit park now keeps its lane, with no exception left in
the table.

A kept lane holding its seat is the price rather than an oversight. Seats are read back out of the live
work trees, so `lane:open` answers `full` rather than handing out ports twice. The optimism is
`epic:next`'s — it counts a parked child as having released its lane — and it costs one child offered
that cannot get a lane, which is visible and recoverable.

A `needs-human-review` stop lets in-flight lanes finish because killing units mid-gate would strand as
many trees as there are lanes.

## Why CI concurrency is capped by the lane limit

Past a GitHub account's concurrency entitlement, jobs queue rather than fail, which could cancel out
what the lanes bought. `ci.yml`'s concurrency group is keyed on `${{ github.ref }}`, so N lanes on N
branches are N independent groups and no lane cancels another's run.

## Where each rule came from

The procedure states these rules without their issue numbers; the provenance is kept here.

- The `run:solo` / `run:lane` labels, and the solo run's three conditions — joshuafolkken/kit#2776
- `backlog:next` and `epic:next --lanes` answer `triage` for an issue carrying neither label, so a run's
  own filing carries one from the start — joshuafolkken/kit#2779
