# `backlogrun` recovery — rationale

This is the maintainer-only rationale behind `.claude/skills/workflow-commands/backlogrun-recovery.md`:
the reasons behind the failure-only procedures a run reads when a delegated unit goes silent or a
lane's pull request conflicts with `main`. It is never read during a run — the procedure document
carries every trigger, command, bound and prohibition, and points here only for why they are what
they are. The sections moved here from `backlogrun-child-rationale.md` and
`backlogrun-lanes-rationale.md` with their procedures (joshuafolkken/kit#3175).

## Why liveness needs silence and no process together

Each trace alone has an innocent reading: a unit inside a long check writes nothing, and a unit only
reading has no check process. Together they do not.

Which way an error falls is the whole design. A live unit booked as stopped has its work killed; a
stopped one booked as alive only costs waiting. That is why a trace that could not be read answers
`undetermined` and never `stopped`, and why two `undetermined` answers in a row are treated as a fault
in the check rather than escalated.

## Why the poll routes through `run:merge`

The counting, the re-dispatch cap and the park all live in one place, so the poll cannot drift from
the return path (joshuafolkken/kit#2277). Counting the outage into its streak is what lets the cap
trip; skipping the count would re-dispatch into a dead API without bound. Reading the exit record from
the poll — not waiting for a unit that an API outage may never return — is what turns a 400-minute wait
into a same-run re-dispatch.

The `outage` classification came from joshuafolkken/kit#2240, and resuming the child's own session on
re-dispatch from joshuafolkken/kit#2317. An `abandoned` child is not silently retried because a retry
would re-run a half-written tree, and the consecutive-failure guard is the only thing that notices that
the environment rather than the children is at fault.

## Why a conflict is resolved in the lane rather than handed to a person

Nothing is at risk while the child resolves, because the work is already committed and pushed: the
pull request holds the branch, `git merge --abort` puts the tree back, and no step rewrites a pushed
commit. A rebase would rewrite pushed commits and need a force push, which this package denies — hence
merge, never rebase. A lost merge race is an ordinary outcome of running many lanes, so it is not
counted against the consecutive-failure guard.

Staying in the lane keeps the run clear of the reattach question, although `lane:open` can now reattach
to a pushed branch so a lane closed by mistake is recoverable.

Concluding with `pnpm josh git -y` is required because without it nothing changes on `origin`: GitHub
still returns `mergeStateStatus: DIRTY`, the merge step reports the same conflict, and condition 3 reads
that as a second one and parks the child for good. The distributed `.claude/settings.json` denies
`Bash(git commit*)` and `Bash(git add*)`, so the node script is the only sanctioned way.

The safeguard is the re-run verification, not who holds the pen. What is dangerous is unreviewed code
merging onto a branch whose review has converged, and that happens identically whichever hand did the
work — so routing the decision to a person does not address it, while re-running the gate and the review
does. In this repository routing it to a person does not even resolve it: the user does not read code,
so a code-level conflict handed over is a deferral rather than a decision.
