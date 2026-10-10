# josh CLI — Run, Lane and Session Command Reference

The commands the issue-driven workflow (`fullrun`, `backlogrun`, …) and its lanes call to hold, step, cut and ship a run, the lane commands, and the session-budget and document-reading commands a run uses. Moved out of [josh-commands-automation.md](josh-commands-automation.md), which keeps the other automation commands; the commands you type by hand are in [josh-commands.md](josh-commands.md), and every command is indexed in the [Command Catalog](josh-command-catalog.md). The issues each command came from: `docs/maintainers/josh-commands-run-rationale.md` → "Where each command came from".

## Run lifecycle

### `josh run:hold` / `josh run:release`

Guard a working tree so only one run holds it at a time — `run:hold` claims it, `run:release` clears the claim. The unit is the working tree, so two lanes of one repository key differently.

```bash
pnpm josh run:hold 1091          # claim for issue 1091
pnpm josh run:hold 1091 --fullrun  # claim as `fullrun #1091` (what `run:entry` runs)
pnpm josh run:release 1091       # release this run's own record
pnpm josh run:release --force    # clear a record left by a run that has ended
```

**Options:** `--fullrun` (`run:hold <N>`) marks the record as `fullrun #N`'s; `--halfrun-stop` marks a `halfrun` stop for `run:entry` to adopt; `--prrun-stop` marks a `prrun` stop with the commit its pull request is on; `--force` (`run:release`) removes a record this run did not write, clearing another run's stale claim.

**Output / exit codes:** stdout is one token; explanations go to stderr. `run:hold`: `hold`, `busy`, `reclaim` / `resume` / `park` (preflight found uncommitted work, an open PR or a branch with commits beyond the default branch or uncommitted changes in its lane, or a merged/closed PR; a branch with none of those is no leftover work), `unknown` (exit 1). `run:release`: `released`, `none`, or `held` (exit 1). A record over 8 hours old on a clean tree is replaced; on a dirty or unreadable one, `busy`. A `hold` answer is followed by the `josh run:tidy` sweep below, reported on stderr.

### `josh run:tidy`

Sweep what merged work left behind — run by `run:hold` after every successful claim, and by a `backlogrun` in its once-per-repository preparation.

```bash
pnpm josh run:tidy
```

- **Lanes:** closes a lane whose issue was closed by a merge, whose work tree has no uncommitted change, whose branch has no commit that no remote reaches, and that no live run holds — then releases its run record.
- **Stashes:** drops an entry when every issue its message names (`#N`, a leading `N: `, or an `On N-lane:` branch) was closed by a merge. An entry that touches the observation ledger has its ledger lines appended first to the running work tree's own ledger file, less those any file of `.josh/observations/` already holds.
- **Left alone:** an issue closed as not planned or without a merged pull request, an open issue, a stash naming no issue, a lane with changes or unpushed commits, and a lane the running `backlogrun` launched and has not settled — its `run:merge` (or `run:carry --end`) records that merge.

"Closed by a merge" is read from the issue's REST timeline: its latest closed/reopened event is `closed` as completed (not `not_planned` or `duplicate`) and a merged pull request cross-references it.

**Output / exit codes:** always exits 0. What was cleaned and what was kept (with the reason) goes to stderr; nothing is printed when nothing merged was found.

### `josh run:carry`

Carry one invocation's budget across its own session cuts, so a resumed `backlogrun` continues the authorized run instead of starting a second one.

```bash
pnpm josh run:carry --begin "backlogrun --max 5" --owner "$PPID"
pnpm josh run:carry --json                          # read the record back in a resumed session
pnpm josh run:carry --cut --owner "$PPID"           # hand the record off before a cut
pnpm josh run:carry --retrospective --summary "0 filed; dropped #2240 already merged" --owner "$PPID"  # close the end-of-run retrospective
pnpm josh run:carry --resume "backlogrun --max 5" --owner "$PPID"  # adopt a record no cut handed off
pnpm josh run:carry --end --stopped "epic #2126: everything is blocked behind parked #2118"  # end + push
```

**Options:**

- `--owner <pid>` — the long-lived process spending the budget (`$PPID` under a loop); required by counts and `--begin` / `--resume`. A live PID stays `busy` if probes fail.
- `--done <issue>` shrinks a named-issue run's `remaining` list; `--merged <issue>` names the merged issue and counts it once against `merged_issues`, so a merge `run:merge` already recorded is not counted twice; `--filed` / `--cut` are increments, never totals.
- `--retrospective` marks the end-of-run retrospective run, once per invocation, and requires `--summary <text>` — the same close writes that result as one `retrospective` event on the run's event stream (best-effort), so a run that filed zero improvements reads apart from one whose retrospective never ran. Either flag without the other is refused.
- `--stopped <reason>` rides on `--end`: the run ended by _stopping_ rather than finishing, so one ⏸️ confirmation is pushed with the reason as the record is cleared, reaching the person after a cut a headless parent's report would not. A bare `--end` (a clean finish) stays silent, and because `--end` removes the record a second `--end --stopped` never sends twice. Named without `--end` it is ignored.
- `--end` over a live record flushes pending ledger lines once; a failed flush goes to stderr and the record is still cleared.
- `--end` over a live record first collects each lane the run launched and never settled whose issue merged — closed by a merged pull request, or left open behind one — exactly as `run:merge` would: the merge is counted, put on the event stream and in the ledger, and the lane closed. A lane a detached `josh ship` still supervises, or one that did not merge, is left; a failed collection goes to stderr and the record is still cleared.
- `--end` keeps the run it removes as the last ended run — its invocation, start and end, one record overwritten by the next `--end` — so `run:board` can still draw a finished run.

**Output / exit codes:** stdout is one token (`--json` prints the record on one line). `began`, `resumed`, `carried`, `counted`, `ended`, `expired` exit 0; `busy`, `standing`, `mismatch`, `unreadable`, `unknown`, `over` exit 1; `none` exits 0 for a read/end, 1 for a count/resume.

