# josh CLI — Run, Lane and Session Command Reference

The commands a run and its lanes call to hold, step, cut and ship, plus the session-budget and document-reading commands a run uses. Where each command came from: `docs/maintainers/josh-commands-run-rationale.md` → "Where each command came from".

A `<!-- usage: … -->` span is generated from `scripts/josh/josh-usage-run.ts` and `scripts/josh/josh-usage-session.ts` by `tsx scripts/document/generate-command-usage.ts` — edit the table, not the span.

## Run lifecycle

### `josh run:hold` / `josh run:release`

Guard a working tree so only one run holds it at a time — `run:hold` claims it, `run:release` clears the claim. The unit is the working tree, so two lanes of one repository key differently.

<!-- usage: run:hold -->

```bash
pnpm josh run:hold 1091             # claim for issue 1091
pnpm josh run:hold 1091 --fullrun   # claim as `fullrun #1091` (what `run:entry` runs)
```

**Options:**

- `--fullrun` — marks the record as `fullrun #N`'s.
- `--halfrun-stop` — marks a `halfrun` stop for `run:entry` to adopt.
- `--prrun-stop` — marks a `prrun` stop with the commit its pull request is on.

<!-- /usage -->

<!-- usage: run:release -->

```bash
pnpm josh run:release 1091      # release this run's own record
pnpm josh run:release --force   # clear a record left by a run that has ended
```

**Options:**

- `--force` — removes a record this run did not write, clearing another run's stale claim.

<!-- /usage -->

**Output / exit codes:** stdout is one token; explanations go to stderr. `run:hold` answers `hold`, `busy`, `reclaim` / `resume` / `park` (leftover work found) or `unknown` (exit 1); `run:release` answers `released`, `none` or `held` (exit 1).

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh run:hold` / `josh run:release` in detail".

### `josh run:tidy`

Sweep what merged work left behind — run by `run:hold` after every successful claim, and by a `backlogrun` in its once-per-repository preparation.

<!-- usage: run:tidy -->

```bash
pnpm josh run:tidy
```

<!-- /usage -->

- **Lanes:** closes a lane whose issue was closed by a merge, whose work tree has no uncommitted change, whose branch has no commit that no remote reaches, and that no live run holds — then releases its run record.
- **Stashes:** drops an entry when every issue its message names (`#N`, a leading `N: `, or an `On N-lane:` branch) was closed by a merge. An entry that touches the observation ledger has its ledger lines appended first to the running work tree's own ledger file, less those any file of `.josh/observations/` already holds.
- **Left alone:** an issue closed as not planned or without a merged pull request, an open issue, a stash naming no issue, a lane with changes or unpushed commits, and a lane the running `backlogrun` launched and has not settled — its `run:merge` (or `run:carry --end`) records that merge.

"Closed by a merge" is read from the issue's REST timeline: its latest closed/reopened event is `closed` as completed (not `not_planned` or `duplicate`) and a merged pull request cross-references it.

**Output / exit codes:** always exits 0. What was cleaned and what was kept (with the reason) goes to stderr; nothing is printed when nothing merged was found.

### `josh run:carry`

Carry one invocation's budget across its own session cuts, so a resumed `backlogrun` continues the authorized run instead of starting a second one.

<!-- usage: run:carry -->

```bash
pnpm josh run:carry --begin "backlogrun --max 5" --owner "$PPID"
pnpm josh run:carry --json                                                                              # read the record back in a resumed session
pnpm josh run:carry --cut --owner "$PPID"                                                               # hand the record off before a cut
pnpm josh run:carry --retrospective --summary "0 filed; dropped #2240 already merged" --owner "$PPID"   # close the end-of-run retrospective
pnpm josh run:carry --resume "backlogrun --max 5" --owner "$PPID"                                       # adopt a record no cut handed off
pnpm josh run:carry --end --stopped "epic #2126: everything is blocked behind parked #2118"             # end + push
```

**Options:**

- `--owner <pid>` — the long-lived process spending the budget (`$PPID` under a loop); required by counts and `--begin` / `--resume`. A live PID stays `busy` if probes fail.
- `--done <issue>` — shrinks a named-issue run's `remaining` list.
- `--merged <issue>` — names the merged issue and counts it once against `merged_issues`, so a merge `run:merge` already recorded is not counted twice.
- `--filed` / `--cut` — increments, never totals.
- `--retrospective` — marks the end-of-run retrospective run, once per invocation, and requires `--summary <text>` — the same close writes that result as one `retrospective` event on the run's event stream (best-effort), so a run that filed zero improvements reads apart from one whose retrospective never ran. Either flag without the other is refused.
- `--stopped <reason>` — rides on `--end`: the run stopped rather than finished, so one ⏸️ confirmation is pushed with the reason.
- `--end` — over a live record flushes pending ledger lines once (a failed flush goes to stderr and the record is still cleared); first collects each lane the run launched whose issue merged, exactly as `run:merge` would; keeps the run it removes as the last ended run — its invocation, start and end, one record overwritten by the next `--end` — so `run:board` can still draw a finished run.

<!-- /usage -->

**Output / exit codes:** stdout is one token (`--json` prints the record on one line). `began`, `resumed`, `carried`, `counted`, `ended` exit 0; `busy`, `standing`, `mismatch`, `unreadable`, `unknown`, `over` exit 1; `none` exits 0 for a read/end, 1 for a count/resume.

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh run:carry` in detail".

### `josh run:add`

Add issues to the `backlogrun` running in this repository without stopping it. A running child is never interrupted: an added issue takes the next lane that frees.

<!-- usage: run:add -->

```bash
pnpm josh run:add 101 102             # ahead of the rest of the queue (`#N` works too)
pnpm josh run:add 101 --no-priority   # at the end of the queue
```

<!-- /usage -->

- A child filed into an epic the run names needs no `run:add`: `backlog:drive` reads that epic's current children on every pass.
- Each issue gets `auto-ok` and `run:lane`, plus `priority:high` unless `--no-priority`. A `backlogrun #N --only` run also gets the issue written to its carry record, so its named list includes it; the recorded invocation is never rewritten.
- A closed issue, one that could not be read, or one a label would not apply to is refused; the others are still added. An issue with open blockers is added and reported as waiting on them.
- Each added issue is written to the run's event stream as an `add` event, which wakes a `run:progress --wait` so the run offers the issue the next free lane.

**Output / exit codes:** one line per issue — `queued #N · next free lane`, `queued #N · end of the queue`, `queued #N · waiting: blocked by #M`, or `refused #N · <reason>`. Exits 0 when every issue was added, 1 when any was refused or no `backlogrun` is running here (nothing is added then), 2 on a malformed argument.

### `josh run:wake`

Continue a cut `backlogrun` from outside the conversation. The detached supervisor adopts the handed-off carry record, runs `backlog:drive`, and starts an AI session only for a driver branch requiring judgment. A dead owner can be recovered through the same path.

<!-- usage: run:wake -->

```bash
pnpm josh run:wake --start                # launch the detached supervisor
pnpm josh run:wake --list                 # supervisor state, cut/wake counts, latest progress line
pnpm josh run:wake --stop                 # stop the supervisor alone
pnpm josh run:wake --loop --interval 30   # run the loop body in the foreground
```

<!-- /usage -->

