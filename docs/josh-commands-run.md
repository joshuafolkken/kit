# josh CLI — Run Lifecycle Command Reference

The commands a run and its lanes call to hold, step, cut, merge and ship. Reports, the board and handoff: `docs/josh-commands-board.md`; lanes: `docs/josh-commands-lane.md`; session budget and document reading: `docs/josh-commands-session.md`. Where each command came from: `docs/maintainers/josh-commands-run-rationale.md` → "Where each command came from".

A `<!-- usage: … -->` span is generated — its summary line from the command's registry `description` and the rest from its `usage` (both in `scripts/josh/josh-commands-*.ts`), by `pnpm josh command:derive` — edit the entry, not the span.

## Run lifecycle

### `josh run:hold` / `josh run:release`

<!-- usage: run:hold -->

Claim this working tree for a run, or say which run already holds it.

```bash
pnpm josh run:hold 1091             # claim for issue 1091
pnpm josh run:hold 1091 --fullrun   # claim as `fullrun #1091` (what `run:entry` runs)
pnpm josh run:hold --adopt 1091     # hand a `new` run's hold to the issue it filed
```

**Options:**

- `--fullrun` — marks the record as `fullrun #N`'s.
- `--adopt <issue>` — re-keys the unnumbered `new` run's record to the filed issue and applies `in-progress`; answers `none` (exit 1) when the tree holds no record.
- `--halfrun-stop` — marks a `halfrun` stop for `run:entry` to adopt, and sends its `confirmation` Telegram; answers `e2e-owed` (exit 1) until `test:e2e` answered green on this tree.
- `--human-review-stop` — marks a `halfrun` stop and a `human-review` lane, retaining its tree and hold. Sends `confirmation`; its worker's exit frees the execution place. Answers `e2e-owed` (exit 1) until `test:e2e` is green on this tree.
- `--prrun-stop` — marks a `prrun` stop with the commit its pull request is on, and sends its `confirmation` Telegram.

<!-- /usage -->

<!-- usage: run:release -->

Release this working tree's run record.

```bash
pnpm josh run:release 1091      # release this run's own record
pnpm josh run:release --force   # clear a record left by a run that has ended
```

**Options:**

- `--force` — removes a record this run did not write, clearing another run's stale claim.

<!-- /usage -->

The unit is the working tree, so two lanes of one repository key differently.

**Output / exit codes:** stdout is one token; explanations go to stderr. `run:hold` answers `hold`, `busy`, `reclaim` / `resume` / `park` (leftover work found) or `unknown` (exit 1); `run:release` answers `released`, `none` or `held` (exit 1).

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh run:hold` / `josh run:release` in detail".

### `josh run:pause`

<!-- usage: run:pause -->

Set a run aside while its prerequisite lands first.

```bash
pnpm josh run:pause 1091 --for 1102   # pause 1091 until 1102 lands
```

**Options:**

- `--for <prerequisite>` — the issue that has to land first; `<issue>` is recorded blocked by it.

<!-- /usage -->

A pause that lands prints `prerequisite.md` → "Each entry's branch, and the pause" after its step lines (one line naming it once this session printed it).

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh run:pause` in detail".

### `josh run:split`

<!-- usage: run:split -->

Set a run aside and place its split or prerequisite into an epic in one call.

```bash
pnpm josh run:split 1091 --children 1102,1103 --title "Split 1091"      # independent split
pnpm josh run:split 1091 --children 1102 --ordered                      # 1102 after 1091
pnpm josh run:split 1091 --prerequisite 1104 --title "1104 then 1091"   # 1104 first
```

**Options:**

- `--children <N1,N2,...>` — the filed split issues, comma-separated.
- `--ordered` — `<issue>` first, then the children in that order.
- `--prerequisite <P>` — the filed issue that has to land first; `<issue>` is paused on it.
- `--title <title>` — the new epic’s title; required when no epic tracks `<issue>` yet.

<!-- /usage -->

A split found mid-run in one call: the run set aside as `run:pause` sets it aside (stash, comment,
release, each step skipped on a rerun once done), the children placed — `epic --add` into the epic
already tracking `<issue>` (`--after <issue>` when `--ordered`), or a new epic `<issue>` heads — and
that epic audited with `epic:audit`. The last line is `epic #<E>`. An epic listing that cannot tell
whether an epic tracks `<issue>` parks it with `needs-decision` instead, and the last line is
`needs-decision`. Without `--title` and with no tracking epic it refuses before writing anything; a
failed step keeps the hold. A rerun whose tracking epic already lists every child places nothing
again and goes on to the audit.

`--prerequisite <P>` is `run:pause <issue> --for <P>` with the placement: the relation's own
`epic --add --before` places `<P>` in the epic tracking `<issue>`; with none, `epic "<title>" <P>
<issue> --ordered` is created before the relation, which is then recorded inside it. The audit, the
`needs-decision` park and the `--title` refusal are as above.

### `josh run:tidy`

<!-- usage: run:tidy -->

Close merged lanes and drop stashes whose issues are all merged.

```bash
pnpm josh run:tidy
```

<!-- /usage -->

Runs after every successful `run:hold` claim, and in a `backlogrun`'s once-per-repository preparation.

- **Lanes:** closes a lane whose issue was closed by a merge, whose work tree has no uncommitted change, whose branch has no commit that no remote reaches, and that no live run holds — then releases its run record.
- **Stashes:** drops an entry when every issue its message names (`#N`, a leading `N: `, or an `On N-lane:` branch) was closed by a merge. An entry that touches the observation ledger has its ledger lines appended first to the running work tree's own ledger file, less those any file of `.josh/observations/` already holds.
- **Left alone:** an issue closed as not planned or without a merged pull request, an open issue, a stash naming no issue, a lane with changes or unpushed commits, and a lane the running `backlogrun` launched and has not settled — its `run:merge` (or `run:carry --end`) records that merge.

"Closed by a merge" is read from the issue's REST timeline: its latest closed/reopened event is `closed` as completed (not `not_planned` or `duplicate`) and a merged pull request cross-references it.

**Output / exit codes:** always exits 0. What was cleaned and what was kept (with the reason) goes to stderr; nothing is printed when nothing merged was found.

