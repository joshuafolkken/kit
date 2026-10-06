# `backlogrun` — lanes and concurrency

**Read this file in full before the first lane opens** — in the turn that reaches
`pnpm josh lane:open`. It is a point-of-use document, never an entry read: the entry procedure is
`backlogrun.md`, which points here at that step. This file is the single source of the per-repository
lane ceiling, the lane lifecycle, and how a merge conflict between lanes is resolved.

## Concurrency: as many children per repository as it has free lanes

**An `backlogrun` need not be a single session.** One session per repository; each calls
`josh epic:next <E> --repo <owner/repo>` and runs only its own repository's children.

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
blocker repository's manifest, never from the registry.

**The lane count is per repository, and `epic:next` is what applies it.** When it has a child to offer,
it first asks that repository **how many of its lanes are already running something**: every open issue
carrying `in-progress` and not parked counts for one — whichever epic it belongs to. What is left of
`JOSH_LANE_LIMIT` (**default 6**) is what gets offered, and at zero the answer is `wait`. It is asked
**only when there is a candidate**. A **parked** issue does not hold a lane: `needs-decision` outranks
`in-progress` here exactly as in the classification. A child stopped by `needs-human-review` is
deliberately not parked and goes on holding its lane.

**It is advisory and not atomic.** The label is applied when a child is dispatched — the parent claims
it in `lane:dispatch` before the child process starts, and a standalone `fullrun` / `halfrun` claims it
the moment `run:hold` answers `hold` — *after* this read. It is a guard, not a mutex.

**It is scoped to the resource, not the epic.** A lane is its own checkout with its own branch and
ports, so the repository-wide number is a **ceiling on how many lanes run at once**. How a session
drives more than one child at a time is "Lanes — running more than one child at a time" below.

**A stale label holds a lane, so the stale rule reaches past this epic's own children** — `backlogrun-park.md` →
"`in-progress` is removed by whoever finds it stale" applies to **any** open issue in the repository. `epic:next`
names the holders on standard error, and the 90-minute stale window bounds the wait.

**A listing it could not read is not an idle repository.** `epic:next` answers `wait` there rather than
offering the child. **A listing that was *cut short* is the same answer**: a short one with no visible
holder is `wait`, with its own message.

**Two children of one repository may run at once, and the section below is how.** The guard is a
ceiling rather than a prohibition, scoped to the lane rather than to the epic. **Do not read this as
"concurrency needs no coordination"**: the coordination is this section plus the one below, and
switching the guard off is not one of the ways to get parallelism.

Parallelism only helps children that do not depend on each other. When app-kit's child needs kit's new
feature, that is recorded as `blocked-by` and `epic:next` makes it wait.

Rationale: `docs/maintainers/backlogrun-lanes-rationale.md` → "Why the lane ceiling is shaped the way
it is".

## Lanes — running more than one child at a time

`pnpm josh epic:next <E> --repo <owner/repo> --lanes` answers with **one issue number per line**, up to
the number of free lanes, and each of those children runs in a **lane** of its own: a linked git work
tree with its own branch, its own `.env` and its own dev and preview ports (`docs/josh-commands-run.md` →
"`josh lane:open` / `josh lane:close` / `josh lane:list` / `josh lane:prune`"). **Implementation, the
verification gate and the review run in parallel; the merges stay serial** — each one lands on the
`main` the next is then measured against.

**A lane child may cut its own turn before the gate.** Implementation done, it ends its process and a
fresh one resumes the same lane from the gate onward — the boundary, the two commands and the resume
verification are `pre-gate-cut.md`, the single source. **The child is told apart from a person, and its
resume stage is handed to it, by a mark the dispatch sets** — `JOSH_LANE_CHILD`, the lane's issue
number (`pre-gate-cut.md` → "The dispatch mark" and "The stage is passed to the resumed child").