### `josh run:add`

Add issues to the `backlogrun` running in this repository without stopping it. A running child is never interrupted: an added issue takes the next lane that frees.

```bash
pnpm josh run:add 101 102                 # ahead of the rest of the queue (`#N` works too)
pnpm josh run:add 101 --no-priority       # at the end of the queue
```

- A child filed into an epic the run names needs no `run:add`: `backlog:drive` reads that epic's current children on every pass.
- Each issue gets `auto-ok` and `run:lane`, plus `priority:high` unless `--no-priority`. A `backlogrun #N --only` run also gets the issue written to its carry record, so its named list includes it; the recorded invocation is never rewritten.
- A closed issue, one that could not be read, or one a label would not apply to is refused; the others are still added. An issue with open blockers is added and reported as waiting on them.
- Each added issue is written to the run's event stream as an `add` event, which wakes a `run:progress --wait` so the run offers the issue the next free lane.

**Output / exit codes:** one line per issue — `queued #N · next free lane`, `queued #N · end of the queue`, `queued #N · waiting: blocked by #M`, or `refused #N · <reason>`. Exits 0 when every issue was added, 1 when any was refused or no `backlogrun` is running here (nothing is added then), 2 on a malformed argument.

### `josh run:wake`

Continue a cut `backlogrun` from outside the conversation. The detached supervisor adopts the handed-off carry record, runs `backlog:drive`, and starts an AI session only for a driver branch requiring judgment. A dead owner can be recovered through the same path.

```bash
pnpm josh run:wake --start                 # launch the detached supervisor
pnpm josh run:wake --list                  # supervisor state, cut/wake counts, latest progress line
pnpm josh run:wake --stop                  # stop it
pnpm josh run:wake --loop --interval 30    # run the loop body in the foreground
```

`scheduler` runs provider; listings show profile/result. Anthropic defaults. OpenAI uses worktree-local
`sqlite_home` and `--ephemeral`, retaining native auth/config. Unclaimed wakes try thrice.

**Ordinary work launches no parent AI session.** The driver uses the carry record's named list, the
existing backlog offer, lane launch and merge commands. It performs the idle watch and final report
itself. A judgment handoff includes the driver's verdict, affected issue when present, diagnostic
output and resume flags. The carry record prevents a restarted supervisor from counting a merge into
another live owner's run.

**A failure is visible rather than silent.** A judgment wake that never claims the carry record is
retried, and once the retries are spent the supervisor stops and sends a `warning` Telegram; a carry
record that expired or cannot be read ends it the same way. A `failed` stop while the carry record is
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
either provider, and legacy `JOSH_LANE_*` values to the worker only. With no session marker and no
`JOSH_AGENT_PROVIDER` the provider defaults to Anthropic (Claude Code), which is what lets a person
launch from a plain terminal. Invalid configuration, conflicting session markers, or a missing,
outdated or unauthenticated CLI refuses without fallback, promotion or worker retry.
`run:wake --list`, `lane:list`, the review brief and each launch log expose the resolved provider,
role, model and effort; the worker's launch is "`josh lane:dispatch`".

**Output / exit codes:** stdout is one token; stderr explains. `started`, `running`, `supervising`, `stale`, `stopped`, `ended`, `expired`, `unreadable` exit 0; `none` exits 0 for `--list` / `--stop` and 1 for `--start`; `failed`, `unknown` exit 1. `expired`, `unreadable`, and `failed` each warn.

### `josh run:cut`

Cut a dispatched lane child before the verification gate. OpenAI uses its lane supervisor; Anthropic
relaunches directly. With no matching supervisor, OpenAI returns `failed` before writing the cut.
Outside a lane only an `--impl` cut on a tree `run:hold <N> --fullrun` holds for that issue is taken
: the record is written and nothing is relaunched, so the session ends its turn
and a fresh `fullrun #<N>` resumes it; every other cut outside a lane answers `not-a-lane`.

```bash
pnpm josh run:cut 1839                          # take the cut and hand it to a fresh process
pnpm josh run:cut --impl 1839 --handoff .claude/tmp/handoff-1839.json  # cut mid-implementation, carrying the instruction
pnpm josh run:cut --resume 1839                 # a fresh process's entry check
pnpm josh run:cut --end                         # clear the record
```

A cut that resumes back into implementation (`--impl`) carries a **handoff** — the run's
instruction verbatim and a curated list of what is done, what remains, and what was deliberately left
alone. It is passed by path with `--handoff <path>`, never inlined, so a
backtick or `$` in the instruction is not executed. The record stays small (bounded, a few short
lines); the resume prints the handoff to stderr so the fresh process continues on the instruction
rather than the working tree alone, and a resume that finds no instruction is refused `incomplete`
rather than continuing blind.

The relaunched child is started at the **effort of the phase it resumes into**: a pre-gate resume drives the gate, commit, PR and merge — the mechanical ship/bookkeeping region, lowered — while an `--impl` resume into implementation keeps the role default. A stored lane profile keeps its model and takes only the phase's effort, and a person's `JOSH_WORKER_EFFORT` still wins over the phase value. The phase names and the phase→effort table live in `scripts/agent/agent-role-profile.ts`, single-sourced so the phase a cut records and the phase the effort is keyed on cannot drift.

**Output / exit codes:** stdout is one token. `run:cut <N>`: `cut`, `not-a-lane`, `unready` (clean or default-branch tree), `busy`, `failed`, or `bad-handoff` (an unreadable or oversized `--handoff`, or an `--impl` cut given none — its resume would answer `incomplete`). `--setup` is a usage error: a lane child's context is bounded by the threshold-gated implementation cut alone (`docs/maintainers/josh-commands-run-rationale.md` → "`josh run:cut` lost its setup-phase cut"). `run:cut --resume <N>`: `fresh`, `resume`, `resume-impl`, `stale`, `busy`, `handed-off`, `incomplete` (matched the tree but carried no instruction), or `over` (an implementation cut asked for by a session still over the context-cut threshold; the record is kept for a fresh session).

