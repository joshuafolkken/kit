# `backlogrun` — lanes and concurrency

**Read this file in full before the first lane opens** — in the turn that reaches
`pnpm josh lane:open`. It is a point-of-use document, never an entry read: the entry procedure is
`backlogrun.md`, which points here at that step (joshuafolkken/kit#2010). This file is the single
source of the per-repository lane ceiling, the lane lifecycle, and how a merge conflict between lanes
is resolved.

## Concurrency: as many children per repository as it has free lanes

Execution state lives on GitHub and nowhere else, so **an `backlogrun` need not be a single session.** One
session per repository; each calls `josh epic:next <E> --repo <owner/repo>` and runs only its own
repository's children.

```bash
# In the kit checkout
pnpm josh epic:next 858 --repo joshuafolkken/kit
```

A child in another repository is read against that repository through `gh api`, so no clone is needed
to learn its state — only to implement it. A repository with no checkout here says so rather than being
cloned.

**A dependency that crosses a repository is not satisfied when the blocking issue closes.** Merging
kit's issue does not publish kit, so such a dependency resolves only once the blocker is closed *and*
its release has appeared in the registry — and while the blocker is still open the registry is never
consulted. **Unless that repository publishes nothing** — no `package.json` on its default branch, or
one declaring `private` — in which case a closed blocker there resolves. The answer is read from the
blocker repository's manifest, never from the registry (a 404 also means "this token may not see it").

**The lane count is per repository, and `epic:next` is what applies it.** When it has a child to offer,
it first asks that repository **how many of its lanes are already running something**: every open issue
carrying `in-progress` and not parked counts for one — whichever epic it belongs to. What is left of
`JOSH_LANE_LIMIT` (**default 6**) is what gets offered, and at zero the answer is `wait`. It is asked
**only when there is a candidate**. A **parked** issue does not hold a lane: `needs-decision` outranks
`in-progress` here exactly as in the classification. A child stopped by `needs-human-review` is
deliberately not parked and goes on holding its lane, because its uncommitted work is still in that
checkout.

**It is advisory and not atomic.** The label is applied when a child is dispatched — the parent claims
it in `lane:dispatch` before the child process starts, and a standalone `fullrun` / `halfrun` claims it
the moment `run:hold` answers `hold` — *after* this read, so two sessions starting in the same instant
can both read the same free lane. What the check closes is the window that actually occurs — a
dispatched lane holds the label from the launch onward, not the tens of minutes it took when the
child's own `fullrun` had to reach its own apply first. It is a guard that makes the invariant
mechanical, not a mutex.

**It is scoped to the resource, not the epic.** A lane is its own checkout with its own branch and
ports, so the repository-wide number is a **ceiling on how many lanes run at once**. How a session
drives more than one child at a time is "Lanes — running more than one child at a time" below.

**A stale label holds a lane, so the stale rule reaches past this epic's own children** — "`in-progress`
is removed by whoever finds it stale" below applies to **any** open issue in the repository. `epic:next`
names the holders on standard error, and the 90-minute stale window bounds the wait.

**A listing it could not read is not an idle repository.** `epic:next` answers `wait` there rather than
offering the child — reading a failed read as "nothing is running" is the one direction this guard may
not fail in, because that answer *starts* work. **A listing that was *cut short* is the same answer**: a
short one with no visible holder is `wait`, with its own message.

**Two children of one repository may run at once, and the section below is how.** The guard is a
ceiling rather than a prohibition, scoped to the lane rather than to the epic. **Do not read this as
"concurrency needs no coordination"**: the coordination is this section plus the one below, and
switching the guard off is not one of the ways to get parallelism.

Parallelism only helps children that do not depend on each other. When app-kit's child needs kit's new
feature, that is recorded as `blocked-by` and `epic:next` makes it wait.

## Lanes — running more than one child at a time

`pnpm josh epic:next <E> --repo <owner/repo> --lanes` answers with **one issue number per line**, up to
the number of free lanes, and each of those children runs in a **lane** of its own: a linked git work
tree with its own branch, its own `.env` and its own dev and preview ports (`docs/josh-commands.md` →
"`josh lane:open` / `josh lane:close` / `josh lane:list` / `josh lane:prune`"). **Implementation, the
verification gate and the review run in parallel; the merges stay serial** — each one lands on the
`main` the next is then measured against.

**A lane child may cut its own turn before the gate.** Implementation done, it ends its process and a
fresh one resumes the same lane from the gate onward — the boundary, the two commands and the resume
verification are `pre-gate-cut.md`, the single source. **The child is told apart from a person, and its
resume stage is handed to it, by a mark the dispatch sets** — `JOSH_LANE_CHILD`, the lane's issue
number (`pre-gate-cut.md` → "The dispatch mark" and "The stage is passed to the resumed child").

**One kind of child takes no lane beside anything: an interrupt whose subject is a defect in the
verification path itself.** It runs alone, and the batch resumes only once it has merged. **Decide it
from the enumeration, never from how serious it looks** — does the defect reach the verification gate
(lint / type check / spell check / unit tests), the code review, the pre-push hook, or the merge
checks? One of those, and the offered children wait; none, and it fills a lane like any other child.
**Ask it of what `epic:next --lanes` just offered, before opening a second lane**; the rule is
`prompts/collaboration-workflow/wip-cap.md` → 「実行のしかた」, its single source.

**A lane's review does not inherit the lane, and `pnpm josh review:brief` is what closes that.**
`/code-review` is forked by the harness into the **session's** working directory, which during a lane
run is a different tree — usually the default branch. Reading that, the review finds nothing wrong and
**the failure arrives as approval**: the child counts the round as clean and commits a diff nobody
read. **So the path is no longer something a brief has to remember to carry**: `pnpm josh review:brief`
prints the lane's absolute root, branch and HEAD, hands over targets written `git -C <root> …`, and
prints a nonce the review attests with `pnpm josh review:attest <nonce>` from the checkout it actually
read. **The child asks `pnpm josh review:attest --check` before it counts a round**, and
`pnpm josh followup` asks again before it merges; `missing` and `mismatch` are both refusals. A clean
round is therefore the case to check hardest, not the case to skip the check on.

**A lane's branch is `<N>-lane`, and the issue number leads it so that the commit path accepts it.**
`pnpm josh git` refuses to commit from a branch that is neither the default branch nor one sharing the
child's `<N>-` prefix (`scripts/git/git-branch.ts` → `has_same_issue_prefix`, `/^\d+-/`). **Switching
the lane to another branch is not the way round it**: `lane-registry.ts` → `branch_issue` identifies a
lane **by** that branch name, so a switched lane drops out of `list_lanes()` — losing its seat, its
listing and its isolation. So `epic:next` is asked **with** `--lanes`, and everything below runs as
written.

**Running unattended gets harder, not easier, and that is the honest trade.** Many lanes make the
overlap between children real, and every overlap that becomes a conflict costs the child that loses the
race a resolution, a re-run gate and a review ("Conflicts are not predicted" below), and parks it
outright under that section's four conditions. The run finishes more work per hour **and** spends more
of each child's budget on merge races. Do not report the first without the second.

### Once per repository, before the first lane opens

In the **primary checkout**, in this order, and never again per lane:

1. `git switch main && git pull` — every lane is branched from this ref.
2. `pnpm josh latest:scope`, and the update on `required` — "`josh latest` runs once per session" above.
3. `pnpm josh lane:prune` — closes the lanes an interruption left registered without a work tree.

**`pnpm josh latest` is never run inside a lane, whatever `latest:scope` answers there.** The
elapsed-time window is keyed to the project root, and a lane's project root is its own directory, so a
fresh lane has no stamp, is told `required`, and every lane runs a dependency update. **Ask it in the
primary checkout; in a lane, do not ask at all.**

**The rewritten lock file still has to reach a pull request**, and with lanes no child runs in the
primary checkout to carry it. `git stash` is a repository-level ref shared by every work tree:

```bash
git stash push -u -m "backlogrun: josh latest before lanes"   # primary checkout, only if the update rewrote anything
pnpm josh stash:pop "backlogrun: josh latest before lanes" --dir "$dir"   # the first lane opened, after `lane:open`'s own install
```

Record it on that first child's Issue — the comment is what gets it popped if the run dies in between.
**Pop it by message with `--dir`, never `git -C "$dir" stash pop`**: the stash is a repository-wide
stack every lane shares, so a positional pop would take whichever lane last pushed.

### Opening one lane

```bash
dir=$(pnpm josh lane:open "$n") || exit 1   # the directory on stdout, nothing else; alias: josh lno
pnpm josh stash:pop "backlogrun: josh latest before lanes" --dir "$dir" || exit 1   # the first lane only, and only if `josh latest` stashed
pnpm --dir "$dir" install --frozen-lockfile                 # only after a pop, which changed the lock
```

- **A refusal is an empty capture beside a non-zero exit**, with the reason on standard error: `full`,
  `already-open`, and a **failed install** — which leaves a real work tree behind holding its seat, so
  the next `lane:open` answers `already-open` and never retries. **Park that child and name
  `pnpm josh lane:close <N>`** — a lock the lane cannot build is a state a person fixes. **The guard is
  in the snippet** — without it the next two lines run `--dir ""`.
- **`lane:open` installs; the third line is a *re*-install, and only the popping lane needs it.** A
  failed install fails `lane:open`, so a directory on standard output is the guarantee the lane runs.
- **What the pop changes is the lock, which is why that one lane installs twice.** The pop brings in
  the `pnpm-lock.yaml` that `josh latest` rewrote, which this child's gate must build against. **A pop
  that fails stops the lane** rather than re-installing anyway.
- **A `<N>-lane` that already exists is attached to, and `lane:open` says so on standard error** — the
  way back to a child parked after it pushed: a local branch of that name gets the work tree put on it,
  and where there is none the **remote** is asked (`ls-remote`, fetched first) and the lane cut from
  `origin/<N>-lane` where the branch survives — otherwise from the default branch. **A reused branch is
  not a fresh lane.** Nothing deletes a branch to open a lane, so a reopen cannot cost the pushed work.
- **Nothing switches the lane's branch** — the registry identifies a lane by that branch, so a switch
  costs it its seat, listing and isolation, and `<N>-lane` is already a name `pnpm josh git` commits
  from.
- **`pnpm josh run:hold`'s preflight check is not asked in a lane; `lane:open`'s own answer replaces it.** A fresh
  lane is clean by construction, preflight's `reclaim` arm (HEAD != default branch) is true of every
  lane, and its recovery (`git switch <default>`) cannot run in a linked work tree. What a leftover
  looks like here is `lane:open` answering `already-open`.
- **`pnpm josh run:hold` is unchanged, and is claimed inside the lane** — it keys on
  `git rev-parse --absolute-git-dir` (`.git/worktrees/<name>`), so each lane holds independently.

### Handing the child over

The child runs as `fullrun #<N>` in that lane, and neither `josh latest` nor a progress watcher is
started there. Everything else — the plan, the gate, `/code-review`, `pnpm josh git`,
`pnpm josh followup` — is unchanged, and `pnpm josh followup` releases that lane's hold at the merge.

**The child is started as a process of its own, not as a subagent of this session.** One command does
it, in the lane that was just opened:

```bash
pid=$(pnpm josh lane:dispatch "$n") || exit 1   # the child's pid on stdout, nothing else; alias: josh lnd
```

- **It records where the child writes as it starts it** — the dispatch's own
  `<temp>/josh-lane-dispatch-<N>.log` — so "this lane records no path" is no longer a state the hand-off
  has to except.
- **A refusal is an empty capture beside a non-zero exit**, and every refusal also sends a `warning`
  Telegram — no lane open, a path that could not be recorded, a launch that failed. **Park that child
  and name the log the message carries**; do not re-dispatch into the same lane without reading it.
- **A child that started with nowhere to write exits zero and warns.** The launcher starts the session
  even when it could not open the log, so the child really is running. **Poll that lane on the process
  trace alone**, because its log will never grow.
- **The brief the child used to be handed is now the invocation itself.** The child is started as
  `fullrun #<N>` with the lane as its working directory. The batch a person approved by typing
  `backlogrun` covers the child.
- **It does not pass `--dangerously-skip-permissions`.** What the child may do is the checkout's own
  `.claude/settings.json` to decide; a headless child reaches `gh` and merges through `pnpm josh
  followup` without the flag, and the run reports what stopped rather than loosening it.

**Start each child without blocking on it, and poll them all.** That is "A delegated unit that stopped
without reporting" above applied N times, and `pnpm josh run:liveness <N> --output <path> --process
alive` is read **in that child's lane**. **Run `pgrep -laf "fullrun #<N>$"` first and pass what it
found** — `alive` where the child is there, `none` where it is not, and never `alive` merely because the
child was dispatched. The child's command line is `claude … fullrun #<N>` and carries no path; the `$`
anchor keeps `#12` from matching a running `#123`.

**`git switch main && git pull` is the parent's now, not the child's.** No lane can switch to the
default branch, so the refresh moves to the primary checkout **before each `lane:open`** — the ref the
lane is cut from.

### Conflicts are not predicted

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
the consecutive-failure guard either way — a lost merge race is an ordinary outcome of running many
lanes.

**Nothing is at risk while it resolves, because the work is already committed and pushed.** The pull
request holds the branch, `git merge --abort` puts the tree back, and no step below rewrites a pushed
commit. **The merge direction is `origin/main` into the lane's branch, never a rebase** — a rebase would
rewrite pushed commits and need a force push, which this package denies.

1. **Resolve in the lane.** `git fetch origin main`, merge `origin/main` into the lane's branch, resolve
   in place. Do not close the lane, open another, or switch its branch. **`pnpm josh lane:open` can now
   reattach to a pushed branch**, so a lane closed by mistake here is recoverable; staying put is still
   what keeps the run clear of the question.
2. **Re-run the whole gate.** The tree changed, so the green recorded before the conflict is void:
   `pnpm josh lint:related` and `pnpm josh test:related`, then `pnpm josh gate`.
3. **Review the resolution, one round.** Brief it with `pnpm josh review:brief` and run `/code-review`
   over the resolution diff, then require `pnpm josh review:attest --check` to answer `ok`. That round
   is a different subject and does not spend one of the two the cap allows — `prompts/review.md` →
   "Review round cap" carries the exception.
4. **Conclude the merge and push it, with `pnpm josh git -y`.** Without this step nothing changes on
   `origin`: GitHub still returns `mergeStateStatus: DIRTY`, step 5 reports the same conflict, and
   condition 3 reads that as a second one and parks the child for good. The distributed
   `.claude/settings.json` denies `Bash(git commit*)` and `Bash(git add*)`, so the node script is the
   only sanctioned way. **Record the resolution on the Issue in this same step** — a comment naming the
   conflicting paths — because condition 3 counts resolutions off the Issue comments, not off memory.
5. **Merge**, by re-running `pnpm josh followup` exactly as before.

**The safeguard is the re-run verification, not who holds the pen.** What is dangerous is unreviewed
code merging onto a branch whose review has converged, and that happens identically whichever hand did
the work — so routing the decision to a person does not address it, while re-running the gate and the
review does. **In this repository routing it to a person does not even resolve it**: the user does not
read code, so a code-level conflict handed over is a deferral rather than a decision.

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
it was — and its lane is **kept**, because the pushed branch is the resume path (the table below).

**Leave the tree clean before parking: `git merge --abort` precedes a park under conditions 1, 2 or 4.**
Conditions 1 and 2 are read mid-merge with conflict markers still in the tree, condition 4 after a merge
that is resolved but not committed; condition 3 fires before any merge is started, so there is nothing
to abort.

### What happens to a lane

| When | The lane | Why |
| --- | --- | --- |
| The child **merged** | `pnpm josh lane:close <N>` | `followup` released the hold and the branch is on `main`; nothing in that tree is wanted |
| The child was **parked before its commit** | `git -C <dir> stash push -u -m "backlogrun: parked #<N>"`, record it on the Issue, then `pnpm josh lane:close <N>` | The stash is a repository-level ref, so it outlives the work tree — and `lane:close` is a **forced** removal that would otherwise take the work. `epic:next` counts a parked child's lane as released, so a lane left open holds a seat the count believes is free |
| The child was **parked after its commit and push** | **Left open**, its directory and held seat recorded on the Issue | The stash step is a **no-op** (tree clean because committed). What `lane:close` would take is the **local branch**, which is the resume path |
| The child hit a **merge conflict** | **Left open** — the resolution happens in it | The child resolves in place ("Conflicts are not predicted"). Closing it would delete the local branch the pull request carries — **`lane:open` does now put that branch back**, so a mistaken close is recoverable. A park under that section's four conditions takes the row above |
| The child stopped on **`needs-human-review`** | **Left open and untouched** | The uncommitted work *is* the artifact a person has to look at. Name the lane directory in the stop report and in the Telegram |
| The child **failed** | Whichever of the two parked rows applies, plus the consecutive-failure count | Same reasoning; only the counter differs. **A merge conflict is not this row** — it takes the row above, and it is not counted |
| **`lane:open` failed on the install** | `pnpm josh lane:close <N>`, then park the child | A lane exists that no `pnpm josh …` runs in and the next `lane:open` answers `already-open`. Closing frees the seat; parking is right because the cause is one a person fixes. Carry pnpm's reason into the park note |
| The run was **interrupted** | Nothing to do — the work tree survives on disk | The next session's `pnpm josh lane:prune` closes what git no longer has a tree for. **Park that child**, naming the lane and `pnpm josh lane:close <N>` as the way out |

**A committed child's lane is kept because it is the cheapest resume, not because closing it is final.**
`lane:close` follows the work-tree removal with `git branch -D <N>-lane` (the force flag is there so an
unmerged lane branch goes too), and resume is a re-run of `pnpm josh followup`, which reads the branch
**locally** (a `git diff` against the merge base) — so with no local branch the gate cannot be
re-evaluated. Keeping the lane is worth a seat: the tree, the branch and its `node_modules` are still
there, and the resume is one command.

**What is no longer true is that closing it is unrecoverable.** `pnpm josh lane:open <N>` now attaches
to a `<N>-lane` that exists locally and creates one from `origin/<N>-lane` where only the remote has it,
saying on standard error which it reused. So a lane closed after a push is reopened rather than lost.
**The branch still has to have reached the remote for that to hold** — a child parked before its commit
has nothing on `origin`, which is why that row stashes first and this one does not.

**Which row a child takes is decided by what `followup` printed, not by reading the situation.** **What
it prints is `PR checks failed (merge conflict)`** — that string is what reaches you;
`mergeStateStatus: DIRTY` is the internal spelling `git-pr-checks-eval.ts` compares against, never an
output line to search for. That string sends the child to resolve the conflict in the lane it is
standing in. Do not grep the output for `mergeable_state`: that is the REST field name, normalized away
before anything prints it. **Every after-commit park now keeps its lane, with no exception left in this
table.**

**A kept lane holds its seat, and that is the price rather than an oversight.** Seats are read back out
of the live work trees, so `lane:open` answers `full` rather than handing out ports twice. The optimism
is `epic:next`'s — it counts a parked child as having released its lane — and it costs one child offered
that cannot get a lane, which is visible and recoverable. **Say it in the park comment**: the lane
directory, that its seat is held, and `pnpm josh lane:close <N>` as the way to give it back.

**Release the hold on either parked arm, and leave the lane before closing it.** `pnpm josh followup`
releases the working-tree hold at the **merge**, so a parked child's is still held: run
`pnpm josh run:release <N>` in the lane — **a release names the run it belongs to**, and the child's own
number is what that record carries. **A `needs-human-review` stop is not a park and keeps its hold.**
`lane:close` does not release the hold for you — the record is keyed to the work tree's git directory,
so removing the tree strands it. And `cd` out of the lane **before** `pnpm josh lane:close <N>`: the
close removes the directory the shell is sitting in.

**A `needs-human-review` stop ends the run, and the lanes already in flight are allowed to finish.** No
new lane is opened, but killing units mid-gate would strand as many trees as there are lanes. When the
others have merged or parked, report and stop.

### CI concurrency

Past a GitHub account's concurrency entitlement, jobs **queue** rather than fail, which could cancel out
what the lanes bought; **`JOSH_LANE_LIMIT` lowers the ceiling with no code**. `ci.yml`'s concurrency
group is keyed on `${{ github.ref }}`, so N lanes on N branches are N independent groups and no lane
cancels another's run. Whether queueing bites is read from the multi-day backlog timing report — a
`checks-wait` that grows with the lane count is the queueing.
