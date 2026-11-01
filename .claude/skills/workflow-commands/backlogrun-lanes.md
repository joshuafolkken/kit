# `backlogrun` — lanes and concurrency

Point-of-use, read one section at a time from `backlogrun.md` → "The manifest — the ordered flow".

## Concurrency: as many children per repository as it has free lanes

**One session per repository**, each running only its own repository's children. The lane ceiling and a
dependency that crosses a repository are `docs/josh-commands-backlog.md` → "`josh epic:next`".

## A solo run

**One kind of child takes no lane beside anything: a defect in kit's own verification that makes
unrelated PRs answer wrongly on `main` today.** It runs alone, and the batch resumes only once it has
merged. **Decide it from three conditions that must all hold, never from how serious it looks** — is
it a defect (not an improvement, refactor, removal or feature)? Is it in kit's own verification gate
(lint / type check / spell check / unit tests), the code review, the pre-push hook, or the merge
checks — not a consumer repository's CI or template? Does it, on `main` now, make unrelated PRs
answer wrongly (a false green or a false red) **on every run**? All three, and the issue carries
`run:solo`; any one missing, and it carries `run:lane`. `backlog:next` and `epic:next --lanes` answer
`triage` for an issue with neither, so a filed issue carries one of the two from its filing. **It stops
the other lanes for one reason only: a batch run on broken verification leaves nobody's result
trustworthy.**

`backlog:next` labels `run:lane` itself where the first two conditions fail
(`docs/josh-commands-backlog.md` → "`josh backlog:next`").

**A wrong answer that only comes some of the time — a flaky test, a timeout under load — is not a solo
run.** It carries `run:lane` and `priority:critical`, so it leads the next offer while the other lanes
keep running: a flake costs another lane one rerun, less than every lane stopped until it merges.

## Lanes — running more than one child at a time