### `josh run:prime`

<!-- usage: run:prime -->

Prepare the primary checkout once before a backlogrun’s first lane: main:sync, latest:if-required, the update stashed, lane:prune, run:tidy.

```bash
pnpm josh run:prime   # prints `latest <scope>` and `stash <message>|clean`
```

<!-- /usage -->

A `backlogrun`'s once-per-repository preparation in one call, in the primary checkout, never per lane. The steps run in order: `main:sync`, `latest:if-required`, then on `required` `stash:push "backlogrun: josh latest before lanes"`, `lane:prune` and `run:tidy`.

- Stdout: two lines, `latest skip|required` and `stash backlogrun: josh latest before lanes` or `stash clean`. A `stash` other than `clean` is popped by the first lane's `lane:launch --stash` with that message. Each step's own output goes to stderr.
- Failure: a failed step stops the run with a non-zero exit, and the steps after it do not run. A stash already pushed is kept.

### `josh run:stale`

<!-- usage: run:stale -->

Remove a stale `in-progress` label no checkout still holds.

```bash
pnpm josh run:stale
```

<!-- /usage -->

Removes `in-progress` from an open issue only when nothing holds it. Kept:

- a label inside `epic:next`'s stale window, or of unread age;
- a checkout (the lane, else the primary one whose run record names the issue) with uncommitted changes, a live, stop-marked or unreadable run record, or a process still in it (`lane-residents.ts`).

**Output / exit codes:** `#N kept — <reason>` or `#N removed — <age>` per issue on stdout; exit 1 on an unreadable listing, else 0.

### `josh run:carry`

<!-- usage: run:carry -->

Carry one invocation’s budget across its own session cuts.

```bash
pnpm josh run:carry --begin "backlogrun --max 5"
pnpm josh run:carry --json                                                                    # read the record back in a resumed session
pnpm josh run:carry --cut                                                                     # hand the record off before a cut
pnpm josh run:carry --retrospective --summary "0 filed; dropped #2240 already merged"         # close the end-of-run retrospective
pnpm josh run:carry --resume "backlogrun --max 5"                                             # adopt a record no cut handed off
pnpm josh run:carry --end --stopped "epic #2126: everything is blocked behind parked #2118"   # end + push
```

**Options:**

- `--owner <pid>` — the long-lived process spending the budget; omitted, the `CLAUDE_PID` of the calling Claude session (none elsewhere, e.g. Codex). Read by counts and `--begin` / `--resume`. A live PID stays `busy` if probes fail.
- `--done <issue>` — shrinks a named-issue run's `remaining` list.
- `--merged <issue>` — names the merged issue and counts it once against `merged_issues`, so a merge `run:merge` already recorded is not counted twice.
- `--filed` / `--cut` — increments, never totals.
- `--retrospective` — marks the end-of-run retrospective run, once per invocation, and requires `--summary <text>` — the same close writes that result as one `retrospective` event on the run's event stream (best-effort), so a run that filed zero improvements reads apart from one whose retrospective never ran. Either flag without the other is refused.
- `--stopped <reason>` — rides on `--end`: the run stopped rather than finished, so one ⏸️ confirmation is pushed with the reason.
- `--end` — over a live record flushes pending ledger lines once (a failed flush goes to stderr and the record is still cleared); first collects each lane the run launched whose issue merged, exactly as `run:merge` would; keeps the run it removes as the last ended run — its invocation, start and end, one record overwritten by the next `--end` — so `run:board` can still draw a finished run.

<!-- /usage -->

**Output / exit codes:** stdout: one token (`--json`: the record, one line). `began`, `resumed`, `driving`, `carried`, `counted`, `ended` exit 0; `busy`, `standing`, `mismatch`, `unreadable`, `unknown`, `over` exit 1; `none` exits 0 for a read/end, 1 for a count/resume.

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh run:carry` in detail".

### `josh run:add`

<!-- usage: run:add -->

Add issues to a live backlogrun, ahead of the queue unless --no-priority; epics become roots.

```bash
pnpm josh run:add 101 102             # ahead of the rest of the queue (`#N` works too)
pnpm josh run:add 101 --no-priority   # at the end of the queue
pnpm josh run:add 101 --retry         # retry a mechanically stopped issue in this run
```

<!-- /usage -->

Adds to this repository's live `backlogrun` at the next free lane, without interrupting running children.

- An open epic becomes an unlabelled root of any run, recorded once.
- Adds `auto-ok`, `run:lane`, and `priority:high` unless `--no-priority`; an issue already labelled `priority:critical` or `priority:high` keeps that label alone, still ahead of the queue. Named runs also record additions beside their unchanged invocation.
- Refuses closed/unreadable issues, failed writes, `needs-decision`, `needs-human-review`, `already-done`, a run-held `in-progress`, active/unreadable lanes, and prior withdrawals, merges, reviews or splits. Open blockers wait.
- Each `add` event wakes `run:progress --wait`.
- `--retry` records a fresh attempt and clears this issue's `run:stalled` and `done`. A restarted driver ignores earlier parks. Without it, completed or stalled issues are refused.
- A live `backlog:drive` runs `--retry` itself on the `run:stalled` causes it can re-offer, 2 times per issue ([labels and run states](./labels-and-run-states.md)); any other cause, or one at that cap, waits for this command.

**Output / exit codes:** one line per issue — `queued #N · next free lane`, `queued #N · end of the queue`, `queued #N · waiting: blocked by #M`, `tracking #E · <where>`, or `refused #N · <reason>`. Exits 0 when every issue was added, 1 when any was refused or no `backlogrun` is running here (nothing is added then), 2 on a malformed argument.

### `josh run:wake`

<!-- usage: run:wake -->

Wake the next session of a cut backlogrun from outside the conversation.

```bash
pnpm josh run:wake --start                # launch the detached supervisor
pnpm josh run:wake --list                 # supervisor state, cut/wake counts, latest progress line
pnpm josh run:wake --stop                 # stop the supervisor alone
pnpm josh run:wake --loop --interval 30   # run the loop body in the foreground
```

<!-- /usage -->

