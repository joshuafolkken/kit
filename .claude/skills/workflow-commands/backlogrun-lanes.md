# `backlogrun` — lanes and concurrency

Point-of-use, read one section at a time from `backlogrun.md` → "The route table".

## Concurrency: as many children per repository as it has free lanes

**One session per repository**, each running only its own repository's children; the per-repository
lane ceiling (`JOSH_LANE_LIMIT`, counted from the `in-progress` listing by `epic:next`) is
`.claude/skills/epic-commands/SKILL.md` → "An `in-progress` issue occupies a lane", and a dependency that crosses a
repository is `.claude/skills/epic-commands/SKILL.md` → "Epics that span repositories". Rationale:
`docs/maintainers/backlogrun-lanes-rationale.md` → "Why the lane ceiling is shaped the way it is".

## A solo run

**One kind of child takes no lane beside anything: a defect in kit's own verification that makes
unrelated PRs answer wrongly on `main` today.** It runs alone, and the batch resumes only once it has
merged. **Decide it from three conditions that must all hold, never from how serious it looks** — is
it a defect (not an improvement, refactor, removal or feature)? Is it in kit's own verification gate
(lint / type check / spell check / unit tests), the code review, the pre-push hook, or the merge
checks — not a consumer repository's CI or template? Does it, on `main` now, make unrelated PRs
answer wrongly (a false green or a false red)? All three, and the issue carries `run:solo`; any one
missing, and it carries `run:lane`. `backlog:next` and `epic:next --lanes` answer `triage` for an issue
with neither, so an issue a run files carries one of the two from its
filing. **It stops the other lanes for one reason only: a batch run on broken verification leaves
nobody's result trustworthy.** This section is the rule's single source; rationale:
`docs/maintainers/wip-cap-rationale.md` → "Why a solo run"; provenance:
`docs/maintainers/backlogrun-lanes-rationale.md` → "Where each rule came from".

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

In the **primary checkout**, in this order, never again per lane: `pnpm josh ms`; `pnpm josh
latest:scope` and the update on `required` (`backlogrun-child.md` → "`josh latest` runs once per
session, not once per child"); `pnpm josh lane:prune`; `pnpm josh run:tidy`.

**The rewritten lock file reaches a pull request through the first lane.** In the primary checkout,
only if the update rewrote anything, `git stash push -u -m "backlogrun: josh latest before lanes"`, and
record it on that first child's Issue. **The first lane's `pnpm josh lane:launch "$n" --stash
"backlogrun: josh latest before lanes"` pops it by message** — never a positional `stash pop` on the
shared stack. **Under `backlog:drive` the driver passes `--stash`, never you**; the push stays the
parent's, before the driver starts.

### Opening one lane and dispatching its child

**One command opens the lane, prepares it, and dispatches the child — `pnpm josh lane:launch`** (over
`lane:open`, `stash:pop` and `lane:dispatch`, each guard unchanged; rationale:
`docs/maintainers/backlogrun-lanes-rationale.md` → "Why `lane:launch` folds the lane steps into one"):

```bash
pid=$(pnpm josh lane:launch "$n") || exit 1   # the child's pid on stdout, nothing else
```

| It answers | What the run does |
| --- | --- |
| a pid | The child runs; poll it |
| empty, non-zero, `full` | No free lane; wait for one |
| empty, non-zero, `already-open` or a failed install | **Park that child and name `pnpm josh lane:close <N>`** — a lock the lane cannot build is a person's to fix |
| `lane:open` reports a reused `<N>-lane` on stderr | The way back to a child parked after it pushed — **a reused branch is not a fresh lane** |

**Nothing switches the lane's branch.** In a lane `lane:open`'s answer replaces `pnpm josh run:hold`'s
preflight, and the child claims `run:hold` inside the lane, keyed on its own git directory.

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

**Start each child without blocking on it, and poll them all** — a silent one is
`backlogrun-recovery.md` → "A delegated unit that stopped without reporting", read in that child's
lane.

**`pnpm josh ms` is the parent's now, not the child's.** No lane can switch to the
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
