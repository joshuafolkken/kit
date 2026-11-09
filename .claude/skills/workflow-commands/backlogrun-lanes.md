# `backlogrun` — lanes and concurrency

Point-of-use, read one section at a time from `backlogrun.md` → "The manifest — the ordered flow".

## Concurrency: as many children per repository as it has free lanes

**One session per repository**, each running only its own repository's children. The lane ceiling and a
dependency that crosses a repository are `docs/josh-commands-backlog.md` → "`josh epic:next`".

## A solo run

**One kind of child takes no lane beside anything: a defect in kit's own verification that makes
unrelated PRs answer wrongly on `main` today.** It runs alone, and the batch resumes only once it has
merged. **Ask `pnpm josh backlog:triage --decide --defect <answer> --verification <answer> --every-run <answer>`**
with `yes`, `no` or `unknown` for each condition below, never from how serious it looks. The command
prints `run:solo`, `run:lane`, or `judge` when evidence is missing; `judge` keeps the issue untriaged.
The reader answers the semantic questions; the command computes their conjunction — is
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

To apply `run:solo`, pass all three affirmative answers:

```bash
pnpm josh backlog:triage --apply <N> --solo --defect yes --verification yes --every-run yes --reason <text>
pnpm josh auto-ok:judge --apply <N> --solo --defect yes --verification yes --every-run yes
```

Missing, negative, unknown or invalid answers refuse the entire request before any writes,
including relation changes and park clearing. `--lane` requires no answers.

**A wrong answer that only comes some of the time — a flaky test, a timeout under load — is not a solo
run.** It carries `run:lane` and `priority:critical`, so it leads the next offer while the other lanes
keep running: a flake costs another lane one rerun, less than every lane stopped until it merges.

## Lanes — running more than one child at a time

`pnpm josh epic:next <E> --repo <owner/repo> --lanes` answers **one issue number per line**, up to the
free lanes. Each child runs in a **lane**: a linked work tree with its own branch, `.env` and ports
(`docs/josh-commands-lane.md` → "`josh lane:open` / `josh lane:close` / `josh lane:list` / `josh
lane:prune`"). **Implementation, the verification gate and the review run in parallel; the merges
stay serial.**

**A lane child may cut its own turn before the gate** — `pre-gate-cut.md`, the single source.

**A lane's review counts only once `pnpm josh review:attest --check` answers `ok`** — `chain-rule.md`
→ "The brief names the checkout, and a review that read another one is refused".

**A lane's branch is `<N>-lane`. Nothing switches the lane to another branch**, so `epic:next` is asked
**with** `--lanes`.

**Report the throughput gain only with its merge-race cost** (`backlogrun-recovery.md` → "Conflicts
are not predicted").

### Once per repository, before the first lane opens

`pnpm josh run:prime` in the **primary checkout**, never per lane — its steps are
`docs/josh-commands-run.md` → "`josh run:prime`". **A `stash` line other than `clean` is the first
lane's: record it on the first child's Issue and pass its message to `pnpm josh lane:launch "$n" --stash
"<message>"`**; under `backlog:drive` the driver passes `--stash`, never you.

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

In a lane, `lane:open`'s answer replaces `pnpm josh run:hold`'s preflight; the child claims
`run:hold` inside the lane.

### Handing the child over

The child runs as `fullrun #<N>` in that lane, with neither `josh latest` nor a progress watcher, as a
process of its own (`lane:dispatch`, `lane:launch`'s final step), not as a subagent of this session:

- **It writes to** `<common git dir>/josh/run-state/josh-lane-dispatch-<N>-<key>.log`.
- **A refusal is an empty capture beside a non-zero exit**, with a `warning` Telegram. **Park that
  child and name the log the message carries**; never re-dispatch into the same lane without reading it.
- **A child that started with nowhere to write exits zero and warns** — wait on that lane with
  `lane:await`.
- **`.claude/settings.json`'s `deny` list still applies to the child** — report what it stopped, never
  loosen it.

**Start each child without blocking on it** — the wait, and a silent child:
`backlogrun-recovery.md` → "A delegated unit that stopped without reporting", read in that child's lane.

**`pnpm josh ms` is the parent's now, not the child's** — run it in the primary checkout **before
each `lane:open`**.

### Conflicts are not predicted

**A child whose pull request conflicts with `main` resolves it in its own lane rather than stopping** —
read `backlogrun-recovery.md` → "Conflicts are not predicted" when `pnpm josh followup` reports it.

### What happens to a lane

| When | The lane |
| --- | --- |
| The child **merged** | `pnpm josh lane:close <N>` |
| The child was **parked before its commit** | **Left open**, its uncommitted work in place, its directory and held seat recorded on the Issue; `pnpm josh lane:launch <N>` re-dispatches into it |
| The child was **parked after its commit and push** | **Left open**, its directory and held seat recorded on the Issue — its local branch is the resume path |
| The child hit a **merge conflict** | **Left open** — the resolution happens in it (`backlogrun-recovery.md` → "Conflicts are not predicted"); a park there takes the row above |
| The child stopped on **`needs-human-review`** | **Left open and untouched**, its hold kept — not a park (`backlogrun-park.md` → "`needs-human-review` — the one stop that is not a park") |
| The child **failed** (not a merge conflict) | Whichever of the two parked rows applies, plus the consecutive-failure count |
| **`lane:open` failed on the install** | `pnpm josh lane:close <N>`, then park the child, carrying pnpm's reason into the park note |
| The lane is **spent** | Nothing to do — `pnpm josh lane:prune` closes it |
| The run was **interrupted** | **Park that child**, naming the lane and `pnpm josh lane:close <N>` |

**A lane closed after a push is reopened by `pnpm josh lane:open <N>`** (a local `<N>-lane`, or one
from `origin/<N>-lane`).

**Which row a child takes is decided by what `followup` printed, not by reading the situation** —
`PR checks failed (merge conflict)` resolves in the lane.

**Release the hold on either parked arm, and leave the lane before closing it**: `pnpm josh
run:park <N>` in the lane releases it (**a release names the run it belongs to**); `lane:close` does
not. `cd` out of the lane **before** `pnpm josh lane:close <N>`.

### CI concurrency

**`JOSH_LANE_LIMIT` lowers the ceiling with no code** when CI jobs queue — a `checks-wait` growing
with the lane count in the backlog timing report.
