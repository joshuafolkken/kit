# `backlogrun` — recovering a child that went wrong

Point-of-use, read one section at the failure that reaches it; the single source of `run:liveness`.

## A delegated unit that stopped without reporting

**A stop from outside leaves no notification behind, so the parent waits on `lane:await`, whose exit
covers it.** Record
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
| `alive` | Wait on `lane:await` again; touch nothing |
| `settled` | Re-read with `pnpm josh run:status <N>` and take the branch its state section says |
| `undetermined` | Read the trace that failed and ask again. **A second in a row on the same child is a fault in the check**: send a `confirmation` naming the trace and stop — never escalate it to `stopped` |
| `stopped` | The recovery below |

**On `stopped`, re-read with `pnpm josh run:status <N>`.** **A re-read carrying `needs-decision`** — the
unit parked it, then stopped: leave the label on and count nothing. Otherwise, while `state: OPEN`:

1. **Stash the half-finished work** — `pnpm josh stash:push "backlogrun: stopped unit for #<N>"` — and
   record it on the Issue; it is popped by message, `pnpm josh stash:pop "backlogrun: stopped unit for
   #<N>"`, never positionally.
2. **Classify and act in one call** — `pnpm josh run:merge <N> --output <path>` (`--epic <E> --repo
   <owner/repo> --owner "$PPID"` for a named epic), **the same composite a returned child takes**. It
   tells an `outage` (re-dispatched with its session resumed, uncounted, bounded by
   `CONSECUTIVE_OUTAGE_LIMIT`) from an `abandoned` child (parked `run:stalled` and counted), and drops
   the stale `in-progress` itself.
3. **Act on the token it printed** — `backlogrun-progress.md` → "Running a named epic's children".

## A person withdraws a running child

On a person's instruction to drop a running child's issue, run `pnpm josh lane:withdraw <N>
--reason "<their reason>"` — `docs/josh-commands.md` → "`josh lane:withdraw`".

## Conflicts are not predicted

**This path is the fallback**: every `fullrun` runs `pnpm josh main:merge` ahead of the gate
(`chain-rule.md` → "origin/main is merged in before the gate"), so it covers an overlap that lands on
`main` *after* it. **Nothing here forecasts which children will overlap** — a conflicting pull request
comes back `mergeStateStatus: DIRTY`, which `git-pr-checks-eval.ts` reads as a **failure**, so `pnpm josh
followup` ends that child with a named conflict in about ten seconds.

**That child does not stop: it resolves the conflict in its own lane**, uncounted by the
consecutive-failure guard. **The merge direction is `origin/main` into the lane's branch, never a
rebase**; no step rewrites a pushed commit.

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

**Leave the tree clean before parking: `git merge --abort` precedes a park under conditions 1, 2 or 4**
(condition 3 fires before any merge starts).