**A run started by [`pnpm josh backlogrun`](./josh-commands.md#josh-backlogrun) already has its supervisor**, so the parent's `--start` answers `running`.

**To stop a `backlogrun`, use [`pnpm josh backlogrun --stop`](./josh-commands.md#josh-backlogrun)**: it stops this supervisor and ends the run's record together. `run:wake --stop` alone leaves the record behind with no owner, and the next `pnpm josh backlogrun` answers `standing` on it rather than starting.

`scheduler` runs provider; listings show profile/result. Anthropic defaults. OpenAI uses worktree-local
`sqlite_home` and `--ephemeral`, retaining native auth/config. Unclaimed wakes try thrice.

**Ordinary work launches no parent AI session.** The driver uses the carry record's named list, the
existing backlog offer, lane launch and merge commands. It performs the idle watch and final report
itself. A judgment handoff includes the driver's verdict, affected issue when present, diagnostic
output and resume flags. The carry record prevents a restarted supervisor from counting a merge into
another live owner's run.

**A failure is visible rather than silent.** A judgment wake that never claims the carry record is
retried, and once the retries are spent the supervisor stops and sends a `warning` Telegram; a carry
record that cannot be read ends it the same way. A `failed` stop while the carry record is
still resumable restarts the supervisor in place after one interval, up to three times; only the
failure past that bound sends the warning, its note counting the restarts. `none` — the run having finished — and a
person's own `--stop` stay silent. Once the run-tooling defect that stopped it has been fixed, a stop
with a resume path is restarted by the AI itself with `run:wake --start`, which then confirms the
driver advances (`prompts/collaboration-workflow/upstream-interrupt.md` →
"実行中のリポジトリ自身のラン機構の不具合"). Everything the supervisor starts writes to one log file per
repository, named by `--list` and by every warning. Progress is relayed from the existing report
record: the driver keeps the `run:merge` event stream and the `run:report` finish path, and `--list`
prints that record's latest line.

**Every unattended role runs with the provider selected from the invoking CLI and its own profile.**
Codex sessions use OpenAI; Claude Code sessions use Anthropic.

| Provider  | scheduler                    | worker                       | reviewer                   |
| --------- | ---------------------------- | ---------------------------- | -------------------------- |
| Anthropic | `claude-opus-5-5` / `medium` | `claude-opus-5-5` / `medium` | `claude-opus-5-5` / `high` |
| OpenAI    | `gpt-6.1-sol` / `medium`     | `gpt-6.1-sol` / `medium`     | `gpt-6.1-sol` / `high`     |

Role overrides resolve before launch; model overrides apply only to Claude Code, effort overrides to
either provider, and legacy `JOSH_LANE_*` values to the worker only. Review round 2 and later (the
verification pass) runs Anthropic on `claude-sonnet-5-5` / `high`, overridable by
`JOSH_REVIEWER_VERIFICATION_{MODEL,EFFORT}`, then `JOSH_REVIEWER_*`. With no session marker and no
`JOSH_AGENT_PROVIDER` the provider defaults to Anthropic (Claude Code), which is what lets a person
launch from a plain terminal. Invalid configuration, conflicting session markers, or a missing,
outdated or unauthenticated CLI refuses without fallback, promotion or worker retry.
`run:wake --list`, `lane:list`, the review brief and each launch log expose the resolved provider,
role, model and effort; the worker's launch is "`josh lane:dispatch`".

**Output / exit codes:** stdout is one token; stderr explains. `started`, `running`, `supervising`, `stale`, `stopped`, `ended`, `unreadable` exit 0; `none` exits 0 for `--list` / `--stop` and 1 for `--start`; `failed`, `unknown` exit 1. `unreadable` and `failed` each warn.

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh run:wake` in detail".

### `josh run:cut`

Cut a dispatched lane child before the verification gate. OpenAI uses its lane supervisor; Anthropic
relaunches directly. With no matching supervisor, OpenAI returns `failed` before writing the cut.
Outside a lane only an `--impl` cut on a tree `run:hold <N> --fullrun` holds for that issue is taken
: the record is written and nothing is relaunched, so the session ends its turn
and a fresh `fullrun #<N>` resumes it; every other cut outside a lane answers `not-a-lane`.

<!-- usage: run:cut -->

```bash
pnpm josh run:cut 1839                                                  # take the cut and hand it to a fresh process
pnpm josh run:cut --impl 1839 --handoff .claude/tmp/handoff-1839.json   # cut mid-implementation, carrying the instruction
pnpm josh run:cut --resume 1839                                         # a fresh process's entry check
pnpm josh run:cut --end                                                 # clear the record
```

<!-- /usage -->

A cut that resumes back into implementation (`--impl`) carries a **handoff** — the run's
instruction verbatim and a curated list of what is done, what remains, and what was deliberately left
alone. It is passed by path with `--handoff <path>`, never inlined, so a
backtick or `$` in the instruction is not executed. The record stays small (bounded, a few short
lines); the resume prints the handoff to stderr so the fresh process continues on the instruction
rather than the working tree alone, and a resume that finds no instruction is refused `incomplete`
rather than continuing blind.

The relaunched child runs at the effort of the phase it resumes into — lowered for a pre-gate resume, the role default for an `--impl` resume.

**Output / exit codes:** stdout is one token. `run:cut <N>`: `cut`, `not-a-lane`, `unready`, `busy`, `failed` or `bad-handoff`. `run:cut --resume <N>`: `fresh`, `resume`, `resume-impl`, `stale`, `busy`, `handed-off`, `incomplete` or `over`.

`--setup` is a usage error (`docs/maintainers/josh-commands-run-rationale.md` → "`josh run:cut` lost its setup-phase cut").

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh run:cut` in detail".

### `josh run:liveness`

Say whether the delegated unit running a child is still working, or stopped without reporting. Two traces decide it: whether the transcript grew, and whether a child process is alive.

<!-- usage: run:liveness -->

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

**Output / exit codes:** stdout is one token; stderr explains. `alive`, `stopped`, `settled` exit 0; `undetermined` exits 1. Growth in the transcript answers `alive` on its own. Two `undetermined` answers in a row is a check fault; the caller stops polling rather than escalating to `stopped`.

### `josh run:ending`

Classify how a dispatched lane child _ended_ — handed off, merged, or stopped mid-implementation — which `run:liveness` cannot tell from a frozen output.

<!-- usage: run:ending -->

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

Bundles the reads a run makes before its first edit into one call.

<!-- usage: run:prep -->

```bash
pnpm josh run:prep <N>
```

<!-- /usage -->

Its `=== ship preconditions ===` section asks, ahead of the ship, the two refusals `josh ship` would otherwise meet at the run's largest context: a missing release classification in the Issue body, and a runtime change whose open PR body has no `## 実機証跡` section. `met` when neither applies; `unmet` lists each, so they are fixed before the gate. The ship and `followup` still refuse on both.

### `josh run:entry`

Opens a run in one call: `run:hold`, `cost --cut` (skipped in a lane child), `run:prep` and `run:step`. The `entry #<N> — hold: … · cost: … · verdict: …` line carries the facts the run branches on; a `busy`/`unknown` hold or an `over` budget short-circuits with a non-zero exit, and a stopped `halfrun` or `prrun` is adopted as `resume: …`.

<!-- usage: run:entry -->

```bash
pnpm josh run:entry <N>                # a `fullrun`
pnpm josh run:entry <N> --to halfrun   # a run that goes as far as `halfrun`
```

<!-- /usage -->

`--to kickoff|halfrun|prrun|fullrun` names how far the run goes (default `fullrun`); the first line, `stage #<N> — at: … · to: … · start: …`, says where it starts. The stage table is `docs/how-to/run-issues.md`.

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh run:entry` in detail".

### `josh run:status`

Bundles a run's read-only status — issue state, `cost --cut` verdict, and carry counters — in one
call, `--repo` for a cross-repo child. Writes nothing.

<!-- usage: run:status -->

```bash
pnpm josh run:status <N>
pnpm josh run:status <N> --repo <owner/repo>   # a cross-repo child
```

<!-- /usage -->

### `josh run:next`

Prints the next step a `fullrun` takes, computed from the run's state rather than read out of prose. It reads exactly what `run:prep` reads — the issue state, the
`human_review` line and the dependency scope — by calling `run:prep`'s own gather, and maps the four
facts to one step: a `CLOSED` issue is already done, a `required` dependency scope is updated first, a
`needs-human-review` issue stops before its commit, and everything else is the ordinary implement step.
History: `docs/maintainers/josh-commands-run-rationale.md` → "`josh run:next` and `josh run:prep`".

<!-- usage: run:next -->

```bash
pnpm josh run:next <N>
```

<!-- /usage -->

### `josh run:step`

Prints the run's next single action, computed from the event stream (`run:event`), the carry record
(`run:carry`) and the issue state (`run:prep`) — never the conversation
. It lifts `run:next`'s fold from an _event_ to a whole _run_, printing one
line: a runnable command for a phase that has one (`followup` after a PR opens, `run:merge <N>` after a
merge, `backlog:next` after a park, `run:cut --resume <N>` after a cut — until a `resume-impl` answer
appends `resume`, which reads as `implement` again — `run:carry --cut` after a
Codex parent's dispatch below the cut cap), a fixed verdict otherwise
(`implement`, `human-review`, `update-deps`, `already-done`, `wait`, `stop`, `unknown`), or a `decide:`
line for the one Tier-B point it surfaces — a closed issue whose tree still holds uncommitted work. It dispatches rather than
re-decides: a merged child's outcome stays `run:merge`'s, the next issue `backlog:next`'s. `run:next`
is now its degenerate form — the pre-implementation position mapped to prose over the one shared
mapping, so there is no second implementation.

<!-- usage: run:step -->

```bash
pnpm josh run:step <N>   # the run's next action for issue <N>
pnpm josh run:step       # the `backlogrun` parent's next action
```

<!-- /usage -->

**With no issue number it answers for the `backlogrun` parent**, from the carry record alone: `run:carry
--cut` for the live record this session drives — whatever the plan held, an empty backlog included, so
the supervisor's driver runs the idle watch — `pnpm josh retrospective` at a drain that owes one, `wait`
at the cut cap, `stop` once the session has handed the record off, and `unknown` (exit 1, with the usage
on stderr) in a lane child or when no record is this session's.

When `run:prep`'s ship preconditions are unmet, `run:step` prints that same block on stderr, so stdout stays the one action line.

In a **dispatched lane child** (read from the dispatch mark, `lane-child-marker.ts`) a merge or an
outage position prints `stop` rather than `run:merge <N>`: `run:merge` is the
parent's own budget command and returns `busy` in a child, so a child is never pointed at it (the
complement of the runtime `lane-carry-conflict` refusal).

The **end-of-run retrospective is opt-in**, gated by `JOSH_RETROSPECTIVE`
. The drain and stop positions print the retrospective command only when it is
set to `on` / `1` / `true` / `yes` (trimmed, case-insensitive), and print `wait` / `stop` otherwise.
Its **default is off** — an unset or unrecognized value leaves it off, so a typo cannot enable it and a
checkout that writes nothing to `.env` never auto-files improvement issues. The switch gates only
whether the step is printed: the retrospective's own logic is untouched, `pnpm josh retrospective`
still runs by hand, and the three existing exclusions (a lane child, a done retrospective, a consumer
checkout) are unchanged.

### `josh run:merge`

Collapses a `backlogrun` merge event into one call. The parent
calls it once at a child's return and reads back the next child number — or a control verdict.

<!-- usage: run:merge -->

```bash
pnpm josh run:merge <N> --epic <E> --repo <owner/repo> --owner "$PPID" --output <path>   # prints the next child number, or a verdict
pnpm josh run:merge <N> --owner "$PPID"                                                  # backlog offer (no epic)
```

**Options:**

- `--epic <E>` / `--repo <owner/repo>` — offer the epic's next children; omit both for the opted-in backlog.
- `--owner <pid>` — the parent's process, so the carry count respects the ownership guard.
- `--output <path>` — the transcript the outage split reads; absent, it is off.

<!-- /usage -->

Confirms the child from GitHub and, by what it turned out to be, does the post-merge steps: a **merged**
child (CLOSED) is counted into the carry record (which resets the failure streak), then `main:sync`,
`lane:close <N>`, and the counters mirrored onto the epic comment; a **parked** child (`needs-decision`
or `already-done`) only has its `in-progress` dropped; an **outage** child (OPEN, unparked, exit record shows it could not
reach the API) has it dropped, unparked and uncounted, so re-dispatchable;
a **failed** child (OPEN, unparked, not an outage) has it dropped, is parked with `needs-decision`,
and counts against the failure guard — unless it records an open blocker or a `- 実施可能日:` still
ahead: then it is **waiting**, unparked and uncounted, its comment naming the wait.
A failed child whose detached `josh ship` ended is parked for its stop: the comment's `Why` names the
newest `ship-stop` line since launch, else the ship's result and `pnpm josh ship --log <N>`.
A **cut** child (OPEN, unparked, its lane holding a declared cut no successor adopted) is neither
parked nor counted: its successor is relaunched in the same lane through the cut's own relaunch, once
per cut; a relaunch that cannot start, or a second unadopted return, is the failed child instead. An OpenAI lane is left to its supervisor.
A parked, failed, waiting or outage child's lane is closed when vacant (no commit past the default
branch, clean tree, no live process — `lane-vacant.ts`), else kept.

**Output:** one child number (or several, one per free lane), or a verdict token. Beyond the offer
`epic:next` prints (`run` becomes numbers; `wait` / `stop` / `complete` / `error` pass through), it adds
`over` (the merge crossed the shared 135,000 context threshold, so hand the lanes over and cut), `human-review` (the child stopped
before its commit — stop), `stop` (failure guard), `environment` (the consecutive-outage guard tripped —
the API is down), `resumed` (a cut child's successor was relaunched — await that lane again), `retry`
(unreadable), `busy` (refused count; exit 1).

### `josh run:review`

Starts the gate in the background and prints the whole `/code-review` brief in one call, so a lane
child launches the two together and they overlap. It composes
`josh gate` and `josh review:brief` and changes neither, so `review:attest --check`'s nonce/checkout
contract is minted exactly as before.

<!-- usage: run:review -->

```bash
pnpm josh run:review          # detach the gate, print the brief; then launch the /code-review subagent
pnpm josh run:review --join   # after the review returns: join the gate, check its verdict
```

<!-- /usage -->

The default waits only for the gate to _start_ (never for the checks to pass) and prints the brief;
`--join` waits for it to finish, prints the gate/review overlap, and **exits non-zero on a red gate** —
the mechanical form of "a review verdict is not adopted over a red gate". The overlap's reader is
`chain-rule.md`.

### `josh run:tail`

Closes a run in one call, folding the post-merge sequence: `main:sync`,
`observations:flush`, `issue:cite` (the closed issue and any follow-ups filed this run) and
`release:scope`, run in order — the ledger commits before the release scope reads main — and joined
under one header per step, non-zero if any failed. It folds only bookkeeping; the review verdict, the
merge and the push above it stay their own calls. The flush is residual: a run's appended lines ride
its own commit, so it commits only a line appended after that commit and
otherwise prints `clean`. The checkout returns to the default branch first because the flush refuses
anywhere else, and a run closes still on the feature branch it merged — `josh ship` reaches this report
with nothing in between. **A lane child skips `main:sync` and
`observations:flush`**; `main:sync` refuses inside a lane, and its lines merged with its own pull
request.

<!-- usage: run:tail -->

```bash
pnpm josh run:tail <N>                 # the closed issue
pnpm josh run:tail <N> <follow-up-N>   # and a follow-up filed this run
```

<!-- /usage -->

### `josh ship`

Ships a finished change in one call: the gate, the commit/push/PR (`git -y`), the CI-wait merge
(`followup`, kept in the foreground) and the report bookkeeping (`run:tail`), run in order and joined
under one header per step. It extends `run:tail`'s post-merge fold into the body of the region.
Unlike `run:tail` it stops at the first failed step — a red gate never reaches the commit — and closes
the report with the name of the stopped step, so the run reads only that one. The first positional is
the `"<title> #<N>"` string `git -y` and `followup` already take; the issue number is read off its tail
for `run:tail`. Any further positionals are
follow-up citations filed this run — branch-2 filing runs before `ship` — forwarded to `run:tail` after
the closed issue so `issue:cite` reports them too. The one decision the region carried — disposing of a
review finding — stays in front of this command.

A `preflight` stage first asks every pull-request precondition together, so a stop lands before the review and the gate rather than after them.

A re-run resumes: a per-issue stage record, honored only where the actual
state (committed, pushed, merged) corroborates it, passes over finished stages; each stage is logged
as a `ship-stage` trace event.

<!-- usage: ship -->

```bash
pnpm josh ship "<title> #<N>" --body-file <evidence.md>
pnpm josh ship "<title> #<N>" --review                    # both review rounds inside the ship
pnpm josh ship --detach "<title> #<N>"                    # hand the ship to a supervisor
pnpm josh ship --log <N>                                  # a detached ship's log
```

**Options:**

- `--body-file <path>` — the PR body carrying the live-execution evidence `followup` gates on; forwarded to `git -y` alone.
- `--notify-message <text>` — forwarded to `followup` alone.
- `--review` — runs review round 1 beside the gate, and round 2 after the commit when `review:round2` requires it; a High or an unfixed Medium stops the ship.
- `--detach` — hands the ship to a supervisor (implied in a lane child); a stop emits `ship-stop` (`--log <N>`). The preflight, type check, unused exports, cspell and guard tests run before the hand-off; a stop returns to the same session.

<!-- /usage -->

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh ship` in detail".

### `josh run:report`

Generates the session-facing report _from_ the run's event stream, rather than composing the wording by
hand each run. It reuses `run:event`'s `format_event` for every
line — merges, parks with their reason, cuts — and appends the release tail `release:scope` decides (the
request and the command on `required`, `unknown` printed as `unknown`, silent on `skip`).

**It renders one invocation, not the whole stream**. The stream outlives an
invocation, so the scope comes from the run record's start time: events from before it are left out, and
because that field survives a `--cut` the events either side of a cut stay in one report. **A scope it
cannot determine — no record, or one it cannot read — prints a notice and no events**, never a fallback
to everything. That is why the report is generated before `pnpm josh run:carry --end` removes the record:
`.claude/skills/workflow-commands/backlogrun-steps.md` → "End the record when the run ends" is that
ordering rule's single source.

The printed
body is the Telegram body too: `josh notify --body-file` sends exactly this output, so a session's
summary and the off-screen message are one string from one generator, and the AI writes only Step 0's
three lines.

<!-- usage: run:report -->

```bash
pnpm josh run:report   # print the report; the same text josh notify sends
```

<!-- /usage -->

### `josh run:event`

Appends to, or reads back, the run's append-only ordered event stream. Keyed to the run's identity — the common git directory `run:carry` uses — so parent and every
lane child append to one stream that survives a session cut; `--from` reads everything after a position,
`--last` the newest event alone, `--follow` one bounded read that waits, and
`--watch` every event in order, for debugging — the ambient pane is `run:board`, which `.vscode/tasks.json` opens on folder open.

<!-- usage: run:event -->

```bash
pnpm josh run:event --append <kind> <text>   # append one event; prints its position
pnpm josh run:event --from <position>        # every event after <position>, in order (JSON)
pnpm josh run:event --follow <position>      # new events, waiting for one; position on stderr
pnpm josh run:event --watch [<position>]     # every new event, rendered, until interrupted
pnpm josh run:event --last                   # the newest event alone
```

<!-- /usage -->

`--follow` is `--from` that waits: it returns the moment an event is past `<position>` and otherwise at
the interval. Events go to standard output and the next position to standard error — the same before
and after a cut, the stream the run's, the position the caller's.

`--watch` loops that pass, printing `HH:MM · <label> · <text>` in the session language.

`<kind>` is one the single enumeration names (`plan`, `child-launch`, `merge`, `park`, `outage`, `cut`,
`resume`, `stop`, `pr-opened`, `review-round`, `filed`, `note`, `lane-phase`, `setup`, `pr-checks`); a kind outside it is refused.
`lane-phase` is a lane child's first implementation edit, written by the PreToolUse hook.
`pr-checks` is `josh followup`'s poll of a PR's checks, written only on change.
`setup` is one stage the run works through (`planning`, `dispatching #<N>`, …) — a trace `run:board` times, never a position.
`filed` is an Issue `issue:file` created, and `note` a one-line
observation below the filing bar (`run:board` shows both). `run:merge` appends `merge`, `park`
and `outage`; other steps call `--append`. The stream is bounded, so an unattended run cannot grow it
without limit.

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh run:event` in detail".

### `josh run:progress`

Report an unattended run's progress once it has gone quiet — the one josh command meant to be started and left running in the background.

<!-- usage: run:progress -->

```bash
pnpm josh run:progress --output <path>
pnpm josh run:progress --once                                                 # five labelled lines now, whatever the clock says
pnpm josh run:progress --interval 20 --repo joshuafolkken/app-kit --hours 4
```

**Options:**

- `--mark` — record that a real report happened without printing a line (keeps the last line for `run:wake --list`).
- `--path` — print the ambient heartbeat log's path and exit. Every heartbeat line is mirrored there, so `tail -F "$(pnpm josh run:progress --path)"` follows the run across a `backlogrun` session cut. Reads no run state, so it answers in a lane child too.
- `--interval <min>` — silence interval (default 20; also `JOSH_PROGRESS_INTERVAL_MINUTES`, then `josh.progress_interval_minutes`).
- `--wait` — start once in the background: each report goes to the event stream and ambient log, never stdout; exits only on an arrival, `josh followup` ending the run, or `--hours`.
- `--hours <n>` — how long the watcher lives (default 8 with `--wait`, 1 otherwise).
- `--repo <owner/name>` — scopes the read.

<!-- /usage -->

**Output / exit codes:** stdout carries only the five labelled progress lines; notices go to stderr. `--once` with no run recorded prints nothing and exits 0; an unreadable listing exits 1. It sends no Telegram; `JOSH_PROGRESS=0` reports nothing (`--mark` still records).

### `josh run:board`

A full-screen board of the running `backlogrun`, redrawn every second for a person to keep open beside the run. `.vscode/tasks.json`, distributed by `josh sync`, opens it in a pane of its own when the workspace opens.

<!-- usage: run:board -->

```bash
pnpm josh run:board             # redraw until interrupted
pnpm josh run:board --once      # one frame, then exit
pnpm josh run:board --chat      # one frame for a chat, recorded as a progress report
pnpm josh run:board --every 5   # the --chat frame as a 📊 Progress Telegram every 5 minutes, until the run ends
```

**Options:**

- `--chat` — answers a `backlogrun` progress question: the frame `--once` draws, with only `🧠` on the machine line and no escapes; it records the report as `run:progress --mark` does.
- `--every <minutes>` — sends the `--chat` frame as a `📊 Progress` Telegram now and every `<minutes>` until the run ends — only when a person asks for it.

<!-- /usage -->

The header is three lines — the first two in three columns, the third a spinner and time under the second column, then the kind's icon and words under the third:

```
▶ backlogrun  ⏰ 7°18′07″  ✅  1/2 ■■■■■───── (+1)  🔄 1  ⏳ 0  💤 0
  kit         💓      20″  ⚡  11% ■─────────  🧠  29% ■■■───────  💾 2.6M/s ■─────────
              ⠦        4″  🔧 #<N> · Bash pnpm josh test:related
```

The first line is how far the run is: its state mark and name, `⏰` elapsed in degree-minute-second style (`1°15′57″`, `3′27″`, `26″` — every length on the board is written so; a colon is a time of day), a progress bar and per-state counts.

The second line is what the run is on: the repository's name, `💓` age of the newest event (yellow after 15 quiet minutes, red after 30), and machine gauges (`⚡` CPU, `🧠` memory, `💾` swap rate). `⏰` and `💓` share a column, digits right-aligned, and both lines' first bars start in one.

The third line is what the run is doing now: a spinner, how long ago it happened, then the kind's icon and words.

- **At a stage** — the stage's words then why: `⠸  2′31″  🤔 waiting on judgment — 4 waiting`.
- **At a stage a session works on** — that session's newest operation: `⠼  3″  📝 planning · Bash pnpm josh backlog:plan`.
- **Children running, no stage** — the newest child operation or event: `⠙  4″  🔧 #<N> · Bash pnpm josh test:related`.
- **No operation readable** — a log that is missing, unreadable or holds no call falls back to what the line said before: the stage with its time and reason, or how many children run (`🔄 2 running`), with no time.
- **Watching** — nothing running and no stage: `24′10″  🔭 watching — pool empty`, the time counted from the newest thing the run did (a merge, a park, the drain, or the stage it last stood at — so a judgment session's minutes are not counted as watching).
- **Ended** — the newest thing the run did, in that event's words, timed up to the end: `42″  🔚 backlog drained`.

Below the header: a row per touched child (phase icon, elapsed time, CPU and memory), the wave order, waiting and parked children, and the newest filings, parks and notes, with a legend at the foot.

A child whose open lane has had no child process for `lane:await`'s 15-second re-confirm window is drawn stopped, with no elapsed time; a probe that does not answer leaves it running. A single frame that finds an idle lane waits out the window and reads again.

A waiting row (`⏳`) ends with why it waits, in English whatever the session language, after its `🔗` blockers — which are drawn as before, so a row with both shows both:

- `untriaged` — the issue carries neither `run:lane` nor `run:solo`, so nobody has judged it. It is the one reason drawn beside a `🔗`, since judging it is what a person can do meanwhile.
- `not before <time>` — the body's `- 実施可能日:` names a UTC time not yet reached, so `backlog:next` withholds the issue until then. The board shows it as the local `YYYY-MM-DD HH:MM`, as it does every other time; `backlog:next` keeps the UTC spelling. It comes before every reason below.
- `held by triage` — the issue is judged and nothing blocks it, but an untriaged issue nothing blocks withholds the whole pool.
- `overlaps <N> (<file>)` — a path its body declares overlaps one the running issue `<N>` declares: the state `backlog:next` answers with "waits: its `<file>` overlaps …".
- `no free lane <used>/<limit> — <N…> <state> · …` — nothing else keeps it waiting and the open lanes have reached the lane limit — the free count `lane:limit` prints, read at the board's last local read. Each lane in use is named `running`, `parked` or `idle` (no child, but a commit or change keeps it): `no free lane 4/4 — 4023 running · 3988 parked · 4002 idle`. A vacant lane is never named.
- `no memory headroom — 🧠 <n>% · 💾 <n>M/s` — a lane is free, but the driver opens none while the kernel reads memory pressure, 🧠 is red or 💾 swaps at a red rate; it resumes within one poll once the kernel reads normal and 🧠 is under yellow. The ledger records the hold as `memory`, its own `lane:stats` row. An unread figure is left out.

A row with a standing blocker says nothing beyond its `🔗` unless it is `untriaged`; a row whose lane is being opened shows that lane's stage, such as `opening lane 5″`.
Above the legend, the terminal board thanks the people who helped review kit, read from a published roster.

On a terminal it draws on the alternate screen, as `top` and `less` do, so redraws never grow the scrollback; Ctrl+C, SIGTERM or a normal exit restores the screen and the cursor that were there before. `--once`, or a stdout that is not a terminal (a pipe or a redirect), writes one frame with no screen control and exits — no color either when it is not a terminal.

**Output / exit codes:** exits 0; an unknown argument or a bad `--every` exits 1; Ctrl+C exits 130 and SIGTERM 143. With no run, running or ended, it prints `no run`.

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh run:board` in detail".

### `josh run:watcher:guard`

Guard hook: exits non-zero when lane children are in-flight but `run:progress` has not pinged its life record recently (within three watcher ticks, roughly 90 s). Wired as a `PreToolUse` hook so the agent cannot issue the next Bash call while the watcher is stale.

<!-- usage: run:watcher:guard -->

```bash
pnpm josh run:watcher:guard
```

<!-- /usage -->

**Output / exit codes:** exits 0 when no lane children are in-flight or the watcher is fresh. Exits 1 and writes a note to stderr telling the user to restart `run:progress --wait` before proceeding.

### `josh run:stranded`

Report whether the run has been left stranded — its owner died, no successor holds it, and no `run:wake` supervisor watches. Run by the `Stop` hook; a strand sends one 🚨 Telegram and never stops anything.

<!-- usage: run:stranded -->

```bash
pnpm josh run:stranded
```

<!-- /usage -->

**Output / exit codes:** always exits 0, printing `stranded` or `ok` on stdout. Recovery is another actor's — the notification names `run:wake --start`, which wakes a fresh successor to claim the budget; the cutting session stays refused `busy` and must not resume the run itself.

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh run:stranded` in detail".

## Lanes

### `josh lane:open` / `josh lane:close` / `josh lane:list` / `josh lane:prune`

Open and close a lane: one linked git work tree with its own branch and port seat. `lane:open` cuts from the default branch, installs dependencies, and warms the gate caches and hook bundles from the main checkout.

<!-- usage: lane:open -->

```bash
pnpm josh lane:open 1490   # prints the lane directory on stdout
```

<!-- /usage -->

<!-- usage: lane:close -->

```bash
pnpm josh lane:close 1490
pnpm josh lane:close --all
```

**Options:**

- `--all` — closes every lane.

<!-- /usage -->

<!-- usage: lane:list -->

```bash
pnpm josh lane:list
```

<!-- /usage -->

<!-- usage: lane:prune -->

```bash
pnpm josh lane:prune
```

<!-- /usage -->

`lane:prune` closes spent or unregistered lanes and names each lane it keeps, with why, on stderr.

**Settings:**

- `JOSH_LANE_ROOT` — where lanes go; unset means `.<repository-name>-lanes`, a hidden sibling of the repository root.
- `JOSH_LANE_LIMIT` — how many lanes one repository may run at once (default 4); applied by `josh epic:next`.

**Output / exit codes:** `lane:open` prints the directory on stdout (an empty capture plus non-zero exit is a refusal); explanations go to stderr. Seats are `1..9` (main work tree is seat 0), claimed atomically. A failed install fails the command; warming is best-effort. `lane:list` prints one line per lane — issue, seat, ports, branch, state, directory, output path, and profile.

**The `in-progress` / lane difference:** `lane:list` names on stderr an issue carrying `in-progress` with no open lane, and a lane whose issue lacks the label. It never changes a label.

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh lane:open` / `josh lane:close` / `josh lane:list` / `josh lane:prune` in detail".

#### `josh lane:output`

Record — or read back — where the delegated unit running this lane's child writes, so a session that did not open the lane can still poll it.

<!-- usage: lane:output -->

```bash
pnpm josh lane:output 1713 /abs/path/to/agent-7.jsonl   # record it; prints the path back
pnpm josh lane:output 1713                              # read it; prints the path, or `none`
```

<!-- /usage -->

The record lives in the lane's own `.env`; a lane whose `.env` cannot be read is refused rather than replaced.

**Output / exit codes:** the recorded path prints on stdout. `none` prints and exits non-zero (the lane is open but its child is not handed over yet).

#### `josh lane:dispatch`

Start a lane's child as a detached OS process, so cutting this session abandons nothing.

<!-- usage: lane:dispatch -->

```bash
pnpm josh lane:dispatch 1749   # prints the child's pid; a refusal is an empty capture and exit 1
```

**Options:**

- `JOSH_{SCHEDULER,WORKER,REVIEWER}_MODEL` — Claude Code role overrides; Anthropic defaults are respectively `claude-opus-5-5`, `claude-opus-5-5`, and `claude-opus-5-5`. Codex keeps its provider-specific model.
- `JOSH_{SCHEDULER,WORKER,REVIEWER}_EFFORT` — role effort overrides for either provider; defaults are `medium`, `medium`, and `high`.
- `JOSH_REVIEWER_VERIFICATION_{MODEL,EFFORT}` — review round 2 and later (the verification pass); Anthropic defaults are `claude-sonnet-5-5` / `high`, falling back to `JOSH_REVIEWER_*`.

<!-- /usage -->

The invoking CLI selects the worker provider: Codex sessions use a detached
non-AI supervisor for Codex generations, while Claude Code sessions run unchanged `claude -p`.
SQLite stays lane-local; worker rollout files persist for active-usage cuts. Native auth/config stay
put. The printed PID is the supervisor's.

**Before it launches, it applies `in-progress` to `#<N>`**, so the lane counts as busy from the dispatch (`docs/maintainers/josh-commands-run-rationale.md` → "`josh lane:dispatch` applies `in-progress` before it launches"); a label it cannot apply stops the launch.

Blank means unset. The inherited agent session identifier selects the provider, then
`JOSH_AGENT_PROVIDER`; with neither — a plain terminal — the provider defaults to Anthropic (Claude
Code) and the launch says so — on the dispatch line, and on stderr for `run:wake --start`,
`review:brief` and `ship --detach`. Conflicting identifiers (both a Codex and a Claude Code session)
and a `JOSH_AGENT_PROVIDER` naming no allowed provider refuse launch, as does an invalid model/effort
or an unavailable selected CLI/auth. A selected provider is never swapped for the other, and there is
no promotion or worker retry. OpenAI
defaults to `gpt-6.1-sol` with scheduler/worker/reviewer efforts `medium`/`medium`/`high`; the worker
drops to `low` only in the pre-gate phase, on either provider.

The defaults are pinned model ids rather than an alias such as `opus`, so a run log names the exact
model and a model migration can be measured at unchanged effort. Before launch the selected CLI's
version is checked against the model it will run: `claude-opus-5-5` needs Claude Code 2.1.280 or later
(`claude update`), `gpt-6.1-sol` needs Codex CLI 0.159.1 or later, and a lane recorded with
`gpt-6-sol` still needs Codex CLI 0.155.0 or later
(`npm install -g @openai/codex@latest`). A CLI below the floor, or one whose version cannot be read,
refuses launch with that update named — never a quiet switch to an older model. A lane keeps the
profile it recorded at dispatch: a cut, resume or wake of a lane created before a migration stays on
its recorded model (a model the floor table does not name is not version-checked), and only a newly
dispatched lane takes the new default. `JOSH_{ROLE}_MODEL` overrides reach new Claude Code launches
only; they never rewrite a recorded lane. Legacy
`JOSH_LANE_MODEL/EFFORT` is worker-only; migrate to `JOSH_WORKER_MODEL/EFFORT`.

**Output / exit codes:** prints the child's pid on stdout. Every refusal exits non-zero and sends a `warning` — including one because the `in-progress` label could not be applied (no log path, since nothing started). A child that started but whose log could not be opened warns and exits zero (`dispatched`).

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh lane:dispatch` in detail".

#### `josh lane:await`

Block until any of the named in-flight lane children confirms it has completed, then print which issue finished.

<!-- usage: lane:await -->

```bash
pnpm josh lane:await 1749 1750                   # block until either lane completes
pnpm josh lane:await 1749 1750 --owner "$PPID"   # reclaim the carry record for a resumed conversation first
```

<!-- /usage -->

`--owner <pid>` names the waiting session's process. When the carry record belongs to the same conversation under an earlier process — a restart resumed it in a new one — the record is moved to this pid before the wait, so a wait longer than the conversation's quiet window cannot read as a crash to `run:wake`. Any other record is left alone.

Polls each child's process every 5 s with a 15 s re-confirm window, so a process that briefly disappears (the pre-gate cut handoff) is not mistakenly declared done. Prints the issue number of the first child that confirms completion and exits 0; does not exit until one confirms.

#### `josh lane:launch`

One call per lane start: open the lane, then — only with `--stash` (the first lane alone) — pop that stash into it and re-install against the lock it brought in, then dispatch the child. A thin layer over `lane:open`, `stash:pop` and `lane:dispatch`, reusing their guards and messages.

<!-- usage: lane:launch -->

```bash
pnpm josh lane:launch 1749                                                  # every lane after the first
pnpm josh lane:launch 1749 --stash "backlogrun: josh latest before lanes"   # the first lane only
```

<!-- /usage -->

The child's pid is the one thing on stdout; a refusal is an empty capture beside a non-zero exit, as `lane:dispatch`'s is. A lane a park kept (dispatched before) is dispatched into, not reopened; a refused `lane:open`, pop or re-install stops it before dispatch.

#### `josh lane:sample` / `josh lane:stats`

Measure a lane limit: `lane:sample` takes a machine-load reading and `lane:stats --period <days>` prints a period's stage medians and maxima. Procedure and columns: [lane-limit-measurement.md](./maintainers/lane-limit-measurement.md).

<!-- usage: lane:sample -->

```bash
pnpm josh lane:sample   # one machine-load reading
```

<!-- /usage -->

<!-- usage: lane:stats -->

```bash
pnpm josh lane:stats --period 7   # a 7-day period's stage medians and maxima
```

<!-- /usage -->

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh lane:sample` / `josh lane:stats` in detail".

## Session and documents

### `josh cost`

Answer whether the next turn exceeds a context threshold: `--cut` uses the shared 135,000 limit, `--over <tokens>` an explicit one. History: `docs/maintainers/josh-commands-run-rationale.md` → "`josh cost` and `josh time` lost their report scopes".

<!-- usage: cost -->

```bash
pnpm josh cost --cut                # compare billed input per request with the shared 135,000 context-cut threshold
pnpm josh cost --over <tokens>      # compare with an explicit limit
pnpm josh cost --cut --path <dir>   # Anthropic project or current OpenAI worktree
```

**Options:**

- `--path <dir>` — selects another Anthropic project; OpenAI accepts only linked checkouts of the current project.

<!-- /usage -->

Either threshold prints `over` / `under` on stdout and measured input per request on stderr. OpenAI workers persist each generation's rollout, whose pre-terminal `token_count` events are read only when thread ID and normalized project cwd match.

**Output / exit codes:** no threshold selector prints usage; absent provider usage exits non-zero and says where it looked; a session with no requests says so rather than answering a verdict.

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh cost` in detail".

### `josh doc:section`

Print one section of a markdown document, so a `` `X.md` → "Heading" `` pointer costs a heading rather than a whole file.

<!-- usage: doc:section -->

```bash
pnpm josh doc:section <file.md> "<heading>"
pnpm josh doc:section backlogrun.md "The hand-off"
```

<!-- /usage -->

**Behavior:**

- A bare name resolves inside `.claude/skills/workflow-commands/`; anything that resolves as a path is taken as one.
- The section prints verbatim with its subsections (a `##` heading carries its `###` children).
- A heading, else a `**…**` label's item, matches as a prefix, exact first; two matches is a refusal.
- Fenced blocks are skipped, so a fenced `#` comment does not end a section.
- **Past the Bash cap the section is written as part files**, each under the cap and together exactly the section, and only their paths are printed — read every part with the Read tool in one turn. `issue:read` and `issue:state` do the same.

**Output / exit codes:** an unresolvable heading exits non-zero and lists the document's own headings.

### `josh read:set`

Say what a workflow entry point reads before it starts, and what that read costs.

<!-- usage: read:set -->

```bash
pnpm josh read:set                     # every entry point
pnpm josh read:set backlogrun          # one of them
pnpm josh read:set backlogrun --json
```

<!-- /usage -->

Two figures under one definition, which is what makes a before and an after comparable:

| Figure   | What it counts                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `whole`  | Every file in the set read in full, the cross-referenced ones included — what a run pays with no way to fetch a heading |
| `scoped` | The set's own files in full plus the referenced **sections** alone — what the same run pays with `josh doc:section`     |

- **The set is derived, never transcribed.** The files come from `SKILL.md` → "1. Which file to read" and the sections from the `` `X.md` → "Heading" `` references those files carry.
- `SKILL.md`'s own cross-references are not counted; a reference into a file the entry already reads whole, into `CLAUDE.md`, or into a `prompts/` topic is not counted either.
- **An unresolvable reference is charged at its whole file** — reporting it at zero would let a broken pointer read as a saving.
- A file cited more than once is charged once, over the union of the lines its references cover.
- Each file row names the tool that can deliver it whole; a file over the Bash cap is marked `Read (over the Bash cap)` — one `Read` call per file, never `cat`.
- A `-- read at the point of use, not at the entry --` block lists `latest-gate.md`, `followup.md`, `chain-rule.md`, `background-commands.md` and `pre-gate-cut.md` with their costs; they are listed, not counted in `whole`/`scoped`. Why `pre-gate-cut.md` is among them: `docs/maintainers/josh-commands-run-rationale.md` → "`josh read:set` lists `pre-gate-cut.md` as a point-of-use read".
- `total read` sums the scoped entry read and the point-of-use documents that entry actually reaches — the figure a before/after compares.
- **Every row and the total carry a per-run dollar figure** — the cache-read rate times the run size the report states.
- **`lane-child` is a synthetic entry**: `pnpm josh read:set lane-child` prints the trimmed set a dispatched lane child reads.
- **`backlogrun` prints a trimmed parent set** the same way: the parent is the scheduler and never implements, so it skips `SKILL.md` §3. It is a _different_ trim from the lane child's — the parent keeps §0, which is the scheduler's own, and drops no point-of-use document, since it is the one dispatching children and running lanes.

**Output / exit codes:** an unrecognized keyword is refused with the known ones listed, rather than reporting a saving of zero.

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh read:set` in detail".

### `josh doc:read`

A Bash-cap-safe read path for a whole document.

<!-- usage: doc:read -->

```bash
pnpm josh doc:read CLAUDE.md       # under the cap: prints the document
pnpm josh doc:read backlogrun.md   # over the cap: prints a directive, no content
```

<!-- /usage -->

- Resolves the file exactly as `doc:section` does — a bare name inside `.claude/skills/workflow-commands/`, anything that resolves as a path taken as one.
- **Under the Bash output cap it prints the document; over it, one directive line and no content** — this never emits the over-cap document through the shell, so the `Read` tool reads it once.
- The cap is read from `.claude/settings.json`, the same figure `read:set` marks its rows against; `doc:section` remains the way to fetch a single heading when the whole file is not wanted.

**Output / exit codes:** an unreadable file exits non-zero; an over-cap document prints its directive and exits zero.

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh doc:read` in detail".

### `josh read:files`

Read several files in one call, so the reads that precede a run's edits fold into one turn.

<!-- usage: read:files -->

```bash
pnpm josh read:files a.ts b.ts c.ts   # under the cap: prints each file under its own header
pnpm josh read:files a.ts big.ts      # over the cap: prints a directive to Read them in one turn, no content
```

<!-- /usage -->

- **The mid-implementation counterpart of `run:prep`**: it folds the reads of the files Step 0 named as edit targets into one turn.
- Each present file is printed under a `===== <path> =====` header. **Under the Bash cap it prints every file; over it, a directive and no content** — the `doc:read` invariant — naming every path and telling the run to Read them **in one turn**, so the reads stay folded on the fallback too. A missing path is named on stderr and makes the call non-zero.

**Output / exit codes:** any missing path exits non-zero; an over-cap batch prints its directive and exits zero.

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh read:files` in detail".

### `josh edit:files`

Apply several content-addressed edits from a plan in one call — the write-side counterpart of `read:files`.

<!-- usage: edit:files -->

```bash
pnpm josh edit:files plan.txt      # applies every block in the plan, one line per edit reporting the outcome
pnpm josh edit:files - <<'EDITS'   # plan from stdin, then EDITS
```

<!-- /usage -->

- **`-` needs no plan file** — the lane form (`report-format.md`); quote the delimiter so nothing expands.
- **Fall back to `Edit`** for a `dependent` edit, one edit, or a `Write`; no `format:edited` runs.

- **Why a command at all.** A `pnpm josh` command runs on every harness, and a composite command is the only lever measured to move round-trip density, never advice. The measurement: `docs/maintainers/josh-commands-run-rationale.md` → "`josh edit:files` is a command rather than advice".
- **The plan is a `=====`-fenced path header then a git-conflict-marker pair**, so a model authors it without escaping code into JSON. Several blocks may name one file:

  ```
  ===== scripts/a.ts =====
  <<<<<<< OLD
  const a = 1
  =======
  const a = 9
  >>>>>>> NEW
  ```

- **Each edit is content-addressed**: its `old` text must match exactly once — zero matches is `no match`, more than one is `ambiguous (N)` — so a false fold surfaces rather than corrupts, the same guarantee the `Edit` tool gives. A file is written **only when every one of its edits applied**, so a partial plan leaves the file untouched.
- **`dependent`**: an earlier edit touched this one's text; file untouched.
- **The batching guard hands it out.** On a run of single-call `Edit` turns the notice names the edits and offers `pnpm josh edit:files` over their files (`turn-batching.md` → "実装中の独立編集に効く合成コマンド"), the write-side of the read fold.

**Output / exit codes:** one line per edit (`applied` / `no match` / `ambiguous (N)` / `dependent` / `missing`); any non-`applied` edit, an unreadable plan, or a plan with no blocks exits non-zero.

### `josh time`

**Kit-only** — hidden from a consumer's `josh --help` and refused there with guidance; run it from the kit repository. Its CLI and run-state support live under the undistributed `scripts/time/`, while the runtime analysis the hooks, guards and `josh cost --over` rely on stays distributed under `scripts/time-runtime/`.

Report where a run's wall clock went, read from the same transcripts `josh cost` prices and, for the part no transcript records (CI, merge), from GitHub.

<!-- usage: time -->

```bash
pnpm josh time                                   # the last run tree, wall clock and cost by role
pnpm josh time --run                             # the same run-tree scope, named explicitly
pnpm josh time --json                            # the same figures, machine-readable
pnpm josh time --path <dir>                      # read another project's transcripts from this checkout
pnpm josh time --split-at 2026-10-16T21:33:19Z   # the same tree compared by role before and after a merge
```

**Options:**

- `--run` — (default) the whole run tree, wall clock led beside dollars. It is the only scope; any flag not listed here is a usage error (exit 1). History: `docs/maintainers/josh-commands-run-rationale.md` → "`josh cost` and `josh time` lost their report scopes".
- `--path <dir>` — aim the read at another project (absolute path); keeps the `cwd` behavior when absent.
- `--json` — the run tree, machine-readable.
- `--split-at <ISO time>` — add a before → after block by role (time share, cost share, req/session), each session on the side of its first request; an unparseable time is a usage error (exit 1).

<!-- /usage -->

**Output:** the run-tree report — a header, a by-role breakdown and a per-session list, led by a run-state block when the run is unfinished. An unmeasured figure prints `not measured`.

**Output / exit codes:** an absent or untimed transcript exits non-zero and says where it looked.

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh time` in detail".

### `josh retrospective`

**Kit-only** — hidden from a consumer's `josh --help` and refused there with guidance; run it from the kit repository. It reads kit's own development run — the transcript store, the review-finding ledger and the run event stream — so it means nothing in a consumer project.

Aggregate a finished run's four existing measurements into one digest, so the end-of-run retrospective has one place to read the run it just closed. It adds no new measurement.

<!-- usage: retrospective -->

```bash
pnpm josh retrospective   # the digest for the run this checkout carries
```

<!-- /usage -->

The run driver prints this at the stop position (`josh run:step`), once per invocation, when a run drains its backlog; a dispatched lane child never runs it. **What to file from the digest is `retrospective.md`'s** — this command only reads and shapes.

**Output:** four sections — the run tree's cost and time by role (flagging a role whose time share runs ahead of its cost share), the recurring review findings with their zero-finding denominator, the count of observation-ledger entries held, and the run's friction events (parks, outages, cuts, review rounds) — closed by a pointer to weigh them against `retrospective.md`.

The cost and time section ends with the `josh cost:audit` summary line for the last seven days, so the run is read against its trend.

### `josh cost:audit`

**Kit-only** — hidden from a consumer's `josh --help` and refused there with guidance; run it from the kit repository. It reads kit's own transcript store, kit-lanes included.

Report what AI work cost over a period, set against the period before it, so a cost reduction can be watched after it lands rather than measured once by hand.

<!-- usage: cost:audit -->

```bash
pnpm josh cost:audit               # the last 7 days against the 7 before
pnpm josh cost:audit --period 30   # the last 30 days against the 30 before
```

**Options:**

- `--period <days>` — the length of each period, a positive whole number of days (default 7).

<!-- /usage -->

It prints the total, the merged pull requests and the cost per merge (omitted when GitHub cannot be read), then one table each by session kind, tool category and guard. A row that grew past `REGRESSION_THRESHOLD` (`scripts/cost-audit/cost-audit.ts`) is marked `regression`, and the closing line lists them. `josh retrospective` carries its one-line summary.

It exits `0` on a report, and `1` with the usage on a `--period` that is not a positive whole number of days.

### `josh eval`

**Kit-only** — hidden from a consumer's `josh --help` and refused there with guidance; run it from the kit repository.

Run the agent rule-compliance scenarios and report how many held.

<!-- usage: eval -->

```bash
pnpm josh eval                       # every scenario
pnpm josh eval consult-not-execute   # one scenario by name
```

**Options:**

- `JOSH_EVAL_MODEL` — the model to run against (default `sonnet`).
- `JOSH_EVAL_CONCURRENCY` — how many sessions run at once (default `5`); a non-positive-integer value is refused.

<!-- /usage -->

Each scenario replays a situation against a real Claude session in a sandbox and judges the tool calls it made, never what it said. Needs the `claude` CLI; not part of CI. Scenario format: [docs/maintainers/eval.md](./maintainers/eval.md).

**Output / exit codes:** exits `0` only when every scenario held. The last line is a verdict — `held`, `blocked`, `unmeasured` or `unreachable`; `blocked` stops a merge, the others are reported but do not. Three whole-suite runs ending on the same non-`held` verdict print a `Warning: N runs in a row…` line above the verdict.

Detail: `docs/maintainers/josh-commands-run-rationale.md` → "`josh eval` in detail".