**One kind of child takes no lane beside anything: a defect in kit's own verification that makes
unrelated PRs answer wrongly on `main` today.** It runs alone, and the batch resumes only once it has
merged. **Decide it from three conditions that must all hold, never from how serious it looks** — is
it a defect (not an improvement, refactor, removal or feature)? Is it in kit's own verification gate
(lint / type check / spell check / unit tests), the code review, the pre-push hook, or the merge
checks — not a consumer repository's CI or template? Does it, on `main` now, make unrelated PRs
answer wrongly (a false green or a false red)? All three, and the issue carries `run:solo`; any one
missing, and it carries `run:lane` and fills a lane like any other child. `backlog:next` and `epic:next --lanes` enforce both (joshuafolkken/kit#2776,
#2779), and an issue a run files (an interrupt, a split child, a prerequisite) carries one of the
two from its filing, because an issue with neither answers `triage` and nothing starts. **It stops
the other lanes for one reason only: a batch run on broken verification leaves nobody's result
trustworthy** — that the issue's own verification sits under the defect is the issue's own concern,
checked by the verification after the fix. This paragraph is the rule's single source; rationale:
`docs/maintainers/wip-cap-rationale.md` → 「単独実行の理由と由来」.

**A lane's review does not inherit the lane, and `pnpm josh review:brief` is what closes that.**
`pnpm josh review:brief` prints the lane's absolute root, branch and HEAD, hands over targets written
`git -C <root> …`, and prints a nonce the review attests with `pnpm josh review:attest <nonce>` from
the checkout it actually read. **The child asks `pnpm josh review:attest --check` before it counts a
round**, and `pnpm josh followup` asks again before it merges; `missing` and `mismatch` are both
refusals. A clean round is the case to check hardest, not the case to skip the check on. Rationale:
`docs/maintainers/backlogrun-lanes-rationale.md` → "Why a lane's review needs a brief and an
attestation".

**A lane's branch is `<N>-lane`, and the issue number leads it so that the commit path accepts it.**
**Never switch the lane to another branch** — a switched lane loses its seat, its listing and its
isolation. So `epic:next` is asked **with** `--lanes`, and everything below runs as written. Rationale:
`docs/maintainers/backlogrun-lanes-rationale.md` → "Why the lane branch is `<N>-lane` and never
switched".

**Report the throughput gain only with its merge-race cost** — every overlap that becomes a conflict
costs a resolution, a re-run gate and a review (`backlogrun-recovery.md` → "Conflicts are not predicted"). Rationale:
`docs/maintainers/backlogrun-lanes-rationale.md` → "Why lanes cost as well as buy throughput".

### Once per repository, before the first lane opens

In the **primary checkout**, in this order, and never again per lane:

1. `git switch main && git pull` — every lane branches from this ref.
2. `pnpm josh latest:scope`, and the update on `required` — `backlogrun-child.md` → "`josh latest`
   runs once per session, not once per child".
3. `pnpm josh lane:prune` — closes the lanes an interruption left registered without a work tree.
4. `pnpm josh run:tidy` — sweeps merged lanes and stashes (as `run:hold` does).

**`pnpm josh latest` is never run inside a lane, whatever `latest:scope` answers there** — the command
enforces it: `latest:scope` answers `skip` in a lane and `pnpm josh latest` refuses outright, fronted
by `pnpm josh latest:guard`. Ask it in the primary checkout, per step 2 above.

**The rewritten lock file still has to reach a pull request**, and with lanes no child runs in the
primary checkout to carry it. `git stash` is a repository-level ref shared by every work tree:

```bash
git stash push -u -m "backlogrun: josh latest before lanes"   # primary checkout, only if the update rewrote anything
```

Record it on that first child's Issue — the comment is what gets it popped if the run dies in between.
**The first lane's `pnpm josh lane:launch "$n" --stash "backlogrun: josh latest before lanes"` pops it
by message, after `lane:open`'s own install** — never a positional `git -C "$dir" stash pop`: the stash
is a repository-wide stack every lane shares, so a positional pop would take whichever lane last pushed.
**Under the supervisor's `backlog:drive` the driver passes it, never you**:
each launch asks whether a stash under that message is on the stack and, if one is, hands it to
`lane:launch --stash` — the pop consumes it, so the first lane takes it and every later one launches
without. The push above stays the parent's, before the driver starts.

### Opening one lane and dispatching its child

**One command opens the lane, prepares it, and dispatches the child — `pnpm josh lane:launch`.** It
runs `lane:open`, then — only when `--stash` is given, which is the first lane alone — pops that stash
into the lane and re-installs against the lock it brought in, then `lane:dispatch`:

```bash
pid=$(pnpm josh lane:launch "$n") || exit 1   # the child's pid on stdout, nothing else
pid=$(pnpm josh lane:launch "$n" --stash "backlogrun: josh latest before lanes") || exit 1   # the first lane only, and only if `josh latest` stashed
```

`lane:launch` is a thin layer over `lane:open`, `stash:pop` and `lane:dispatch`, so each of their
guards, refusals and messages holds unchanged; the bullets below describe the steps it runs.
Rationale: `docs/maintainers/backlogrun-lanes-rationale.md` → "Why `lane:launch` folds the lane steps
into one".

- **A refusal is an empty capture beside a non-zero exit**, with the reason on standard error: `full`,
  `already-open`, and a **failed install** — which leaves a real work tree behind holding its seat, so
  the next launch answers `already-open` and never retries. **Park that child and name
  `pnpm josh lane:close <N>`** — a lock the lane cannot build is a state a person fixes. A refused
  `lane:open`, a pop that refused, or a failed re-install each **stop the launch before the child is
  dispatched**.
- **`lane:open` installs; the `--stash` lane re-installs, and only that lane needs it.** A failed
  install fails `lane:open`, so `lane:launch` reaching `lane:dispatch` is the guarantee the lane runs.
  **A pop that fails stops the lane** rather than re-installing anyway.
- **A `<N>-lane` that already exists is attached to, and `lane:open` says so on standard error** — the
  way back to a child parked after it pushed: a local branch of that name gets the work tree put on it,
  and where there is none the **remote** is asked (`ls-remote`, fetched first) and the lane cut from
  `origin/<N>-lane` where the branch survives — otherwise from the default branch. **A reused branch is
  not a fresh lane.** Nothing deletes a branch to open a lane, so a reopen cannot cost the pushed work.
- **Nothing switches the lane's branch.**
- **`pnpm josh run:hold`'s preflight check is not asked in a lane; `lane:open`'s own answer replaces it.**
  What a leftover looks like here is `lane:open` answering `already-open`.
- **`pnpm josh run:hold` is unchanged, and is claimed inside the lane** — it keys on
  `git rev-parse --absolute-git-dir` (`.git/worktrees/<name>`), so each lane holds independently.

### Handing the child over

The child runs as `fullrun #<N>` in that lane, and neither `josh latest` nor a progress watcher is
started there. Everything else — the plan, the gate, `/code-review`, `pnpm josh git`,
`pnpm josh followup` — is unchanged, and `pnpm josh followup` releases that lane's hold at the merge.

**The child is started as a process of its own, not as a subagent of this session** — `lane:launch`'s
final step, the `lane:dispatch` it runs after the lane is opened and prepared, whose pid it returns.
The bullets below describe that dispatch:

- **It records where the child writes as it starts it** — the dispatch's own
  `<temp>/josh-lane-dispatch-<N>.log`.
- **A refusal is an empty capture beside a non-zero exit**, and every refusal also sends a `warning`
  Telegram — no lane open, a path that could not be recorded, a launch that failed. **Park that child
  and name the log the message carries**; do not re-dispatch into the same lane without reading it.
- **A child that started with nowhere to write exits zero and warns.** The launcher starts the session
  even when it could not open the log, so the child really is running. **Poll that lane on the process
  trace alone**, because its log will never grow.
- **The child is started as `fullrun #<N>` with the lane as its working directory.** The batch a
  person approved by typing `backlogrun` covers the child.
- **It does not pass `--dangerously-skip-permissions`.** What the child may do is the checkout's own
  `.claude/settings.json` to decide; a headless child reaches `gh` and merges through `pnpm josh
  followup` without the flag, and the run reports what stopped rather than loosening it.

**Start each child without blocking on it, and poll them all.** That is `backlogrun-child.md` → "A
delegated unit that stopped without reporting" applied N times, and `pnpm josh run:liveness <N>
--output <path> --process alive` is read **in that child's lane**. **Run
`pgrep -laf "(fullrun|run-ship-cli\.ts .*) #<N>$"` first and pass what it found** — `alive` where the
child is there, `none` where it is not, and never `alive` merely because the child was dispatched. The
command line carries no path; the `$` anchor keeps `#12` from matching a running `#123`.

**`git switch main && git pull` is the parent's now, not the child's.** No lane can switch to the
default branch, so the refresh moves to the primary checkout **before each `lane:open`** — the ref the
lane is cut from.

### Conflicts are not predicted

**A child whose pull request conflicts with `main` resolves it in its own lane rather than stopping** —
read `backlogrun-recovery.md` → "Conflicts are not predicted" when `pnpm josh followup` reports the
conflict.

### What happens to a lane

| When | The lane | Why |
| --- | --- | --- |
| The child **merged** | `pnpm josh lane:close <N>` | `followup` released the hold and the branch is on `main`; nothing in that tree is wanted |
| The child was **parked before its commit** | **Left open**, its uncommitted work in place, its directory and held seat recorded on the Issue | The stash stack is shared by every work tree, so a parallel lane can pop another's entry — the tree itself is the safe place for the work. `lane:close` is a **forced** removal that would take it. `pnpm josh lane:launch <N>` dispatches the released child into the kept lane rather than refusing it as `already-open` — only a lane a child was already dispatched into; a failed-install lane is still refused |
| The child was **parked after its commit and push** | **Left open**, its directory and held seat recorded on the Issue | The tree is clean because committed. What `lane:close` would take is the **local branch**, which is the resume path |
| The child hit a **merge conflict** | **Left open** — the resolution happens in it | The child resolves in place (`backlogrun-recovery.md` → "Conflicts are not predicted"). A park under that section's four conditions takes the row above |
| The child stopped on **`needs-human-review`** | **Left open and untouched** | The uncommitted work *is* the artifact a person has to look at. Name the lane directory in the stop report and in the Telegram |
| The child **failed** | Whichever of the two parked rows applies, plus the consecutive-failure count | Same reasoning; only the counter differs. **A merge conflict is not this row** — it takes the row above, and it is not counted |
| **`lane:open` failed on the install** | `pnpm josh lane:close <N>`, then park the child | A lane exists that no `pnpm josh …` runs in and the next `lane:open` answers `already-open`. Closing frees the seat; parking is right because the cause is one a person fixes. Carry pnpm's reason into the park note |
| The run was **interrupted** | Nothing to do — the work tree survives on disk | The next session's `pnpm josh lane:prune` closes what git no longer has a tree for. **Park that child**, naming the lane and `pnpm josh lane:close <N>` as the way out |

**A lane closed after a push is reopened by `pnpm josh lane:open <N>`**, which attaches to a local
`<N>-lane` or creates one from `origin/<N>-lane`, saying on standard error which it reused. **The branch
still has to have reached the remote for that to hold** — a child parked before its commit has nothing
on `origin`, which is why that row keeps its lane open rather than closing it. Rationale:
`docs/maintainers/backlogrun-lanes-rationale.md` → "Why a committed child's lane is kept".

**Which row a child takes is decided by what `followup` printed, not by reading the situation.** **What
it prints is `PR checks failed (merge conflict)`** — that string is what reaches you;
`mergeStateStatus: DIRTY` is the internal spelling `git-pr-checks-eval.ts` compares against, never an
output line to search for. That string sends the child to resolve the conflict in the lane it is
standing in. Do not grep the output for `mergeable_state`: that is the REST field name, normalized away
before anything prints it.

**A kept lane holds its seat. Say it in the park comment**: the lane directory, that its seat is held,
and `pnpm josh lane:close <N>` as the way to give it back.

**Release the hold on either parked arm, and leave the lane before closing it.** `pnpm josh followup`
releases the working-tree hold at the **merge**, so a parked child's is still held: run
`pnpm josh run:release <N>` in the lane — **a release names the run it belongs to**, and the child's own
number is what that record carries. **A `needs-human-review` stop is not a park and keeps its hold.**
`lane:close` does not release the hold for you — the record is keyed to the work tree's git directory,
so removing the tree strands it. And `cd` out of the lane **before** `pnpm josh lane:close <N>`: the
close removes the directory the shell is sitting in.

**A `needs-human-review` stop ends the run, and the lanes already in flight are allowed to finish.** No
new lane is opened, and no unit is killed mid-gate. When the others have merged or parked, report and
stop.

### CI concurrency

**`JOSH_LANE_LIMIT` lowers the ceiling with no code** when CI jobs start to queue. Whether queueing
bites is read from the multi-day backlog timing report — a `checks-wait` that grows with the lane count
is the queueing. Rationale: `docs/maintainers/backlogrun-lanes-rationale.md` → "Why CI concurrency is
capped by the lane limit".
