# `backlogrun` — recovering a child that went wrong

Point-of-use, read one section at the failure that reaches it; the single source of `run:liveness`.

## A delegated unit that stopped without reporting

**The parent hands the child off without blocking and waits on `backlog:drive` or `lane:await`.** Record
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
| `paused` | Tell the person; neither wait nor recover (`docs/josh-commands-run.md` → `josh run:liveness`) |
| `settled` | Re-read with `pnpm josh run:status <N>` and take the branch its state section says |
| `undetermined` | Read the trace that failed and ask again. **A second in a row on the same child is a fault in the check**: send a `confirmation` naming the trace and stop — never escalate it to `stopped` |
| `stopped` | The recovery below |

**On `stopped`, re-read with `pnpm josh run:status <N>`.** **A re-read carrying `needs-decision`** — the
unit parked it, then stopped: leave the label on and count nothing. Otherwise, while `state: OPEN`:

1. **Stash, classify and act in one call** — `pnpm josh run:merge <N> --output <path> --stash` (`--epic <E> --repo
   <owner/repo>` for a named epic), **the same composite a returned child takes**.
2. **Act on the token it printed** — `backlogrun-progress.md` → "Running a named epic's children".

## A person withdraws a running child

On a person's instruction to drop a running child, run `pnpm josh lane:withdraw <N>
--reason "<their reason>"` — `docs/josh-commands.md` → "`josh lane:withdraw`".

## Conflicts are not predicted

**This path is the fallback**: every `fullrun` merges origin/main ahead of the gate
(`chain-rule.md` → "origin/main is merged in before the gate"), so it covers an overlap that lands on
`main` *after* it. **Nothing here forecasts which children will overlap** — `pnpm josh followup` ends a
conflicting child with a named conflict.

**That child does not stop: it resolves the conflict in its own lane**, uncounted by the
consecutive-failure guard. **The merge direction is `origin/main` into the lane's branch, never a
rebase**; no step rewrites a pushed commit.

1. **Resolve in the lane — `pnpm josh lane:resolve <N>`**, then act on its verdict
   (`docs/josh-commands.md` → "`josh lane:resolve`"): `conflict <paths>` → resolve in place;
   `step-back 2|3` → park (below). Do not close the lane, open another, or switch its branch.
2. **Re-run the whole gate.** The tree changed, so the green recorded before the conflict is void:
   `pnpm josh lint:related` and `pnpm josh test:related`, then `pnpm josh gate`.
3. **Review the resolution, one round.** Brief it with `pnpm josh review:brief` and run `/code-review`
   over the resolution diff, then require `pnpm josh review:attest --check` to answer `ok`. The round
   spends none of the cap (`prompts/review.md` → "Review round cap").
4. **Conclude the merge and push it, with `pnpm josh git -y`**, then **`pnpm josh lane:resolve <N>
   --record <paths>`** — the comment condition 3 counts; it refuses until the push has landed.
5. **Merge**, by re-running `pnpm josh followup` exactly as before.

**The run steps back under these four conditions, and under no others.**

1. **The resolution requires deleting the other side's change.** That decides intended behavior, not
   text. It goes to the user as a **specification** question — "behavior A or behavior B" — never as a
   diff.
2. **Both sides rewrote the same lines** — `lane:resolve`'s `step-back 2`, merge already aborted.
3. **A second conflict on the same child** — `lane:resolve`'s `step-back 3`, read off step 4's comments.
4. **The re-run gate did not come back green, or the resolution review returned a High.** Not only a
   High: a lint error, a failing test or a spell-check hit that merging a moved `main` introduced is
   this condition too.

Meeting any of the four, the child is parked — `needs-decision` plus a comment naming which of the four
it was, read against `backlogrun-park.md` → "Only a person's judgement carries `needs-decision`" — and its lane is **kept**, because the pushed branch is the resume path
(`backlogrun-lanes.md` → "What happens to a lane").

**Leave the tree clean before parking: `git merge --abort` precedes a park under conditions 1 or 4**
(`lane:resolve` aborts for 2; 3 fires before any merge starts).
