# `backlogrun` — recovering a child that went wrong

Point-of-use, read one section at the failure that reaches it; the single source of `run:liveness`.

## A delegated unit that stopped without reporting

**A stop from outside leaves no notification behind, so the parent polls rather than waits.** Record
where a lane child writes with `pnpm josh lane:output <N> <path>` in the dispatch turn, and once its
output has been unchanged for the silent-unit window (`backlogrun-progress.md` → "Waiting, and never
waiting forever") **ask the command rather than combining the traces yourself**, in the checkout the
unit was given:

```bash
unit_output=$(pnpm josh lane:output <N>) &&
  pnpm josh run:liveness <N> --output "$unit_output"     # the `&&` is load-bearing: `none` is no path
pnpm josh run:liveness <N> --output <absolute path> --process <command lines naming this checkout>   # a unit in this session's own checkout
```

| Answer | What the parent does |
| --- | --- |
| `alive` | Keep polling; touch nothing |
| `settled` | Re-read with `pnpm josh run:status <N>` and take the branch its state section says |
| `undetermined` | Read the trace that failed and ask again. **A second in a row on the same child is a fault in the check**: send a `confirmation` naming the trace and stop — never escalate it to `stopped` |
| `stopped` | The recovery below |

Rationale: `docs/maintainers/backlogrun-recovery-rationale.md` → "Why liveness needs silence and no
process together".

**On `stopped`, re-read with `pnpm josh run:status <N>`.** **A re-read carrying `needs-decision`** — the
unit parked it, then stopped: leave the label on and count nothing. Otherwise, while `state: OPEN`:

1. **Stash the half-finished work** — `git stash push -u -m "backlogrun: stopped unit for #<N>"` — and
   record it on the Issue; it is popped by message, `pnpm josh stash:pop "backlogrun: stopped unit for
   #<N>"`, never positionally.
2. **Classify and act in one call** — `pnpm josh run:merge <N> --output <path>` (`--epic <E> --repo
   <owner/repo> --owner "$PPID"` for a named epic), **the same composite a returned child takes**. It
   tells an `outage` (re-dispatched with its session resumed, uncounted, bounded by
   `CONSECUTIVE_OUTAGE_LIMIT`) from an `abandoned` child (parked `needs-decision` and counted), and drops
   the stale `in-progress` itself.
3. **Act on the token it printed** — `backlogrun-progress.md` → "Running a named epic's children".

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