`pnpm josh epic:next <E> --repo <owner/repo> --lanes` answers **one issue number per line**, up to the
free lanes. Each child runs in a **lane**: a linked work tree with its own branch, `.env` and ports
(`docs/josh-commands-run.md` → "`josh lane:open` / `josh lane:close` / `josh lane:list` / `josh
lane:prune`"). **Implementation, the verification gate and the review run in parallel; the merges
stay serial.**

**A lane child may cut its own turn before the gate** — `pre-gate-cut.md`, the single source. The
child is told apart from a person, and handed its resume stage, by `JOSH_LANE_CHILD`
(`docs/josh-commands-run.md` → "`josh run:cut`"; `pre-gate-cut.md` → "The stage is passed to the resumed child").

**A lane's review does not inherit the lane, and `pnpm josh review:brief` is what closes that**: it
prints the lane's root, branch and HEAD, targets written `git -C <root> …`, and a nonce the review
attests with `pnpm josh review:attest <nonce>`. **The child asks `pnpm josh review:attest --check`
before it counts a round**, and `pnpm josh followup` asks again before merging; `missing` and
`mismatch` are refusals. A clean round is checked hardest.

**A lane's branch is `<N>-lane`. Never switch the lane to another branch** — it loses its seat,
listing and isolation. So `epic:next` is asked **with** `--lanes`.

**Report the throughput gain only with its merge-race cost** (`backlogrun-recovery.md` → "Conflicts
are not predicted").

### Once per repository, before the first lane opens

In the **primary checkout**, in order, never per lane: `pnpm josh ms`; `pnpm josh latest:if-required`
(`backlogrun-child.md` → "`josh latest` runs once per session, not once per
child"); `pnpm josh lane:prune`; `pnpm josh run:tidy`.

**The rewritten lock file reaches a pull request through the first lane.** Only if the update rewrote
anything: `pnpm josh stash:push "backlogrun: josh latest before lanes"` in the primary checkout, and
record it on the first child's Issue. **The first lane's `pnpm josh lane:launch "$n" --stash
"backlogrun: josh latest before lanes"` pops it by message.** **Under
`backlog:drive` the driver passes `--stash`, never you**; the push stays the parent's.

### Opening one lane and dispatching its child

**One command opens the lane, prepares it, and dispatches the child — `pnpm josh lane:launch`**:

```bash
pid=$(pnpm josh lane:launch "$n") || exit 1   # the child's pid on stdout, nothing else
```

| It answers | What the run does |
| --- | --- |
| a pid | The child runs; wait on it with `lane:await` |
| empty, non-zero, `full` | No free lane; wait for one |
| empty, non-zero, `already-open` or a failed install | **Park that child and name `pnpm josh lane:close <N>`** — a lock the lane cannot build is a person's to fix |
| `lane:open` reports a reused `<N>-lane` on stderr | The way back to a child parked after it pushed — **a reused branch is not a fresh lane** |

**Nothing switches the lane's branch.** In a lane, `lane:open`'s answer replaces `pnpm josh
run:hold`'s preflight; the child claims `run:hold` inside the lane.

### Handing the child over

The child runs as `fullrun #<N>` in that lane, with neither `josh latest` nor a progress watcher.
Everything else is unchanged; `pnpm josh followup` releases the lane's hold at the merge.

**The child is started as a process of its own, not as a subagent of this session** (`lane:dispatch`,
`lane:launch`'s final step):

- **It records where the child writes** — `<common git dir>/josh/run-state/josh-lane-dispatch-<N>-<key>.log`, which survives a reboot.
- **A refusal is an empty capture beside a non-zero exit**, with a `warning` Telegram. **Park that
  child and name the log the message carries**; never re-dispatch into the same lane without reading it.
- **A child that started with nowhere to write exits zero and warns** — **wait on that lane with
  `lane:await`, which reads the process trace alone**.
- **The child is started as `fullrun #<N>` with the lane as its working directory**; the typed
  `backlogrun` covers it.
- **It passes `--permission-mode bypassPermissions`, never `--dangerously-skip-permissions`.**
  `.claude/settings.json`'s `deny` list still refuses what it names; report what stopped, never loosen it.

**Start each child without blocking on it, then wait on `backlog:drive` or `lane:await`**
(`scripts/run/run-poll-hook.ts`) — a silent one is
`backlogrun-recovery.md` → "A delegated unit that stopped without reporting", read in that child's lane.

**`pnpm josh ms` is the parent's now, not the child's** — run it in the primary checkout **before
each `lane:open`**.

### Conflicts are not predicted

**A child whose pull request conflicts with `main` resolves it in its own lane rather than stopping** —
read `backlogrun-recovery.md` → "Conflicts are not predicted" when `pnpm josh followup` reports it.

### What happens to a lane

| When | The lane | Why |
| --- | --- | --- |
| The child **merged** | `pnpm josh lane:close <N>` | Nothing in that tree is wanted |
| The child was **parked before its commit** | **Left open**, its uncommitted work in place, its directory and held seat recorded on the Issue | The shared stash stack is unsafe; `lane:close` is a **forced** removal. `pnpm josh lane:launch <N>` re-dispatches into the kept lane (a failed-install lane is still refused) |
| The child was **parked after its commit and push** | **Left open**, its directory and held seat recorded on the Issue | `lane:close` would take the **local branch**, the resume path |
| The child hit a **merge conflict** | **Left open** — the resolution happens in it | `backlogrun-recovery.md` → "Conflicts are not predicted"; a park there takes the row above |
| The child stopped on **`needs-human-review`** | **Left open and untouched** | The uncommitted work is what a person looks at. `run:hold <N> --human-review-stop` names the lane directory in the Telegram; the stop report names it too |
| The child **failed** | Whichever of the two parked rows applies, plus the consecutive-failure count | **A merge conflict is not this row**, and is not counted |
| **`lane:open` failed on the install** | `pnpm josh lane:close <N>`, then park the child | Frees the seat; a person fixes the cause. Carry pnpm's reason into the park note |
| The lane is **spent** — no child working in it, its Issue closed, not one this run launched and has not collected with `run:merge`, a clean tree, no commit that is on no remote | Nothing to do — `pnpm josh lane:prune` closes it | Any other lane is kept, with the reason on standard error |
| The run was **interrupted** | Nothing to do — the work tree survives on disk | **Park that child**, naming the lane and `pnpm josh lane:close <N>` |

**A lane closed after a push is reopened by `pnpm josh lane:open <N>`** (a local `<N>-lane`, or one
from `origin/<N>-lane`). A child parked before its commit has nothing on `origin`, so its lane stays open.

**Which row a child takes is decided by what `followup` printed, not by reading the situation.** **What
it prints is `PR checks failed (merge conflict)`** — resolve in the lane. Never search for
`mergeStateStatus: DIRTY` or `mergeable_state`; neither is printed.

**A kept lane holds its seat. Say it in the park comment**: the lane directory, that its seat is held,
and `pnpm josh lane:close <N>` to give it back.

**Release the hold on either parked arm, and leave the lane before closing it**: `pnpm josh
run:park <N>` in the lane releases it (**a release names the run it belongs to**); `lane:close` does
not. `cd` out of the lane **before** `pnpm josh lane:close <N>`. **A `needs-human-review` stop is
not a park and keeps its hold.**

**A `needs-human-review` stop ends only its child** — its lane stays in use; the parent keeps
launching children in the remaining free lanes (`backlogrun-park.md`).

### CI concurrency

**`JOSH_LANE_LIMIT` lowers the ceiling with no code** when CI jobs queue — a `checks-wait` growing
with the lane count in the backlog timing report.