### `josh run:liveness`

Say whether the delegated unit running a child is still working, or stopped without reporting. Two traces decide it: whether the transcript grew, and whether a child process is alive.

```bash
pnpm josh run:liveness 1169 --output <path>
pnpm josh run:liveness 1169 --output <path> --window 45 --gap 2 --repo joshuafolkken/app-kit
```

**Options:**

- `--output <path>` — absolute, under the home or temp directory; a symlink is followed and size compared as well as mtime.
- `--process alive | none` — overrides the process trace, which the command otherwise reads itself: the child's own command line (`fullrun #<N>`) or its detached ship supervisor.
- `--window <min>` — silent window the file must be frozen for (default 30); `--gap <sec>` — spacing between samples (default 5); `--repo <owner/name>`.

**Output / exit codes:** stdout is one token; stderr explains. `alive`, `stopped`, `settled` exit 0; `undetermined` exits 1. Growth in the transcript answers `alive` on its own. Two `undetermined` answers in a row is a check fault; the caller stops polling rather than escalating to `stopped`.

### `josh run:ending`

Classify how a dispatched lane child _ended_ — a different question from `run:liveness`'s "is it still going". `run:liveness` cannot see a child that stopped mid-implementation: its output freezes exactly as a completed child's does, and a `subtype: success` exit reads as a clean finish. This reads three traces the child leaves behind — a carried cut record (it handed off), a CLOSED Issue (it merged), or an OPEN Issue with no cut (it ended in the middle) — and, for the last, prints the exit-record basis a park comment should carry.

```bash
pnpm josh run:ending 2118 --output <path>
pnpm josh run:ending 2118 --output <path> --repo joshuafolkken/app-kit
```

**Options:**

- `--output <path>` — the child's transcript, absolute and under the home or temp directory (validated the same way `run:liveness --output` is).
- `--repo <owner/name>` — a child in another repository.

**Output / exit codes:** stdout is one token; stderr carries the reason and the basis. `merged`, `cut`, `outage`, `abandoned` exit 0; `unreadable` exits 1. The verdict never reads `is_error: false` as a completion — completion is the CLOSED Issue. A mid-implementation ending is split in two: `outage` when the exit record ended in error on a transport-failure signature — the API could not be reached — and `abandoned` otherwise. The `abandoned` basis names the exit-record fields read (`subtype`, `num_turns`, `permission_denials`) and whether work remains; the `outage` basis names the signature, so the parent leaves the child re-dispatchable.

### `josh run:prep`

Bundles the reads a run makes before its first edit into one call.

Its `=== ship preconditions ===` section asks, ahead of the ship, the two refusals `josh ship` would otherwise meet at the run's largest context: a missing release classification in the Issue body, and a runtime change whose open PR body has no `## 実機証跡` section. `met` when neither applies; `unmet` lists each, so they are fixed before the gate. The ship and `followup` still refuse on both.

### `josh run:entry`

Opens a run in one call: `run:hold`, `cost --cut` (skipped in a lane
child), `run:prep` and `run:step`. The `entry #<N> — hold: … · cost: … · verdict: …` line carries the three facts the run
branches on; a `busy`/`unknown` hold or an `over` budget short-circuits with a non-zero exit — the
shape `backlog:offer` folded the parent loop head on. It asks `run:cut --resume <N>` before the hold: any answer but `fresh` prints `entry #<N> — resume: <token>` with that command's exit code and claims nothing, since an implementation cut outside a lane keeps its hold. A stopped `halfrun`'s hold is adopted: `resume: halfrun`. A stopped `prrun`'s is adopted too, as `resume: prrun-merged` (merged by hand — the tail only), `prrun-merge` (unmoved here and on the pull request, and clean — merge without the gate) or `prrun-gate` (moved or dirty — the gate again).

