# The working-tree hold — one run per tree

**The single source of the hold**, read at its point of use — the moment a run is about to claim or
release the tree. History: `docs/maintainers/working-tree-hold-rationale.md` → "Where each rule came from".

**Ask `pnpm josh run:hold` before anything else, and obey what it answers.** It is the first call of
`fullrun` and `halfrun` alike — before the title is normalized, before `pnpm josh ms`, and **before
a `new` entry files its Issue**, because a run stopped after the filing has already left behind the
artifact it should not have created.

```bash
pnpm josh run:hold <N>        # a `#N` entry point
pnpm josh run:hold            # a `new` entry point, before the issue exists
pnpm josh run:release <N>     # that same run releasing its own record
pnpm josh run:release         # the bare form releases the unnumbered run's own record
pnpm josh run:release --force # a record left behind by a run that has ended
```

- **`hold` — this run now holds the tree. Continue.**
- **`busy` — another run holds it. Stop.** Send a `confirmation` Telegram carrying what the command
  printed on stderr (the holder, when the record was written, and the release command) and stop.
  **File nothing, create no branch, edit nothing.**
- **`unknown` — nothing was established. Stop the same way.** It is not "the tree is free".

**The unit is the working tree** — one branch, one index and one uncommitted diff, and a linked work
tree has its own three. **`backlogrun`'s per-repository guard (`epic-busy.ts`) is a separate layer and is
unchanged.**

**`kickoff` does not claim it** — it touches GitHub, never the branch, index or diff. Rationale for both:
`docs/maintainers/working-tree-hold-rationale.md` → "Why the unit is the working tree".

**Claim it in the checkout the run will edit.** The record is keyed to the work tree the command runs
in, so a cross-repository `fullrun owner/repo#N` resolves that repository's checkout from `pnpm josh
doctor` **first** — that resolution is a read and writes nothing — and claims there.

**A release names the run it belongs to.** `pnpm josh run:release <N>` removes the record only where the
record names `<N>`, the bare form only the unnumbered run's, and a record belonging to anything else
answers **`held`** and is left standing. **`pnpm josh run:release --force` is the one spelling that
removes a record this run did not write**, and the `busy` stop message names it rather than the
ordinary one.

**Release what the claim recorded, which is not always the Issue number.** A `#N` entry claimed `<N>`
and releases `<N>`; a **`new` entry claimed before its Issue existed**, so it releases with the
**bare** form however many numbers the run has acquired since — so a `fullrun new` that stops on a
split types `pnpm josh run:release`, not `pnpm josh run:release <N>`. The bare form removes no
label, so every `new` stop that releases — a split, a prerequisite or a third-party target — also runs `gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/in-progress
2>/dev/null || true`.

**Releasing is the run's, not a person's memory.** `pnpm josh followup` releases the hold on a merged
run, and a record abandoned by a crashed session expires after 8 hours. **A stop that leaves the tree
clean releases it explicitly**: a `fullrun` / `halfrun` that stops on a split, a prerequisite or a
third-party target ends with `pnpm josh run:release <N>` (bare where that run entered as `new`, followed by the label DELETE above).
**`halfrun`'s stop before commit keeps the hold**, and so does a `needs-human-review` stop: the
uncommitted work still in the tree is exactly what a second run would trample, so the release command
goes in the stop report and the Telegram for the person to type. **`fullrun #<N>` of the same issue
adopts a `halfrun`'s kept hold** rather than being refused `busy` by it — "The halfrun resume" below. **An expired record over a tree that
still has uncommitted changes does not free it**: the command answers `busy` and says to commit, stash,
or release once the work is done; only an expired record over a clean tree is replaced.

**The batch entry points claim per child, not per batch.** `backlogrun` never
call it themselves; each child runs the `fullrun` procedure, so it claims on entry and `pnpm josh
followup` releases it at that child's merge. The command's behavior and the answer table are
`docs/josh-commands-run.md` → "`josh run:hold` / `josh run:release`"; this file is the single source of
the procedure.

## The halfrun resume

**`fullrun #<N>` or `prrun #<N>` after a `halfrun` stop resumes it instead of claiming.** The
stop is **recorded, never inferred**: the `halfrun` ends with `pnpm josh run:hold <N> --halfrun-stop`,
which marks its own record (re-keying a `halfrun new`'s unnumbered one to the filed issue) — a
`halfrun` still implementing or a `backlogrun` child leaves the same hold over the same dirty tree, and
must not be adopted. On a marked hold for `#<N>` over a dirty tree, `run:entry` asks the session budget
(`over` stops as usual), adopts the hold with the `fullrun` mark and prints `entry #<N> — resume:
halfrun`. **Skip the title, the plan, the split assessment, `pnpm josh ms`,
`latest:scope` and the implementation**: the diff in the tree is what the person verified. Re-read the
issue (`pnpm josh issue:read <N>`), then run the gate **in full** from the refactor (`chain-rule.md` →
"Run the review-to-merge chain") — a fix made during the manual check has had no gate — and ship as
any `fullrun` does.

## The prrun resume

**`fullrun #<N>` after a `prrun` stop resumes it the same way.** The `prrun`
ends with `pnpm josh run:hold <N> --prrun-stop`, which writes the commit its pull request is on into its
own record; only a record carrying that commit is adopted. `run:entry` asks the session budget, adopts
the hold with the `fullrun` mark and prints one of three tokens — read, never inferred:

- **`resume: prrun-merged`** — a person merged the pull request. Run `pnpm josh followup "<title>
  #<N>"` alone: it detects the merge and runs only the post-merge tail.
- **`resume: prrun-merge`** — the branch is still on the stop's commit, both here and on the pull
  request, and the tree is clean, so what was verified is what would merge. Skip the gate and the
  review; run `pnpm josh followup` to merge.
- **`resume: prrun-gate`** — the branch moved (locally, or by a push made on GitHub), its pull request
  could not be read, or the tree is dirty: a person changed something. Run the
  gate **in full** and the review (`chain-rule.md` → "Run the review-to-merge chain"), then ship as any
  `fullrun` does.

All three skip the title, the plan, the split assessment and the implementation.
