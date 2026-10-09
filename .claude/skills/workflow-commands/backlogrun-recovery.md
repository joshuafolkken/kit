# `backlogrun` — recovering a child that went wrong

**Read the section you need at the moment it is needed, never at the entry or before the first child**
(joshuafolkken/kit#3175). Both sections below are reached only on failure — a unit that went silent, a
lane whose pull request conflicts with `main` — so a run in which nothing fails never pays for them.
`backlogrun-child.md`, `backlogrun-lanes.md` and `chain-rule.md` point here at those triggers.

## A delegated unit that stopped without reporting

**A unit can be stopped from outside, and a stop leaves no notification behind** — and a stopped unit
trips none of `backlogrun-child.md`'s guards, which all assume it is running. **So the parent checks
rather than waiting — which means it must not be waiting.** **Hand the child to the unit without
blocking on its return, and poll** at the loop's polling interval; ask once the unit's output has been
unchanged for the silent-unit window (`| Silent delegated unit | 30 min |` in `backlogrun-progress.md`).

**Note where the unit writes at hand-off; the modification time is read from the file, not carried.**
**Where the child runs in a lane, that note goes into the lane rather than the conversation** —
`pnpm josh lane:output <N> <path>`, in the same turn as the dispatch, so it comes back from
`pnpm josh lane:output <N>` in any session.

**Ask the command rather than combining the traces yourself.** Traces are read **in the checkout the
unit was given** — this session's own unless the unit was handed a separate work tree, and the stash in
the recovery below is taken there too.

```bash
pnpm josh run:liveness <N> --output <path>
pnpm josh run:liveness <N> --output <path> --window 45 --repo <owner/repo>
pnpm josh run:liveness <N> --output <path> --process none
```

| Answer | What it found | What the parent does |
| --- | --- | --- |
| `alive` | The output moved, or a process of the child is running | Keep polling; touch nothing |
| `stopped` | The output has been frozen past the window and no process of the child is alive | The recovery below |
| `settled` | The child closed, or the unit parked it with `needs-decision` | Re-read it with `pnpm josh run:status <N>` — one read-only call whose state section says which branch and whose carry counters beside it feed the failure-streak decision — and take the branch its state section says |
| `undetermined` | A trace could not be read | Read the trace that failed and ask again — and see the two-in-a-row rule below |

**Two `undetermined` answers in a row is a fault in the check, not a slow unit.** The second
consecutive `undetermined` on the same child ends the polling: send a `confirmation` Telegram naming
the trace that failed, and stop. **It is never escalated to a `stopped`** — nothing was read.

**Silence and no process together — never either one alone.** **A trace that could not be read answers
`undetermined`, never `stopped`**, and a process the command cannot see is not "no process" — hence
`--process` for an in-session unit (below). **Output that moved answers `alive` on its own; a live process is weighed only once every
trace has answered.** Rationale: `docs/maintainers/backlogrun-recovery-rationale.md` → "Why liveness needs
silence and no process together".

**The path passed to `--output` is absolute** — the command refuses a relative one. **The process
trace is read by the command only for a lane child** — its `fullrun #<N>` command line or its detached
ship; a probe that could not look answers `undetermined`. **A unit delegated inside this session's own
checkout is no such process: give it `--process`**, from the command lines (not the names) naming
**that checkout's path**, since several kit projects may run at once. **Read the file the path points at, not
the link**: a transcript path is a symlink whose own modification time never changes, so a `stat` typed
by hand needs `-L` (`run:liveness` follows the link itself).

**A clean checkout is not evidence that the unit is alive** — a stop can come while the unit is still
reading the skill and the issue. The checkout is read only for whether there is work to stash before
the child is parked; **"nothing was ever opened for the child" is `pnpm josh run:hold`'s preflight check
at the start of the next child, not this one's.**

**What follows is what a failed child already gets.** Re-read the child first with
`pnpm josh run:status <N>` — its state section carries the same `state:` / `labels:` /
`human_review:` lines `issue:state` prints, and folds in the carry counters this recovery reads
anyway; then, while it is still `state: OPEN` and not carrying `needs-decision`.
**A re-read carrying `needs-decision`** means the unit parked the child and then stopped, so fall
through to the loop's park branch: leave the label on, count nothing against the consecutive-failure
guard, and go back to step 1.

1. **Stash the half-finished work** — `git stash push -u -m "backlogrun: stopped unit for #<N>"` — and
   record it on the Issue. `-u` is not optional, and the comment is what gets the stash popped — by
   message, `pnpm josh stash:pop "backlogrun: stopped unit for #<N>"`, never a positional
   `git stash pop` that a shared stack lets another lane divert.
2. **Classify how the child ended and act, in one call** — `pnpm josh run:merge <N> --output <path>`
   (add `--epic <E> --repo <owner/repo> --owner "$PPID"` for a named epic). **It is the same composite a
   returned child takes** (`backlogrun-progress.md` → "Running a named epic's children"), reached here
   from the poll rather than from a return — **one** decision, never a second copy of it. It **reads the
   child's exit record without waiting for the unit to return**, telling an `outage` — a child that
   could not reach the API — apart from an `abandoned` one that stopped mid-implementation, and it drops
   the stale `in-progress` itself, so there is no separate label-removal step:
   - **outage** — the child never reached the API, so it is counted into its own outage streak and
     **re-dispatched in the same run** by being offered again, **not** parked with `needs-decision` and
     **not** counted against the consecutive-failure guard. **The re-dispatch resumes the child's
     session**: `lane:dispatch` reads the `session_id` off the exit record and relaunches with
     `--resume`; with no session id it falls back to a fresh `fullrun`, and the report says which path
     it took. **Outages inside a two-minute window count once** toward the streak. The re-dispatch is
     bounded by `CONSECUTIVE_OUTAGE_LIMIT` in `scripts/run/merge/run-merge.ts`: *distinct* outages trip the
     separate outage guard, at which point the command prints `environment` and the run stops. It never
     re-dispatches into a dead API forever.
   - **abandoned** — counted against the consecutive-failure guard and parked with `needs-decision`,
     exactly as a failed child — the label then answers to `backlogrun-park.md` → "Only a person's
     judgement carries `needs-decision`". Never retried silently.
3. **Read the token it printed and take that branch** — a next child number to run (the re-dispatched
   outage child among them), `environment` / `stop` to end the run, or `busy` / `retry` to re-read —
   the same tokens the merge event reads (`backlogrun-progress.md` → "Running a named epic's children").
   Then go back to step 1 of the loop.

Rationale: `docs/maintainers/backlogrun-recovery-rationale.md` → "Why the poll routes through `run:merge`".

## Conflicts are not predicted

**The child merges `origin/main` into its lane before its gate now, so this path is the fallback rather
than the first line.** Every `fullrun` runs `pnpm josh main:merge` ahead of the gate
(`chain-rule.md` → "origin/main is merged in before the gate", the single source), so an overlap
already on `main` is resolved before the gate reads the tree. What this section covers is an overlap
that lands on `main` *after* it, which `followup` still reports as a conflict.

**Nothing here forecasts which children will overlap.** The overlap surfaces where GitHub already
reports it: a pull request that conflicts with its base comes back `mergeStateStatus: DIRTY`, which
`git-pr-checks-eval.ts` reads as a **failure** rather than polling through it — so `pnpm josh followup`
ends that child with a named conflict in about ten seconds.

**That child does not stop: it resolves the conflict in its own lane.** It is **not** counted against
the consecutive-failure guard either way.

**The merge direction is `origin/main` into the lane's branch, never a rebase**, and no step below
rewrites a pushed commit. Rationale: `docs/maintainers/backlogrun-recovery-rationale.md` → "Why a conflict
is resolved in the lane rather than handed to a person".

1. **Resolve in the lane.** `git fetch origin main`, merge `origin/main` into the lane's branch, resolve
   in place. Do not close the lane, open another, or switch its branch.
2. **Re-run the whole gate.** The tree changed, so the green recorded before the conflict is void:
   `pnpm josh lint:related` and `pnpm josh test:related`, then `pnpm josh gate`.
3. **Review the resolution, one round.** Brief it with `pnpm josh review:brief` and run `/code-review`
   over the resolution diff, then require `pnpm josh review:attest --check` to answer `ok`. That round
   is a different subject and does not spend one of the two the cap allows — `prompts/review.md` →
   "Review round cap" carries the exception.
4. **Conclude the merge and push it, with `pnpm josh git -y`** — the only sanctioned way; without it
   nothing changes on `origin` and condition 3 parks the child for good. **Record the resolution on the
   Issue in this same step** — a comment naming the conflicting paths — because condition 3 counts
   resolutions off the Issue comments, not off memory.
5. **Merge**, by re-running `pnpm josh followup` exactly as before.

**The safeguard is the re-run verification, not who holds the pen** — a conflict the run can resolve is
not routed to a person.

**The run steps back under these four conditions, and under no others. The list is exhaustive and
carries no judgement.**

1. **The resolution requires deleting the other side's change.** That decides intended behavior, not
   text. It goes to the user as a **specification** question — "behavior A or behavior B" — never as a
   diff.
2. **Both sides rewrote the same lines** — overlapping, not adjacent. Read off the structure of the
   conflict hunks, so it needs no interpretation.
3. **A second conflict on the same child.** One resolution per child; the count is read off the Issue
   comments step 4 writes, so it survives an interrupt.
4. **The re-run gate did not come back green, or the resolution review returned a High.** Not only a
   High: a lint error, a failing test or a spell-check hit that merging a moved `main` introduced is
   this condition too.

Meeting any of the four, the child is parked — `needs-decision` plus a comment naming which of the four
it was, read against `backlogrun-park.md` → "Only a person's judgement carries `needs-decision`" — and its lane is **kept**, because the pushed branch is the resume path
(`backlogrun-lanes.md` → "What happens to a lane").

**Leave the tree clean before parking: `git merge --abort` precedes a park under conditions 1, 2 or 4.**
Conditions 1 and 2 are read mid-merge with conflict markers still in the tree, condition 4 after a merge
that is resolved but not committed; condition 3 fires before any merge is started, so there is nothing
to abort.
