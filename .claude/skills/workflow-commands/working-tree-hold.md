# The working-tree hold — one run per tree

**This is the body of `SKILL.md` §2f, relocated here so the entry read carries the trigger and the
pointer, not the procedure** (joshuafolkken/kit#2189). `SKILL.md` §2f is the resident stub, and
`fullrun.md` / `halfrun.md` route here for the definition. It is read at its point of use — the moment
a run is about to claim or release the tree.

**Ask `pnpm josh run:hold` before anything else, and obey what it answers.** It is the first call of
`fullrun` and `halfrun` alike — before the title is normalized, before `git switch main`, and **before
a `new` entry files its Issue**, because a run stopped after the filing has already left behind the
artifact it should not have created.

```bash
pnpm josh run:hold <N>        # a `#N` entry point ; alias: josh rh
pnpm josh run:hold            # a `new` entry point, before the issue exists
pnpm josh run:release <N>     # that same run releasing its own record ; alias: josh rr
pnpm josh run:release         # the bare form releases the unnumbered run's own record
pnpm josh run:release --force # a record left behind by a run that has ended
```

- **`hold` — this run now holds the tree. Continue.**
- **`busy` — another run holds it. Stop.** Send a `confirmation` Telegram carrying what the command
  printed on stderr (the holder, when the record was written, and the release command) and stop.
  **File nothing, create no branch, edit nothing.**
- **`unknown` — nothing was established. Stop the same way.** It is not "the tree is free".

**The unit is the working tree, and `epic-busy.ts` is not reused for it.** That read answers about a
*repository* and implements `backlogrun`'s one-child-per-repository rule; what these entry points contend
for is one branch, one index and one uncommitted diff, and a linked work tree has its own three.
**`backlogrun`'s own guard is unchanged** — the two layers guard different resources.

**`kickoff` does not claim it, and that is an exemption rather than an omission.** `kickoff` touches
none of branch, index or uncommitted diff: it reads the Issue, normalizes the title, posts the plan,
notifies and stops, every one of those against GitHub. It is a fact about the command rather than a
judgement made at the entry, and it changes nothing for `fullrun` or `halfrun`.

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
split types `pnpm josh run:release`, not `pnpm josh run:release <N>`.

**Releasing is the run's, not a person's memory.** `pnpm josh followup` releases the hold on a merged
run, and a record abandoned by a crashed session expires after 8 hours. **A stop that leaves the tree
clean releases it explicitly**: a `fullrun` / `halfrun` that stops on a split, a prerequisite or a
third-party target ends with `pnpm josh run:release <N>` (bare where that run entered as `new`).
**`halfrun`'s stop before commit keeps the hold**, and so does a `needs-human-review` stop: the
uncommitted work still in the tree is exactly what a second run would trample, so the release command
goes in the stop report and the Telegram for the person to type. **An expired record over a tree that
still has uncommitted changes does not free it**: the command answers `busy` and says to commit, stash,
or release once the work is done; only an expired record over a clean tree is replaced.

**The batch entry points claim per child, not per batch.** `backlogrun` never
call it themselves; each child runs the `fullrun` procedure, so it claims on entry and `pnpm josh
followup` releases it at that child's merge. The command's behavior and the answer table are
`docs/josh-commands.md` → "`josh run:hold` / `josh run:release`"; this file is the single source of
the procedure.