The detached supervisor adopts the handed-off carry record (a dead owner's too), runs `backlog:drive`, and starts an AI session only for a branch needing judgment.

**A run started by [`pnpm josh backlogrun`](./josh-commands.md#josh-backlogrun) already has its supervisor**, so the parent's `--start` answers `running`.

**To stop a `backlogrun`, use [`pnpm josh backlogrun --stop`](./josh-commands.md#josh-backlogrun)**: it stops this supervisor and ends the run's record together. `run:wake --stop` alone leaves the record behind with no owner; the next `pnpm josh backlogrun` ends it as a stopped run before starting, except where [`josh backlogrun`](./josh-commands.md#josh-backlogrun) keeps a stranded record.

`scheduler` runs provider; listings show profile/result. OpenAI uses worktree-local
`sqlite_home` and `--ephemeral`, retaining native auth/config.

**Ordinary work launches no parent AI session.** The driver uses the carry record's named list and the
existing backlog offer, lane launch and merge commands, and performs the idle watch and final report
itself. A judgment handoff carries the driver's verdict, affected issue, diagnostic
output and resume flags. The carry record keeps a restarted supervisor from counting a merge into
another live owner's run.

**A failure is visible rather than silent.** A judgment wake whose session never begins work on the carry
record is retried, and once the retries are spent the supervisor stops and sends a `warning` Telegram; a carry
record that cannot be read ends it the same way. A `failed` stop while the carry record is
still resumable restarts the supervisor in place after one interval, up to three times; only the
failure past that bound sends the warning, its note counting the restarts. `none` and a
person's own `--stop` stay silent. Once the run-tooling defect that stopped it is fixed, a stop
with a resume path is restarted by the AI with `run:wake --start`, which confirms the
driver advances (`prompts/collaboration-workflow/upstream-interrupt.md` →
"実行中のリポジトリ自身のラン機構の不具合"). Everything the supervisor starts writes to one log file per
repository, named by `--list` and by every warning. Progress is relayed from the existing report
record: the driver keeps the `run:merge` event stream and the `run:report` finish path.

The supervisor reloads itself when its own import closure changes on disk: at a pass boundary it
hands the run to a successor on the new code, notes it on the run's stream and answers `reload`.
The driver runs with `--window 5`, so a pass boundary comes at least every five minutes while lanes
are active.

The lanes and the carry record stay, as `backlogrun --restart` leaves them. A successor that does not
start, or does not claim the run within two minutes, is a `failed` stop; an unclaimed one is stopped.

Unattended profiles: Codex → OpenAI; Claude Code → Anthropic.
[Codex permissions](./maintainers/josh-commands-run-rationale.md#codex-batch-permissions).

| Provider  | scheduler                    | worker                       | reviewer                     |
| --------- | ---------------------------- | ---------------------------- | ---------------------------- |
| Anthropic | `claude-opus-5-5` / `medium` | `claude-opus-5-5` / `medium` | `claude-opus-5-5` / `medium` |
| OpenAI    | `gpt-6.1-sol` / `medium`     | `gpt-6.1-sol` / `medium`     | `gpt-6.1-sol` / `medium`     |

Overrides resolve before launch: model for Claude Code, effort for either provider, `JOSH_LANE_*`
for workers. Review round 2 and later (the
verification pass) runs Anthropic on `claude-sonnet-5-5` / `high` and OpenAI on `gpt-6.1-sol` / `high`, overridable by
`JOSH_REVIEWER_VERIFICATION_{MODEL,EFFORT}`, then `JOSH_REVIEWER_*`. With no session marker and no
`JOSH_AGENT_PROVIDER` the provider defaults to Anthropic (Claude Code), which is what lets a person
launch from a plain terminal. Invalid configuration, conflicting session markers, or a missing,
outdated or unauthenticated CLI refuses without fallback, promotion or worker retry.
`run:wake --list`, `lane:list`, the review brief and each launch log expose the resolved provider,
role, model and effort; the worker's launch is `josh lane:dispatch`.

**Output / exit codes:** stdout is one token; stderr explains. `started`, `running`, `supervising`, `stale`, `stopped`, `ended`, `reload`, `unreadable` exit 0; `none` exits 0 for `--list` / `--stop` and 1 for `--start`; `failed`, `unknown` exit 1. `unreadable` and `failed` each warn.

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh run:wake` in detail".

### `josh run:cut`

<!-- usage: run:cut -->

Cut a lane child before the gate and resume a fresh process.

```bash
pnpm josh run:cut 1839                                                # take the cut and hand it to a fresh process
pnpm josh run:cut --impl 1839 --handoff .josh/tmp/handoff-1839.json   # cut mid-implementation, carrying the instruction
pnpm josh run:cut --resume 1839                                       # a fresh process's entry check
pnpm josh run:cut --end                                               # clear the record
```

<!-- /usage -->

OpenAI relaunches through its lane supervisor (`failed` before writing the cut if none matches); Anthropic relaunches directly. Outside a lane only an `--impl` cut on a tree `run:hold <N> --fullrun` holds is taken: the record is written, nothing is relaunched, the session ends its turn and a fresh `fullrun #<N>` resumes it; any other cut there answers `not-a-lane`.

A cut that resumes into implementation (`--impl`) carries a **handoff** — the run's
instruction verbatim and a curated list of what is done, what remains, and what was deliberately left
alone. It is passed by path with `--handoff <path>`, never inlined, so a
backtick or `$` in the instruction is not executed. The record stays small; the resume prints the handoff to stderr, and a resume that finds no instruction is refused `incomplete`.

**Output / exit codes:** stdout is one token, then its `pre-gate-cut.md` section unless `not-a-lane` / `fresh`. `run:cut <N>`: `cut`, `not-a-lane`, `unready`, `busy`, `failed` or `bad-handoff`. `run:cut --resume <N>`: `fresh`, `resume`, `resume-impl`, `stale`, `busy`, `handed-off`, `incomplete` or `over`.

**The dispatch mark:** `lane:dispatch` starts each child generation with `JOSH_LANE_CHILD` set to
the lane's issue number (`scripts/lane/lane-child-marker.ts`).

- It means "this session was launched for issue `<N>`, not typed by a person"; it lives as long as the
  child process, set at launch and never written by the run.
- It is trusted only where its value equals the lane's own issue — a mark naming another issue,
  or none, is read as a person. An interactive `fullrun` carries no mark.
- `run:cut` itself looks for an open lane for the issue instead (`not-a-lane` otherwise).

**The gate guard:** the `pre-gate-cut` row of `pnpm josh rule:list` refuses `josh gate` in a lane with no cut record carried.

- It fires for a marked child and nowhere else — the working directory is `<lane root>/<issue number>`
  **and** `JOSH_LANE_CHILD` names that issue (`run:cut`'s open-lane lookup need not agree byte for
  byte).
- It fires only when the current context warrants a cut (`cost_cli.session_verdict`, as `run:cut`), and
  once per run; it is silent once the cut is carried. `--resume`, `--end` and `--json` do not count as
  taking the cut.

`--setup` is a usage error (`docs/maintainers/josh-commands-run-rationale.md` → "`josh run:cut` lost its setup-phase cut").

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh run:cut` in detail".

### `josh run:park`

<!-- usage: run:park -->

Park a lane child for a decision, or clear the park.

```bash
pnpm josh run:park 1839 --body-file .josh/tmp/park-1839.md   # options, tiers and a recommendation; then needs-decision, the record, run:release
pnpm josh run:park 1839 --clear                              # remove needs-decision and the record
```

<!-- /usage -->

The body follows one schema (`scripts/run/park/run-park-body.ts`): numbered options under `### 選択肢`, each with `- 層: A|B|C` and `- 必要な権限: …`, then one `### 推奨` line — `<option number> <reason>`, or `推奨なし <reason>`.

A body off the schema is refused before any write, naming the missing piece and printing the schema; the usage prints it too.

A body on the schema is then judged against the Issue's trusted sources before any write (`scripts/run/park/run-park-answered.ts`); `--clear` is not judged, and the `backlog:drive` yield-cap park is a `run:stalled` stop, not a `run:park`.

- **Unanswered** — parks as below.
- **Answered** — exit `1`, no write: `Park refused: …` with each quote and its source, then record `Auto-decided: …` with `issue:comment` and continue.
- **Failed** — exit `1`, no write: `Park failed: <cause>.` and `Retry: <how>`; follow the printed `Retry:` line.

The parent reads the tiers and the recommendation with `backlog:triage --apply <N> --adopt <k>` (`docs/josh-commands-backlog.md` → "`josh backlog:triage`"): a tier A or B option of a recommending park is the parent's; `推奨なし` or a tier C option stays a person's (`backlogrun-park.md` → "A park left for a person").

The local park record is what the `lane-park` guard reads, so a child that parked is not asked to again. `--clear` succeeds when the label is already off and releases nothing. A park that lands runs `run:release <N>`'s own implementation next, so the hold and `in-progress` come off in the same call; a tree whose hold names another run releases nothing — that run's own ending does.

A park from inside a lane appends the lane directory, its held seat and `pnpm josh lane:close <N>` to the comment.

A released park prints `backlogrun-park.md` → "park and continue" after the release's line — a lane child `pre-gate-cut.md` → "A lane child records its park before it stops" — or one line naming it once this session printed it. A section that does not resolve exits `1` with the park landed; do not re-run the park.

**Output / exit codes:** one `park #<N>` line naming what was written, then the release's line; exit `0` once the label and the comment are both on the issue and the release succeeded (or, with `--clear`, once the label is off), `1` otherwise. The record is written only once both are on; a failed release keeps it and prints `pnpm josh run:release <N>` to re-run.

### `josh upstream:interrupt`

<!-- usage: upstream:interrupt -->

Stop for a defect in another package in one call: stash, file the upstream issue, backlink it on the finder, send the confirmation.

```bash
pnpm josh upstream:interrupt 2304 "<root-cause title>" --repo joshuafolkken/kit --body-file .josh/tmp/body.md
```

**Options:**

- `--repo <owner/repo>` — the upstream repository. Required.
- `--body-file <path>` — the upstream issue body. Required.
- `--blocks-finder` — passed to `issue:file`: the finder is recorded as blocked by the filing.

<!-- /usage -->

A third-party `--repo` files nothing: the body goes to the finder under `## Upstream candidate` for a person to post. An `unknown` party writes nothing. Each step prints one line; a failing step stops the rest and prints the command to re-run. Resume with the `stash:pop` line the backlink carries.

### `josh run:liveness`

<!-- usage: run:liveness -->

Say whether a delegated unit is still working, or stopped without reporting.

```bash
pnpm josh run:liveness 1169 --output <path>
pnpm josh run:liveness 1169 --output <path> --window 45 --gap 2 --repo joshuafolkken/app-kit
```

**Options:**

- `--output <path>` — absolute, under the home or temp directory; a symlink is followed and size compared as well as mtime.
- `--process alive | none` — overrides the process trace, which the command otherwise reads itself: the child's own command line (`fullrun #<N>`) or its detached ship supervisor.
- `--window <min>` — silent window the file must be frozen for (default 30).
- `--gap <sec>` — spacing between samples (default 5).
- `--repo <owner/name>` — a child in another repository.

<!-- /usage -->

**Output / exit codes:** stdout is one token; stderr explains. `alive`, `paused`, `stopped`, `settled` exit 0; `undetermined` exits 1. Growth in the transcript answers `alive` on its own. Two `undetermined` answers in a row is a check fault; the caller stops polling rather than escalating to `stopped`.

The lane state record answers first: `paused` for a lane `lane:pause` paused (its process is alive but suspended, so it is never `alive`), `settled` for an ended one; a running lane, or one with no record, is left to the traces.

### `josh run:ending`

<!-- usage: run:ending -->

Classify how a dispatched lane child ended (merged, cut, abandoned, unreadable).

```bash
pnpm josh run:ending 2118 --output <path>
pnpm josh run:ending 2118 --output <path> --repo joshuafolkken/app-kit
```

**Options:**

- `--output <path>` — the child's transcript, absolute and under the home or temp directory (validated the same way `run:liveness --output` is).
- `--repo <owner/name>` — a child in another repository.

<!-- /usage -->

**Output / exit codes:** stdout is one token; the reason and basis go to stderr. `merged`, `cut`, `outage` (the API was unreachable) and `abandoned` exit 0; `unreadable` exits 1. Completion is the CLOSED Issue, never `is_error: false`.

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh run:ending` in detail".

### `josh run:prep`

<!-- usage: run:prep -->

Bundle a run’s pre-edit reads: body, comments, state, dependency scope.

```bash
pnpm josh run:prep <N>
pnpm josh run:prep <N> --summary   # the work summary skeleton
```

<!-- /usage -->

`--summary` prints only the work summary's skeleton from the body: `## 現象` as Now, `## 期待結果` as Change, each `## 受け入れ条件` item as Check with an empty `- test:` under it. A missing section prints its heading alone; a body whose author is not trusted carries `issue:read`'s untrusted-body heading.

Its `=== ship preconditions ===` section asks, ahead of the ship, the refusals `josh ship` would otherwise meet late: a missing release classification, a runtime change whose PR body lacks `## 実機証跡`, and an unmapped acceptance criterion — printed with the `未記入` rows to copy. `met` when none applies; `unmet` lists each to fix before the gate. The ship and `followup` refuse on all.

Its `=== investigation ===` section names, before the first read, the step the investigation guard otherwise names only on its refusal: the limit and the `investigator` dispatch — the same wording, from `delegation-policy.ts`.

The investigator's saved conclusion is a durable run record keyed by repository and Issue, so a lane dispatched again after a yield prints it and skips the investigator; it is removed once the PR merges or a closed Issue's lane is withdrawn, and pruned after 14 days unwritten.

### `josh run:entry`

<!-- usage: run:entry -->

Open a run in one call: claim the tree, read the budget, bundle the reads, decide the pre-implementation step.

```bash
pnpm josh run:entry <N>                # a `fullrun`
pnpm josh run:entry <N> --to halfrun   # a run that goes as far as `halfrun`
pnpm josh run:entry <N> --adopt        # a `new` run's entry once <N> is filed
```

<!-- /usage -->

It runs `run:hold`, `cost --cut` (skipped in a lane child), `run:prep` and `run:step`. The `entry #<N> — hold: … · cost: … · verdict: …` line carries the facts the run branches on; a `busy`/`unknown` hold or an `over` budget short-circuits with a non-zero exit, and a stopped `halfrun` or `prrun` is adopted as `resume: …`.

`--adopt` claims by `run:hold --adopt <N>` instead — a `new` run's bare hold re-keyed to the Issue it filed; `none` or `busy` stops as a held tree does.

After the budget and before the reads, the entry synchronizes the tree (skipped in a lane child): `stash:push "<command> [new] #<N>: pre-existing changes"`, `main:sync` (primary checkout) or `main:merge` (linked), then `stash:pop` after `stashed`. A failed step exits non-zero, keeps and names the stash, releases the hold and sends the `confirmation` Telegram.

`--to kickoff|halfrun|prrun|fullrun` names how far the run goes (default `fullrun`); the first line, `stage #<N> — at: … · to: … · start: …`, says where it starts. The stage table is `docs/how-to/run-issues.md`.

An issue with `run:planned` or a trusted plan comment reads as `planned`, and its `=== investigation ===` section says to skip the investigator — a lane dispatched again after a yield starts at its recorded plan.

A lane child entering a `planned` issue whose plan `lane:plan` has not cleared runs `lane:plan` on its plan comment's backticked paths before the report, printing the command and its verdict; `yield` gives the lane back at the entry with exit 2, as the entry probe does. A plan comment naming no path runs nothing, and `run:step`'s `lane:plan` line stays.

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh run:entry` in detail".

### `josh run:status`

<!-- usage: run:status -->

Bundle a run’s read-only status: issue state, cost verdict, carry counters.

```bash
pnpm josh run:status <N>
pnpm josh run:status <N> --repo <owner/repo>   # a cross-repo child
```

<!-- /usage -->

### `josh run:next`

<!-- usage: run:next -->

Print the next step a fullrun takes, computed from the run’s state.

```bash
pnpm josh run:next <N>
```

<!-- /usage -->

It maps what `run:prep` reads (through its own gather) to one step: a `CLOSED` issue is already done, a `required` dependency scope is updated first, a `needs-human-review` issue stops before its commit, else implement.

History: `docs/maintainers/josh-commands-run-rationale.md` → "`josh run:next` and `josh run:prep`".

### `josh run:step`

<!-- usage: run:step -->

Print the run’s next single action, computed from the event stream, carry record and issue state.

```bash
pnpm josh run:step <N>   # the run's next action for issue <N>
pnpm josh run:step       # the `backlogrun` parent's next action
```

<!-- /usage -->

It lifts `run:next`'s fold from an _event_ to a whole _run_, reading the event stream (`run:event`), carry record (`run:carry`) and issue state (`run:prep`) — never the conversation.

The line is a command for a phase that has one: `followup` after a PR opens, `run:merge <N>` after a merge, `backlog:next` after a park, `run:cut --resume <N>` after a cut (until a `resume-impl` answer appends `resume`, which reads as `implement` again), `run:carry --cut` after a Codex parent's dispatch below the cut cap.

Otherwise it is a fixed verdict (`implement`, `human-review`, `update-deps`, `already-done`, `wait`, `stop`, `unknown`), or a `decide:` line for the one Tier-B point it surfaces — a closed issue whose tree still holds uncommitted work.

It dispatches rather than re-decides: a merged child's outcome stays `run:merge`'s, the next issue `backlog:next`'s. `run:next` is its degenerate form.

**With no issue number it answers for the `backlogrun` parent**, from the carry record alone: `run:carry
--cut` for the live record this session drives — whatever the plan held, an empty backlog included, so
the supervisor's driver runs the idle watch — `pnpm josh retrospective` at a drain that owes one, `wait`
at the cut cap, `stop` once the session has handed the record off, and `unknown` (exit 1, with the usage
on stderr) in a lane child or when no record is this session's.

When `run:prep`'s ship preconditions are unmet, `run:step` prints that same block on stderr, so stdout stays the action lines.

A lane child whose plan `lane:plan` has not cleared gets `pnpm josh lane:plan <N> <paths>` under `implement`, its plan comment's paths (`<path>...` with none) — already run when `issue:plan` ran it on the recorded plan, or `run:entry` on a `run:planned` issue's plan comment.
All three print it with a line naming `--imports`.

In a **dispatched lane child** (read from the dispatch mark, `lane-child-marker.ts`) a merge or an
outage position prints `stop` rather than `run:merge <N>`: `run:merge` is the
parent's budget command and returns `busy` in a child (the complement of the runtime `lane-carry-conflict` refusal).

The **end-of-run retrospective is opt-in**, gated by `JOSH_RETROSPECTIVE`. The drain and stop positions print the retrospective command only when it is
set to `on` / `1` / `true` / `yes` (trimmed, case-insensitive), and `wait` / `stop` otherwise.
The **default is off** — an unset or unrecognized value leaves it off. The switch gates only
whether the step is printed: `pnpm josh retrospective` still runs by hand, and the three existing exclusions (a lane child, a done retrospective, a consumer
checkout) are unchanged.

### `josh run:merge`

<!-- usage: run:merge -->

Collapse a backlogrun merge event into one call: confirm the child, do the post-merge steps, offer the next child.

```bash
pnpm josh run:merge <N> --epic <E> --repo <owner/repo> --output <path>   # prints the next child number, or a verdict
pnpm josh run:merge <N>                                                  # backlog offer (no epic)
```

**Options:**

- `--epic <E>` / `--repo <owner/repo>` — offer the epic's next children; omit both for the opted-in backlog.
- `--owner <pid>` — the parent's process, so the carry count respects the ownership guard; omitted, the calling session.
- `--output <path>` — the transcript the outage and usage-limit splits read; absent, they are off.
- `--driver` — the caller is `backlog:drive`, which has no context to cut and asks `backlog:offer` itself, so the merge is never handed back `over` and answers `deferred` in place of the next offer.
- `--stash` — before classifying, stash the lane's uncommitted work and comment the `stash:pop` line on the Issue — the stopped-unit recovery.

<!-- /usage -->

Confirms the child from GitHub and does its post-merge steps: a **merged**
child (CLOSED by a merge, read off its timeline) closes epics beside `main:sync`, is counted (resets the failure streak) and its `merge`
logged once at confirmation, then `lane:close <N>` and the epic counters; a merged lane over 40 minutes of net time
(`lane:net`) comments its breakdown by stage (`lane:breakdown`) on the lane's Issue once and launches a detached session that searches the longest stages first and files its unfiled causes against the lane, recorded as a `note`
event (the start note carrying the longest stage, which the board draws after 🔍) (`lane-overrun.ts`, its wording `run-event-overrun.ts`), its result `folded #A,#B` / `filed` / `recurred #M` / `none: <why>` — the causes one file or mechanism shares filed as one Issue, or folded into an open one touching the same files;
a lane within 40 minutes notes `#N net: M min`, one with no net time `#N overrun skipped: <reason>`; a launch that failed (`not investigated: <why>`) is launched once more at the next merge, whichever child merged; every 30th merge in the
lane ledger launches one baseline investigation of the median lane — the stages and sub-stages that spend the most per merge
in `lane:stats --period 3`, its causes filed by the overrun's rules (at most five, the largest reducible minutes first, each 1 minute or more) — noted `baseline @M merges: <outcome>` (`lane-baseline.ts`,
its wording `run-event-baseline.ts`), a finding on the board. Both investigations are off by default and run only while
`JOSH_LANE_INVESTIGATION` is `on` ([environment variables](./environment-variables.md#runs)): off, a lane over 40 minutes notes
`#N overrun skipped: disabled (JOSH_LANE_INVESTIGATION is not on)` with no breakdown comment or launch, no failed launch is retried, the other notes are unchanged, and a due baseline launches and notes nothing. The board's
merged row ends `M′`, the child's own filed numbers, then that outcome (`⏭`, `🔍`, `🔍 ↪N`, `🔍 ∅`, `🔍 💥`, spinner)
and the investigation's (its launch's `JOSH_LANE_OVERRUN` mark, on the `filed` event), groups two spaces apart
(`47′  4847  🔍 implement 31′ · 4856`), and while `JOSH_LANE_INVESTIGATION` stays off every merged row ends on its filed numbers alone, whatever its note (no `M′`, no outcome); a 🏁 row keeps all the numbers; a failed sync logs nothing; a **parked** child (`needs-decision`,
`run:stalled` or `already-done`) only has its `in-progress` dropped; an **outage** child (OPEN, unparked, exit record shows it could not
reach the API, or a host restart killed it — dispatched before the host booted, its log not ending on an exit record — or its log's last 20 lines show a GitHub
rate limit or an expired `gh` login, `run-merge-github-limit.ts`) has it dropped, unparked and uncounted: re-dispatchable;
a rate limit adds to no streak, and a `usage-limit` event names the exhausted resource's `gh api rate_limit` reset (none or unread: 30 minutes on);
a **usage-limit** child (OPEN, unparked, exit record shows a Claude usage limit stopped it) has it dropped, unparked and counted
against no streak, and a `usage-limit` event names the reset (unreadable or past: 30 minutes on); `backlog:drive` launches nothing before it;
a **failed** child (OPEN, unparked, not an outage) has it dropped, is parked with `run:stalled` and counts against the failure guard — unless it records
an open blocker, a `- 実施可能日:` still ahead or a `- 実施可能条件:` not yet met (or, its body unreadable, carries `not-before`): then it
is **waiting**, unparked and uncounted, its comment naming the wait.
A **withdrawn** child (a `lane:withdraw` on the stream, or CLOSED with no merged pull request) counts and logs nothing
and launches no investigation; its lane is withdrawn through `lane:withdraw`'s path unless already withdrawn — kept, as the `run:wake` sweep keeps one, where its branch has commits on no remote; a retry where the withdrawal cannot read it.
A failed child whose detached `josh ship` ended is parked for its stop: the comment's `Why` names the
newest `ship-stop` line since launch, else the ship's result and `pnpm josh ship --log <N>`. A stop
followed by `relaunch-failed` (the relaunch started nothing) is unanswered, re-dispatched whatever the
dispatch log's mtime; a child parked at the per-child re-dispatch cap leads its `Why` with the cap, its
re-dispatch count and its newest `relaunch-failed` line.
A **cut** child (OPEN, unparked, its lane holding a declared cut no successor adopted) is neither
parked nor counted: its successor is relaunched in its lane once
per cut; a relaunch that cannot start, or a second unadopted return, is the failed child instead. An OpenAI lane is left to its supervisor.
A parked, failed, waiting, outage or usage-limit child's lane is closed when vacant (no commit past the default
branch, clean tree, no live process — `lane-vacant.ts`), else kept.

**Output:** one child number (or several, one per free lane), or a verdict token. Beyond the offer
`epic:next` prints (`run` becomes numbers; `wait` / `stop` / `complete` / `error` pass through), it adds
`over` (the merge crossed the `pnpm josh cost --cut` context threshold: hand the lanes over and cut),
`stop` (failure guard), `environment` (the consecutive-outage guard tripped,
or a child could not authenticate; it keeps `in-progress`, uncounted, for `/login`), `resumed` (a cut child's successor was relaunched — await that lane again), `retry`
(unreadable), `busy` (refused count; exit 1).

A human-review child keeps its lane and hold, counts nothing, and offers more children.

### `josh run:review`

<!-- usage: run:review -->

Start test:pinned in the background, run the gate and, once it is green, write the /code-review brief to a file, printing its path (--join to join them; it stops on an unpinned change).

```bash
pnpm josh run:review                             # detach test:pinned, wait for a green gate, write the brief (the interaction brief after it where due) to a file and print its path, then launch a reviewer per brief
pnpm josh run:review --code-only                 # josh ship's own open: code's brief alone, since the ship opens the interaction brief itself
pnpm josh run:review --unpinned-ok "only logs"   # check beside the pair as ever; the join prints the list and the reason and carries on past unpinned places
pnpm josh run:review --join                      # after the review returns: join the gate and test:pinned; exit 3 on an unpinned change
pnpm josh run:review --join --fixing             # the join when round 1 has fixes to make: no grace on test:pinned, left running; prints the unpinned places the cache already holds
pnpm josh run:review --pinned                    # read test:pinned alone (the ship's pre-detach reads it anyway); a lane child returns at once
pnpm josh run:review --push                      # launched by a lane open: push and open the PR at a green gate
```

<!-- /usage -->

It composes `josh gate` and `josh review:brief` and changes neither, so `review:attest --check`'s nonce/checkout contract is unchanged.
Where this branch's issue owes an interaction review not yet recorded, the `review:brief --interaction`
brief is written to its own file after code's and both paths are printed, so the round-1 reviewers run
side by side and `josh ship` reuses both records; `--code-only` is the ship's own open and prints code's
brief, since the ship opens the interaction brief itself.

The default waits for the gate to finish and writes the brief to a file and prints its path only on a
green gate, so round 1 and its snapshot read the tree the gate passed; a red gate prints its log and
exits non-zero with no brief. `--join` reads the settled gate, prints the timing, and **exits non-zero on a red gate** —
"a review verdict is not adopted over a red gate". A gate that passed on a tree that moved after it
(a review fix in place) exits `2` and says so rather than `Gate RED`; `josh ship --review` drains it
and its gate stage re-runs on the moved tree. `josh test:pinned --record <token>` runs detached beside
the gate; `--join` prints its lines and **exits `3` on an unpinned change**, which `josh ship --review`
never drains (`--unpinned-ok`: above). A check `--join` started again on a moved tree is not waited on:
it is left running for the ship's pre-detach, as under `--fixing`. `review:record` reads a skipped
`--join`. The reason and places `--unpinned-ok` accepted stay for the
branch in the git directory (`josh-unpinned-ok.json`), the reason from the launch on, so a round-1
fix that moves the tree past the join still leaves it; a later run with no reason carries on under it
while every place, keyed by file, function and the lines replaced and put in, is recorded, and a
`josh ship --review` given no reason carries it as its `--unpinned-ok`. A scoped refusal launches
neither; a reopen stops the last check. A dispatched lane child whose round 1 is recorded on a tree
`josh ship` reuses is refused before either launches, pointed at `josh ship --detach --review`, and
`josh review:record` names the same next step after a code round the ship reuses. The overlap's reader is `chain-rule.md`.

### `josh run:tail`

<!-- usage: run:tail -->

Close a run in one call: return to the default branch, commit the observation ledger, read the citations, decide the release scope.

```bash
pnpm josh run:tail <N>                 # the closed issue
pnpm josh run:tail <N> <follow-up-N>   # and a follow-up filed this run
```

<!-- /usage -->

It folds `main:sync`, `observations:flush`, `issue:cite` (the closed issue and any follow-ups filed this run) and `release:scope` in order (the ledger commits before the release scope reads main) under one header per step, non-zero if any failed. The review verdict, merge and push stay their own calls.

The flush is residual: a run's lines ride its own commit, so it commits only a line appended after that and otherwise prints `clean`. The checkout returns to the default branch first because the flush refuses anywhere else.

**Every linked checkout and lane child skips `main:sync` and `observations:flush`**; the checkout keeps its branch, and its ledger lines merged with its own pull request.

### `josh ship`

<!-- usage: ship -->

Ship a change in one call: gate, commit/push/PR, the CI-wait merge and the report bookkeeping, stopping at the first failed step.

```bash
pnpm josh ship "<title> #<N>" --body-file .josh/tmp/evidence.md
pnpm josh ship "<title> #<N>" --review                            # both review rounds inside the ship
pnpm josh ship --detach "<title> #<N>"                            # hand the ship to a supervisor; on `launched` and `cost --cut` `under`, wait one `ship:wait` chunk
pnpm josh ship --log <N>                                          # a detached ship's log
```

**Options:**

- `--body-file <path>` — the PR body carrying the live-execution evidence `followup` gates on, written under `.josh/tmp/`; forwarded to `git -y` alone.
- `--notify-message <text>` — forwarded to `followup` alone.
- `--review` — runs round 1 beside the gate; after sync and round 1, an owed round 2 runs beside the gate and joins before the PR opens. A High or unfixed Medium stops the ship. A pre-detach `test:pinned` stop probes remaining hunks in the background for the next pre-detach.
- `--unpinned-ok <reason>` — forwarded to round 1's `run:review`, past `unpinned` places no test can pin.
- `--detach` — hands the ship to a supervisor (implied in a lane child); a stop emits `ship-stop` (`--log <N>`). The preflight, type check, unused exports, cspell, guard tests and (`--review`, under `--unpinned-ok`, given or recorded, only if round 1 is reused) `test:pinned` precede hand-off, the checks even after a preflight refusal, so one stop reports every failure.

<!-- /usage -->

It runs `git -y`, `followup` and `run:tail` in order, under one header per step. A red gate stops the ship before the followup merges; a sync that merged the default branch pushes onto an open pull request ahead of the gate, and the commit stage pushes the gated tree. The report names the stopped step.

The first positional is the `"<title> #<N>"` string `git -y` and `followup` take; `run:tail` gets the issue number off its tail. Further positionals are follow-up citations filed this run, forwarded to `run:tail` after the closed issue.

A `preflight` stage first asks every pull-request precondition together, so a stop lands before the review and the gate. A pass is reused on an unchanged tree, base, title and body.

A detached re-ship (`--detach`, or any lane child's) after a review failure (`check` / `finding`) or a followup `check`, on an unmoved base, skips the pre-detach preflight and fast checks, printing `pre-detach: skipped …`. A `--review` ship still runs its `test:pinned` there; the supervised preflight and gate still run.

Over a green gate, a clean main move is not merged before the push (`… not merged again; …`): PR CI on the merge ref catches a combined break. A conflicting or unreadable one is merged and gated.

A followup red after a main move is merged, gated and pushed in the followup, printing `followup: the default branch moved …`; only a red there stops.

One precondition is `unplanned`: a code file in the branch diff that the lane's `lane:plan` record does not list stops the ship with `unplanned: <files>`. Only script sources (`.ts`, `.js`, `.svelte`, `.sh`, …) count — never tests, Markdown, data files, `docs/**`, `prompts/**` or `.josh/**` — and a branch with no plan record, or a yielded one, passes.

In scope, run the `lane:plan` command the stop prints (every path) and comment the reason on the Issue — a `yield` answer means another lane holds the file, and its printed instruction wins; out of scope, revert the file and file it with `issue:file`. The stop row and `lane:stats` count it as `unplanned`, `(noticed)` once an earlier notice printed it.

`check:related`, `run:review --join` and a lane child's `review:record` print the same notice ahead of the ship, so a file a fix added is planned first.

A re-run resumes: a per-issue stage record, honored only where git state corroborates it, passes over finished stages; each stage is logged as a `ship-stage` trace event.

A lane child always ships with `--review`, after its in-implement round 1. The `review` stage reuses a round 1 attested on this branch whose tree held, or moved only where round 2 reads, and ends `skipped` (`done` when an owed interaction review then runs); any other round 1 is reviewed again. A gate stage that reuses a green record ends `skipped` too.

Round 2 re-runs only on a moved tree or base, or a stale review.

The review stage's `ship-stage` line carries the reason after `|` (`reused: …` or `ran: … — <cause>`), and `lane:breakdown` prints it beside the stage.

A supervisor whose `sync` changed its own code hands the stages after it to a successor on that code (same launch record); a successor that does not take over leaves it running on.

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh ship` in detail".

### `josh review:submit`

<!-- usage: review:submit -->

Write a reviewer's findings, read from stdin, where the ship or review:record --from-slot reads them; --review lints the review in the same call.

```bash
pnpm josh review:submit < findings.txt                             # the /code-review slot
pnpm josh review:submit --interaction < findings.txt               # the interaction review slot
pnpm josh review:submit --none                                     # a review with no findings
pnpm josh review:submit --review "$PWD/review.md" < findings.txt   # lint the review and submit the findings in one call
```

**Options:**

- `--none` — a review with no findings; empty stdin without it is refused.
- `--review <absolute-path>` — the reviewer's markdown review, by absolute path (josh runs from the package root, so a relative path is refused), linted against the rubric's output format in the same call; a violation and a grammar refusal are reported together, and nothing is written while either stands.
- `--round <1|2>` — the rubric shape `--review` is linted against; round 1 by default.

<!-- /usage -->

A ship's reviewer, or the `reviewer` agent `run:review` briefs, pipes its findings here, one `review:record` line each.
The command writes them to the slot's findings file, where the ship or [`josh review:record --from-slot`](josh-commands-automation.md#josh-reviewrecord) reads them, so no path or finding is copied by hand. A line outside the grammar is refused, and nothing is written.

### `josh ship:wait`

<!-- usage: ship:wait -->

Wait on a detached ship through its gate and review round 1, so a stop there returns to this session (returned | passed | ended | pending).

```bash
pnpm josh ship:wait <N>   # re-issue it on `pending` while `cost --cut` is `under`; `returned` prints the stop to fix
```

<!-- /usage -->

A stop in the gate or review round 1 returns to the lane session waiting here; with no session waiting, a fresh one is launched as before.

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh ship:wait` in detail".

### `josh ship:evidence`

<!-- usage: ship:evidence -->

Run a command and append its invocation and output tail to the ship body draft’s live-evidence section (exits with the command’s code).

```bash
pnpm josh ship:evidence <N> -- pnpm josh <command>           # the run picks which command is the evidence; the format is written for it
pnpm josh ship:evidence <N> --fresh -- pnpm josh <command>   # runs it even when this tree already holds a recorded run of it
```

<!-- /usage -->

The command runs with `NO_COLOR`; its invocation is written as a code span and the last 40 lines of its combined output in a fence, at the end of the draft's `## 実機証跡` section, the shape `josh ship`'s preflight reads.
A draft is required: `josh run:prep <N>` writes it.

A command already run on this tree with the same arguments is not run again: its recorded output tail and exit code are written, under a `reused: tree <hash> … at <time>` line in the draft (`scripts/gate/tree-verdict.ts`).
The key sees only the tree, so `--fresh` runs a command that reads state outside it (GitHub, a server) again.