`--to kickoff|halfrun|prrun|fullrun` names how far the run goes (default `fullrun`). Unless a cut resumes, the first line is `stage #<N> — at: <state> · to: <command> · start: <start>`: the state is read off the issue (`fresh`, `planned` from the `run:planned` label, `halfrun-stopped` / `prrun-stopped` from the hold's stop mark, `merged` from a closed issue) and the start is `plan`, `implement`, `gate`, `followup` or `reached`. `reached` prints that line alone and exits 0, except a merged issue under any command but `--to kickoff`, which falls through to the ordinary `already-done` / `keep-work` entry. `--to kickoff` never asks `run:cut` and claims nothing; `--to halfrun` claims without the `--fullrun` mark. The stage table is `docs/how-to/run-issues.md`.

### `josh run:status`

Bundles a run's read-only status — issue state, `cost --cut` verdict, and carry counters — in one
call, `--repo` for a cross-repo child. Writes nothing.

### `josh run:next`

Prints the next step a `fullrun` takes, computed from the run's state rather than read out of prose. It reads exactly what `run:prep` reads — the issue state, the
`human_review` line and the dependency scope — by calling `run:prep`'s own gather, and maps the four
facts to one step: a `CLOSED` issue is already done, a `required` dependency scope is updated first, a
`needs-human-review` issue stops before its commit, and everything else is the ordinary implement step.
History: `docs/maintainers/josh-commands-run-rationale.md` → "`josh run:next` and `josh run:prep`".

### `josh run:step`

Prints the run's next single action, computed from the event stream (`run:event`), the carry record
(`run:carry`) and the issue state (`run:prep`) — never the conversation
. It lifts `run:next`'s fold from an _event_ to a whole _run_, printing one
line: a runnable command for a phase that has one (`followup` after a PR opens, `run:merge <N>` after a
merge, `backlog:next` after a park, `run:cut --resume <N>` after a cut — until a `resume-impl` answer
appends `resume`, which reads as `implement` again — `run:carry --cut` after a
Codex parent's dispatch below the cut cap), a fixed verdict otherwise
(`implement`, `human-review`, `update-deps`, `already-done`, `wait`, `stop`, `unknown`), or a `decide:`
line for the one Tier-B point it surfaces — a spent whole-run budget. It dispatches rather than
re-decides: a merged child's outcome stays `run:merge`'s, the next issue `backlog:next`'s. `run:next`
is now its degenerate form — the pre-implementation position mapped to prose over the one shared
mapping, so there is no second implementation.

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

```bash
next=$(pnpm josh run:merge <N> --epic <E> --repo <owner/repo> --owner "$PPID" --output <path>)
pnpm josh run:merge <N> --owner "$PPID"   # backlog offer (no epic)
```

Confirms the child from GitHub and, by what it turned out to be, does the post-merge steps: a **merged**
child (CLOSED) is counted into the carry record (which resets the failure streak), then `main:sync`,
`lane:close <N>`, and the counters mirrored onto the epic comment; a **parked** child (`needs-decision`
or `already-done`) is left alone; an **outage** child (OPEN, unparked, exit record shows it could not
reach the API) has its stale `in-progress` dropped but is **not** parked and
**not** counted, staying re-dispatchable; a **failed** child (OPEN, unparked, not an outage) has its
stale `in-progress` dropped, is parked with `needs-decision`, and counts against the failure guard.
A **cut** child (OPEN, unparked, its lane holding a declared cut with its handoff that no successor
adopted) is neither parked nor counted: its successor is relaunched in the same
lane through the relaunch the cut itself uses, once per cut; a relaunch that cannot start, or a second
unadopted return, is the failed child instead. An OpenAI lane is left to its supervisor.
`--output <path>` names the transcript the outage split reads; absent, it is off.

**Output:** one child number (or several, one per free lane), or a verdict token. Beyond the offer
`epic:next` prints (`run` becomes numbers; `wait` / `stop` / `complete` / `error` pass through), it adds
`over` (the merge crossed the shared 135,000 context threshold, so hand the lanes over and cut), `human-review` (the child stopped
before its commit — stop), `stop` (failure guard), `environment` (the consecutive-outage guard tripped —
the API is down), `resumed` (a cut child's successor was relaunched — await that lane again), `retry`
(unreadable), `busy` (refused count; exit 1).

**Options:**

- `--epic <E> --repo <owner/repo>` — offer the epic's next children; omit both for the opted-in backlog.
- `--owner <pid>` — the parent's process, so the carry count respects the ownership guard.

### `josh run:review`

Starts the gate in the background and prints the whole `/code-review` brief in one call, so a lane
child launches the two together and they overlap. It composes
`josh gate` and `josh review:brief` and changes neither, so `review:attest --check`'s nonce/checkout
contract is minted exactly as before.

```bash
pnpm josh run:review          # detach the gate, print the brief; then launch the /code-review subagent
pnpm josh run:review --join   # after the review returns: join the gate, check its verdict
```

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

### `josh ship`

Ships a finished change in one call: the gate, the commit/push/PR (`git -y`), the CI-wait merge
(`followup`, kept in the foreground) and the report bookkeeping (`run:tail`), run in order and joined
under one header per step. It extends `run:tail`'s post-merge fold into the body of the region.
Unlike `run:tail` it stops at the first failed step — a red gate never reaches the commit — and closes
the report with the name of the stopped step, so the run reads only that one. The first positional is
the `"<title> #<N>"` string `git -y` and `followup` already take; the issue number is read off its tail
for `run:tail`, `--notify-message` is forwarded to `followup` alone, and `--body-file <path>` — the PR body carrying the live-execution evidence `followup` gates on — to `git -y` alone. Any further positionals are
follow-up citations filed this run — branch-2 filing runs before `ship` — forwarded to `run:tail` after
the closed issue so `issue:cite` reports them too. The one decision the region carried — disposing of a
review finding — stays in front of this command.

A `preflight` stage runs first: it asks every pull-request precondition at once — `git -y`'s preflight (release classification, branch and title checks) and, for a runtime change, the `## 実機証跡` section `followup` gates on, read from `--body-file` or else the open PR's body — and reports them together, then meets the scoped lint/test pair. A stop those checks would cause therefore lands before the review and the gate rather than after them. The gate stage meets the scoped pair again before `josh gate`, as a round-1 reviewer may have edited the tree since. The checks themselves are unchanged; only where they run moved.

A re-run resumes: a per-issue stage record, honored only where the actual
state (committed, pushed, merged) corroborates it, passes over finished stages; each stage is logged
as a `ship-stage` trace event.

`--review` runs review round 1 beside the gate, after any scoped check not yet green. The round-1 reviewer fixes a small, local Medium in place and marks it `fixed `, counted once the scoped pair is green; a High, an unfixed Medium or a refusal stops the ship. After the commit a `round-2` stage asks `review:round2 --round-1-closed` and, on `required`, runs the scoped pair, `review:brief --round 2`, a fresh read-only reviewer, attest and record — anything but a clean or Low-only round 2 stops before `followup`.

`--detach` (implied in a lane child): a supervisor; a stop emits `ship-stop` (`--log <N>`). The preflight, type check and doc tests run before the hand-off; a stop returns to the same session.

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

```bash
pnpm josh run:report   # print the report; the same text josh notify sends
```

### `josh run:event`

Appends to, or reads back, the run's append-only ordered event stream. Keyed to the run's identity — the common git directory `run:carry` uses — so parent and every
lane child append to one stream that survives a session cut; `--from` reads everything after a position,
`--last` the newest event alone, `--follow` one bounded read that waits, and
`--watch` every event in order, for debugging — the ambient pane is `run:board`, which `.vscode/tasks.json` opens on folder open.

```bash
pnpm josh run:event --append <kind> <text>   # append one event; prints its position
pnpm josh run:event --from <position>         # every event after <position>, in order (JSON)
pnpm josh run:event --follow <position>       # new events, waiting for one; position on stderr
pnpm josh run:event --watch [<position>]      # every new event, rendered, until interrupted
pnpm josh run:event --last                    # the newest event alone
```

`--follow` is `--from` that waits: it returns the moment an event is past `<position>` and otherwise at
the interval. Events go to standard output and the next position to standard error — the same before
and after a cut, the stream the run's, the position the caller's.

`--watch` loops that pass, printing `HH:MM · <label> · <text>` in the session language.

`<kind>` is one the single enumeration names (`plan`, `child-launch`, `merge`, `park`, `outage`, `cut`,
`resume`, `stop`, `pr-opened`, `review-round`, `idle`, `filed`, `note`, `lane-phase`); a kind outside it is refused.
`lane-phase` is a lane child's first implementation edit, written by the PreToolUse hook.
`idle` is the idle watch's window, `filed` an Issue `issue:file` created, and `note` a one-line
observation below the filing bar (`run:board` shows all three). `run:merge` appends `merge`, `park`
and `outage`; other steps call `--append`. The stream is bounded, so an unattended run cannot grow it
without limit.

### `josh run:progress`

Report an unattended run's progress once it has gone quiet — the one josh command meant to be started and left running in the background.

```bash
pnpm josh run:progress --output <path>
pnpm josh run:progress --once                    # five labelled lines now, whatever the clock says
pnpm josh run:progress --interval 20 --repo joshuafolkken/app-kit --hours 4
```

**Options:**

- `--mark` — record that a real report happened without printing a line (keeps the last line for `run:wake --list`).
- `--path` — print the ambient heartbeat log's path and exit. Every heartbeat line is mirrored there, so `tail -F "$(pnpm josh run:progress --path)"` follows the run across a `backlogrun` session cut. Reads no run state, so it answers in a lane child too.
- `--interval <min>` — silence interval (default 20; also `JOSH_PROGRESS_INTERVAL_MINUTES`, then `josh.progress_interval_minutes`).
- `--wait` — start once in the background: each report goes to the event stream and ambient log, never stdout; exits only on an arrival, `josh followup` ending the run, or `--hours`.
- `--hours <n>` — how long the watcher lives (default 8 with `--wait`, 1 otherwise); `--repo <owner/name>` scopes the read.

**Output / exit codes:** stdout carries only the five labelled progress lines; notices go to stderr. `--once` with no run recorded prints nothing and exits 0; an unreadable listing exits 1. It sends no Telegram; `JOSH_PROGRESS=0` reports nothing (`--mark` still records).

### `josh run:board`

A full-screen board of the running `backlogrun`, redrawn every second for a person to keep open beside the run. `.vscode/tasks.json`, distributed by `josh sync`, opens it in a pane of its own when the workspace opens.

```bash
pnpm josh run:board          # redraw until interrupted
pnpm josh run:board --once   # one frame, then exit
pnpm josh run:board --chat   # one frame for a chat, recorded as a progress report
pnpm josh run:board --every 5   # the --chat frame as a 📊 Progress Telegram every 5 minutes, until the run ends
```

`--chat` answers a `backlogrun` progress question: the frame `--once` draws, with only `🧠` on the machine line and no escapes; it records the report as `run:progress --mark` does.

`--every <minutes>` answers a request for periodic progress off-screen, with no model in between: started in the background, it sends the `--chat` frame as a `📊 Progress` Telegram at once and every `<minutes>` after, sends the ended run's frame once after `run:carry --end` and exits; with no run here it sends nothing and exits. It runs only when a person asks for it — the `run:progress` heartbeat still sends no Telegram — and `JOSH_PROGRESS=0` sends nothing. A failed send is reported on stderr and the next interval sends again.

The header is two lines of symbols: the run's state (`▶` running, `⏸` idle, `✋` waiting on a person, `■` ended), a progress bar with arrivals as `(+N)` and per-state counts, `💓` age of the newest event (yellow after 15 silent minutes, red after 30), `⚠` only when a plan read failed; then `⏱` elapsed, `⌛` time left to the cut-off and the machine's gauges (`⚡` CPU, `🧠` memory, `💾` swap rate). While the run waits on an empty backlog it adds when the wait ends and why. Below: touched children — each with its elapsed `MM:SS` and a track of every phase it has passed (`investigate` → `plan` → `implement` → `review` → `gate` → `commit` → `followup`, read from the `child-launch`, `plan`, `lane-phase` and `ship-stage` events), a settled child's ending on its state icon — the `backlog:plan --waves` order under `── 1 ──` rules (epic children as a tree under the epic's title, other blockers as `🔗`), `needs-decision` and unreached children, and the newest filings, parks and notes. A dim legend at the foot names the symbols.

On a terminal it draws on the alternate screen, as `top` and `less` do, so redraws never grow the scrollback; Ctrl+C, SIGTERM or a normal exit restores the screen and the cursor that were there before. `--once`, or a stdout that is not a terminal (a pipe or a redirect), writes one frame with no screen control and exits — no color either when it is not a terminal.

**Output / exit codes:** the stream and lanes re-read at most every five seconds; the plan from GitHub at most every two minutes, keeping the previous one on a failed read. A touched child the open listing no longer holds is read from GitHub once — its title, when it closed and whether a merged pull request closed it — and drawn `✅` (merged) or `🏁` with its time; until that read answers it is drawn `🏁` with no time. After `run:carry --end` the board keeps the ended run — `■`, its duration as `⏱` and when it ended in the header, no `⌛`, only that run's events — until the next run begins. An ended run asks GitHub about its unread closed children once after it ended, then reads nothing until the next run. No run here, running or ended, prints `no run` and reads no plan. Exits 0; an unknown argument, or an `--every` that is not a positive number of minutes, exits 1; Ctrl+C exits 130 and SIGTERM 143.

### `josh run:watcher:guard`

Guard hook: exits non-zero when lane children are in-flight but `run:progress` has not pinged its life record recently (within three watcher ticks, roughly 90 s). Wired as a `PreToolUse` hook so the agent cannot issue the next Bash call while the watcher is stale.

```bash
pnpm josh run:watcher:guard
```

**Output / exit codes:** exits 0 when no lane children are in-flight or the watcher is fresh. Exits 1 and writes a note to stderr telling the user to restart `run:progress --wait` before proceeding.

### `josh run:stranded`

Report whether the run has been left stranded: the budget was handed off at a cut, the session that owned it has died, no successor ever claimed it, and no `run:wake` supervisor is watching. Three facts are read and never weighed — the carry record's hand-off, the owner's liveness, and the supervisor's — so a strand is detected without any judgement. Wired into the `Stop` hook beside `backlog:stalled`, so it runs at each loop boundary; a strand emits one marker on the run's event stream and sends one 🚨 Telegram naming the recovery. It reports, it never stops: a false positive costs one notification, never a halted run or a torn-down lane.

```bash
pnpm josh run:stranded
```

**Output / exit codes:** always exits 0, printing `stranded` or `ok` on stdout. Recovery is another actor's — the notification names `run:wake --start`, which wakes a fresh successor to claim the budget; the cutting session stays refused `busy` and must not resume the run itself.

## Lanes

### `josh lane:open` / `josh lane:close` / `josh lane:list` / `josh lane:prune`

Open and close a lane: one linked git work tree with its own branch and its own port seat. `lane:open` cuts from `refs/remotes/origin/<default>` (falling back to the local branch), attaches to an existing `<N>-lane` branch, installs dependencies (`pnpm install --frozen-lockfile`), and warms the gate caches from the main checkout. It also copies the pre-built hook bundles (`dist/hooks/`) from the main checkout so the lane's Claude Code hooks launch off `node dist/hooks/<name>.js` rather than the slower `pnpm josh …` fallback — those bundles are git-ignored, so a lane's work tree never carries them otherwise. A consumer repository needs no such copy: its hook commands already point at `node_modules/@joshuafolkken/kit/dist/hooks/`, which the install materializes; only kit's own lanes use work-tree-relative paths. When the main checkout has no bundles (a clone that never ran `pnpm build`), the lane opens without them and the first hook's ready gate builds them; a copy that fails never fails the open — best-effort, exactly like the gate-cache warming. A copied bundle stays in use only while its recorded content digest matches the lane's source; once the lane edits a hook's inputs, the ready gate rebuilds it (see [`josh batch:guard`](josh-commands-automation.md#josh-batchguard)).

```bash
pnpm josh lane:open 1490    # prints the lane directory on stdout
pnpm josh lane:close 1490
pnpm josh lane:close --all
pnpm josh lane:list
pnpm josh lane:prune
```

**Options:**

- `lane:close --all` — close every lane; `lane:prune` — close lanes left registered without a work tree, then remove unregistered lanes-root leftovers git can fully restore (the rest are kept with a reason).

**Settings:**

- `JOSH_LANE_ROOT` — where lanes go; unset means `.<repository-name>-lanes`, a hidden sibling of the repository root.
- `JOSH_LANE_LIMIT` — how many lanes one repository may run at once (default 6); applied by `josh epic:next`.

**Output / exit codes:** `lane:open` prints the directory on stdout (an empty capture plus non-zero exit is a refusal); explanations go to stderr. Seats are `1..9` (main work tree is seat 0), claimed atomically. A failed install fails the command; warming is best-effort. `lane:list` prints one line per lane — issue, seat, ports, branch, state, directory, output path, and profile.

**The `in-progress` / lane difference:** `epic:next` counts lane occupancy from the `in-progress` label list, while the lanes are the work trees actually open — and the two can disagree. `lane:list` names the difference on stderr, in both directions: an issue that carries `in-progress` but has no open lane (a stale label that silently shrinks the free-lane count), and a lane whose issue carries no `in-progress` label (which lets another session claim the same issue). The per-issue judgement is three-valued — `live`, `stopped`, or `unknown` when the lane listing could not be read — and `unknown` is never collapsed to `stopped`. It reads the two sets the way `epic:next` and `lane:list` already read them, and **it never changes a label** — clearing `in-progress` from a live run is a person's to do, since removing it is exactly what opens a second pull request.

#### `josh lane:output`

Record — or read back — where the delegated unit running this lane's child writes, so a session that did not open the lane can still poll it.

```bash
pnpm josh lane:output 1713 /abs/path/to/agent-7.jsonl   # record it; prints the path back
pnpm josh lane:output 1713                              # read it; prints the path, or `none`
```

The record lives in the lane's own `.env`; a lane whose `.env` cannot be read is refused rather than replaced.

**Output / exit codes:** the recorded path prints on stdout. `none` prints and exits non-zero (the lane is open but its child is not handed over yet).

#### `josh lane:dispatch`

Start a lane's child as a detached OS process, so cutting this session abandons nothing.

```bash
pid=$(pnpm josh lane:dispatch 1749)   # prints the child's pid; a refusal is an empty capture and exit 1
```

The invoking CLI selects the worker provider: Codex sessions use a detached
non-AI supervisor for Codex generations, while Claude Code sessions run unchanged `claude -p`.
SQLite stays lane-local; worker rollout files persist for active-usage cuts. Native auth/config stay
put. The printed PID is the supervisor's.

**Before it launches, it applies the `in-progress` label to `#<N>`** (creating the label if missing), so the lane counts as busy from the dispatch rather than only once the child's own `fullrun` reaches its apply (`docs/maintainers/josh-commands-run-rationale.md` → "`josh lane:dispatch` applies `in-progress` before it launches"). If the label cannot be applied it launches nothing and refuses; if the launch then fails it removes the label again, leaving no `in-progress` on an idle issue.

**Options:**

- `JOSH_{SCHEDULER,WORKER,REVIEWER}_MODEL` — Claude Code role overrides; Anthropic defaults are respectively `claude-opus-5-5`, `claude-opus-5-5`, and `claude-opus-5-5`. Codex keeps its provider-specific model.
- `JOSH_{SCHEDULER,WORKER,REVIEWER}_EFFORT` — role effort overrides for either provider; defaults are `medium`, `medium`, and `high`.

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

#### `josh lane:await`

Block until any of the named in-flight lane children confirms it has completed, then print which issue finished.

```bash
pnpm josh lane:await 1749 1750                  # block until either lane completes
pnpm josh lane:await 1749 1750 --owner "$PPID"  # reclaim the carry record for a resumed conversation first
```

`--owner <pid>` names the waiting session's process. When the carry record belongs to the same conversation under an earlier process — a restart resumed it in a new one — the record is moved to this pid before the wait, so a wait longer than the conversation's quiet window cannot read as a crash to `run:wake`. Any other record is left alone.

Polls each child's process every 5 s with a 15 s re-confirm window, so a process that briefly disappears (the pre-gate cut handoff) is not mistakenly declared done. Prints the issue number of the first child that confirms completion and exits 0; does not exit until one confirms.

#### `josh lane:launch`

One call per lane start: open the lane, then — only with `--stash` (the first lane alone) — pop that stash into it and re-install against the lock it brought in, then dispatch the child. A thin layer over `lane:open`, `stash:pop` and `lane:dispatch`, reusing their guards and messages.

```bash
pid=$(pnpm josh lane:launch 1749) || exit 1                                                  # every lane after the first
pid=$(pnpm josh lane:launch 1749 --stash "backlogrun: josh latest before lanes") || exit 1   # the first lane only
```

The child's pid is the one thing on stdout; a refusal is an empty capture beside a non-zero exit, as `lane:dispatch`'s is. A lane a park kept (dispatched before) is dispatched into, not reopened; a refused `lane:open`, pop or re-install stops it before dispatch.

#### `josh lane:sample` / `josh lane:stats`

Measure a lane limit: a per-repository ledger holds merges, gates, each lane's dispatch and ship stages, and the machine load `backlog:drive` samples while it runs (`lane:sample [--every <seconds>]` takes a reading outside a run); `lane:stats --period <days> [--limit <n>]` prints a period as one table row, and under it the median and maximum of each stage of a lane. Procedure and columns: [lane-limit-measurement.md](./maintainers/lane-limit-measurement.md).

## Session and documents

### `josh cost`

Answer whether the next turn exceeds a threshold from active-provider usage. `--cut` selects the shared 135,000 limit — the break-even context a cut pays back at, derived by `context-cut-payback.ts`; `--over <tokens>` sets an explicit one; any other flag is a usage error (exit 1). `josh time` carries the hand-off aggregates. History: [josh-commands-rationale.md](./maintainers/josh-commands-rationale.md) — `docs/maintainers/josh-commands-run-rationale.md` → "`josh cost` and `josh time` lost their report scopes".

```bash
pnpm josh cost --cut             # compare billed input per request with the shared 135,000 context-cut threshold
pnpm josh cost --over <tokens>   # compare with an explicit limit
pnpm josh cost --cut --path <dir> # Anthropic project or current OpenAI worktree
```

**Options:** either threshold prints `over` / `under` on stdout and measured input per request on stderr. `--path <dir>` selects another Anthropic project; OpenAI accepts only linked checkouts of the current project. OpenAI workers persist each generation's rollout, whose pre-terminal `token_count` events are read only when thread ID and normalized project cwd match.

**Output / exit codes:** no threshold selector prints usage; absent provider usage exits non-zero and says where it looked; a session with no requests says so rather than answering a verdict.

### `josh doc:section`

Print one section of a markdown document, so a `` `X.md` → "Heading" `` pointer costs a heading rather than a whole file.

```bash
pnpm josh doc:section <file.md> "<heading>"
pnpm josh doc:section backlogrun.md "The hand-off"
```

**Options / behavior:**

- A bare name resolves inside `.claude/skills/workflow-commands/`; anything that resolves as a path is taken as one.
- The section prints verbatim with its subsections (a `##` heading carries its `###` children).
- A heading, else a `**…**` label's item, matches as a prefix, exact first; two matches is a refusal.
- Fenced blocks are skipped, so a fenced `#` comment does not end a section.
- **Past the Bash cap the section is written as part files**, each under the cap and together exactly the section, and only their paths are printed — read every part with the Read tool in one turn. `issue:read` and `issue:state` do the same.

**Output / exit codes:** an unresolvable heading exits non-zero and lists the document's own headings.

### `josh read:set`

Say what a workflow entry point reads before it starts, and what that read costs.

```bash
pnpm josh read:set              # every entry point
pnpm josh read:set backlogrun   # one of them
pnpm josh read:set backlogrun --json
```

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
- **Every row and the total carry a per-run dollar figure**, and the report states the run size it assumes (`$ = cost per run, assuming a 118-request run`). A token read at the entry rides every later request as cached context, so its cost is the per-token cache-read rate times the request count — which is why a document worth a few thousand tokens costs real dollars per run. The rate is `cost-pricing.ts`'s, read rather than copied, so there is no second price list; the run size is one constant (a measured mean run).
- **`lane-child` is a synthetic entry**, not a table keyword: `pnpm josh read:set lane-child` prints the trimmed set a dispatched lane child (`JOSH_LANE_CHILD`) reads — it drops the point-of-use documents the parent owns (child dispatch, lane opening, the progress watcher and the hand-off) and skips the `SKILL.md` sections it never acts on (§0, §3), so its `total read` falls well below a normal `fullrun`'s.
- **`backlogrun` prints a trimmed parent set** the same way: the parent is the scheduler and never implements, so it skips `SKILL.md` §3. It is a _different_ trim from the lane child's — the parent keeps §0, which is the scheduler's own, and drops no point-of-use document, since it is the one dispatching children and running lanes.

**Output / exit codes:** an unrecognized keyword is refused with the known ones listed, rather than reporting a saving of zero.

### `josh doc:read`

A Bash-cap-safe read path for a whole document.

```bash
pnpm josh doc:read CLAUDE.md          # under the cap: prints the document
pnpm josh doc:read backlogrun.md      # over the cap: prints a directive, no content
```

- Resolves the file exactly as `doc:section` does — a bare name inside `.claude/skills/workflow-commands/`, anything that resolves as a path taken as one.
- **Under the Bash output cap it prints the document; over it, it prints one line and no content.** A `cat` of a document larger than `BASH_MAX_OUTPUT_LENGTH` hands back a middle-truncated preview and the file is then read a second time; this never emits the over-cap document through the shell, so no truncated preview is produced. The directive names both byte figures and the path, so the `Read` tool reads it once.
- The cap is read from `.claude/settings.json`, the same figure `read:set` marks its rows against; `doc:section` remains the way to fetch a single heading when the whole file is not wanted.

**Output / exit codes:** an unreadable file exits non-zero; an over-cap document prints its directive and exits zero.

### `josh read:files`

Read several files in one call, so the reads that precede a run's edits fold into one turn.

```bash
pnpm josh read:files a.ts b.ts c.ts   # under the cap: prints each file under its own header
pnpm josh read:files a.ts big.ts      # over the cap: prints a directive to Read them in one turn, no content
```

- **The mid-implementation counterpart of `run:prep`.** `run:prep` folds a run's pre-edit reads at a pre-determined point; this folds the reads of the files Step 0 enumerated as edit targets, routed at the Step 0 seam by `report-format.md` beside the `josh lines` step. The interleaved read-then-edit sequence the batching guard could not reach in a lane child (`turn-batching.md` → "実装中の独立編集に効く合成コマンド") collapses: the reads go out in one turn, and the edits no longer wait on an interleaved read.
- Each present file is printed under a `===== <path> =====` header. **Under the Bash cap it prints every file; over it, a directive and no content** — the `doc:read` invariant — naming every path and telling the run to Read them **in one turn**, so the reads stay folded on the fallback too. A missing path is named on stderr and makes the call non-zero.

**Output / exit codes:** any missing path exits non-zero; an over-cap batch prints its directive and exits zero.

### `josh edit:files`

Apply several content-addressed edits from a plan in one call — the write-side counterpart of `read:files`.

```bash
pnpm josh edit:files plan.txt   # applies every block in the plan, one line per edit reporting the outcome
pnpm josh edit:files - <<'EDITS'   # plan from stdin, then EDITS
```

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

```bash
pnpm josh time                  # the last run tree, wall clock and cost by role
pnpm josh time --run            # the same run-tree scope, named explicitly
pnpm josh time --json           # the same figures, machine-readable
pnpm josh time --path <dir>     # read another project's transcripts from this checkout
```

**Options:**

- `--run` (default) — the whole run tree, wall clock led beside dollars. It is the only scope; any other flag is a usage error (exit 1). History: `docs/maintainers/josh-commands-run-rationale.md` → "`josh cost` and `josh time` lost their report scopes".
- `--path <dir>` — aim the read at another project (absolute path); keeps the `cwd` behavior when absent.
- `--json` — the run tree, machine-readable.

**Output:** the run-tree report `josh cost --run` builds — a header (session count, active wall clock, total dollars, run and merge counts, and counts of transcripts outside this run and unreadable ones), a by-role breakdown (cost and wall clock with their shares, session and request counts, preamble tokens), and a per-session list. When the run this checkout carries is unfinished, a run-state block (read from `run:carry` / `run:wake`) leads the report so a cut, handed-off or stalled run is surfaced at the front rather than buried. An unmeasured figure prints `not measured` rather than a zero.

**Output / exit codes:** an absent or untimed transcript exits non-zero and says where it looked.

### `josh retrospective`

**Kit-only** — hidden from a consumer's `josh --help` and refused there with guidance; run it from the kit repository. It reads kit's own development run — the transcript store, the review-finding ledger and the run event stream — so it means nothing in a consumer project.

Aggregate a finished run's four existing measurements into one digest, so the end-of-run retrospective has one place to read the run it just closed. It adds no new measurement.

```bash
pnpm josh retrospective          # the digest for the run this checkout carries
```

The run driver prints this at the stop position (`josh run:step`), once per invocation, when a run drains its backlog; a dispatched lane child never runs it. **What to file from the digest is `retrospective.md`'s** — this command only reads and shapes.

**Output:** four sections — the run tree's cost and time by role (flagging a role whose time share runs ahead of its cost share), the recurring review findings with their zero-finding denominator, the count of observation-ledger entries held, and the run's friction events (parks, outages, cuts, review rounds) — closed by a pointer to weigh them against `retrospective.md`.

### `josh eval`

**Kit-only** — hidden from a consumer's `josh --help` and refused there with guidance; run it from the kit repository.

Run the agent rule-compliance scenarios and report how many held.

```bash
pnpm josh eval                          # every scenario
pnpm josh eval consult-not-execute      # one scenario by name
JOSH_EVAL_MODEL=opus pnpm josh eval     # a different model (default: sonnet)
JOSH_EVAL_CONCURRENCY=2 pnpm josh eval  # fewer sessions at a time (default: 5)
```

Each scenario replays a situation against a real Claude session in a throwaway sandbox carrying the documents and skills kit distributes, then judges it on the tool calls the run made — never on what it said. The `n/m` line is a number you can compare before and after a document change. Needs the `claude` CLI on `PATH`; it is deliberately not part of CI. See [docs/maintainers/eval.md](./maintainers/eval.md) for the scenario format.

**Options:**

- `JOSH_EVAL_MODEL` — the model to run against (default `sonnet`).
- `JOSH_EVAL_CONCURRENCY` — how many sessions run at once (default `5`); a non-positive-integer value is refused.

**Output / exit codes:** exits `0` only when every scenario held. The last line is a verdict — `held`, `blocked`, `unmeasured` or `unreachable`; `blocked` stops a merge, the others are reported but do not. Three whole-suite runs ending on the same non-`held` verdict print a `Warning: N runs in a row…` line above the verdict.
