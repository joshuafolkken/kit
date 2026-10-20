# The working-tree hold — one run per tree

Read the moment a run is about to claim or release the tree.

**Ask `pnpm josh run:hold` before anything else, and obey what it answers** — the first call of
`fullrun` and `halfrun`, before the title, before `pnpm josh ms`, and **before a `new` entry files its
Issue**.

```bash
pnpm josh run:hold <N>        # a `#N` entry point
pnpm josh run:hold            # a `new` entry point, before the issue exists
pnpm josh run:release <N>     # that same run releasing its own record
pnpm josh run:release         # the bare form releases the unnumbered run's own record
pnpm josh run:release --force # a record left behind by a run that has ended
```

- **`hold` — this run now holds the tree. Continue.**
- **`busy` — another run holds it. Stop.** Send a `confirmation` Telegram carrying its stderr (the
  holder, when the record was written, the release command). **File nothing, create no branch, edit
  nothing.**
- **`unknown` — nothing was established. Stop the same way.** It is not "the tree is free".

**The unit is the working tree** — one branch, one index and one uncommitted diff, and a linked work
tree has its own three. **`backlogrun`'s per-repository guard (`epic-busy.ts`) is a separate layer.** **`kickoff`
does not claim it.**

**Claim it in the checkout the run will edit** — a cross-repository `fullrun owner/repo#N` resolves
that checkout from `pnpm josh doctor` **first** (a read) and claims there.

**A release names the run it belongs to.** `pnpm josh run:release <N>` removes only a record naming
`<N>`, the bare form only the unnumbered run's; anything else answers **`held`** and stands. **`pnpm
josh run:release --force` is the one spelling that removes a record this run did not write**, and the
`busy` message names it.

**Release what the claim recorded.** A `#N` entry releases `<N>`. A **`new` entry claimed before its
Issue existed**, so once it files `<N>` it runs `pnpm josh run:hold --adopt <N>`, which re-keys the
record to `<N>` and applies `in-progress`; from then on every stop releases with `run:release <N>`.
A `new` stop before filing releases with the **bare** form.

**Releasing is the run's, not a person's memory.** `pnpm josh followup` releases on a merged run; an
abandoned record expires after 8 hours. **A stop that leaves the tree clean releases it explicitly** —
a split, a prerequisite or a third-party target ends with `pnpm josh run:release <N>` (bare for a `new`
entry not yet adopted). **`halfrun`'s stop before commit keeps the hold** (`run:hold <N>
--halfrun-stop`), as does a `needs-human-review` stop (`run:hold <N> --human-review-stop`); each is
refused until `pnpm josh test:e2e` answered green on this tree, and sends its own `confirmation`. **`fullrun #<N>` of the same issue adopts a `halfrun`'s kept hold** — "The halfrun resume"
below. **An expired record over a tree that still has uncommitted changes does not free it** — it
answers `busy`; only an expired record over a clean tree is replaced.

**The batch entry points claim per child, not per batch** — each `backlogrun` child claims on entry and
`pnpm josh followup` releases at its merge. The answer table is `docs/josh-commands-run.md` → "`josh
run:hold` / `josh run:release`".

## The halfrun resume

**`fullrun #<N>` or `prrun #<N>` after a `halfrun` stop resumes it instead of claiming.** The stop is
**recorded, never inferred**: the `halfrun` ends with `pnpm josh run:hold <N> --halfrun-stop`, marking
its record (a `halfrun new` adopted its unnumbered one at filing) — a `halfrun` still implementing or a
`backlogrun` child leaves the same dirty tree and is not adopted. On a marked hold for `#<N>`,
`run:entry` asks the session budget, adopts the hold and prints `entry #<N> — resume: halfrun`. **Skip
the title, the plan, the split assessment, `pnpm josh ms`, `latest:if-required` and the implementation**;
re-read the issue (`pnpm josh issue:read <N>`), run the gate **in full** from the refactor
(`chain-rule.md` → "Run the review-to-merge chain"), and ship as any `fullrun` does.

## The prrun resume

**`fullrun #<N>` after a `prrun` stop resumes it the same way.** The `prrun` ends with `pnpm josh
run:hold <N> --prrun-stop`, which records its pull request's commit; only a record carrying it is
adopted. `run:entry` prints one of three tokens — read, never inferred:

- **`resume: prrun-merged`** — a person merged it. Run `pnpm josh followup "<title> #<N>"` alone; it
  runs only the post-merge tail.
- **`resume: prrun-merge`** — branch and pull request still on the stop's commit, tree clean. Skip the
  gate and the review; run `pnpm josh followup` to merge.
- **`resume: prrun-gate`** — the branch moved, its pull request could not be read, or the tree is
  dirty. Run the gate **in full** and the review (`chain-rule.md` → "Run the review-to-merge chain"),
  then ship.

All three skip the title, the plan, the split assessment and the implementation.
