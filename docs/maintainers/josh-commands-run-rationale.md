# josh run, lane and session command reference — rationale and history

History behind [josh-commands-run.md](../josh-commands-run.md), kept here so the reference states
only each command's contract — what it does, its arguments, output, exit codes and side effects.

## `josh lane:dispatch` applies `in-progress` before it launches

Before the label moved to the dispatch, a lane counted as busy only once the child's own `fullrun`
reached its apply — a window that used to be tens of minutes, during which another session could
claim the same issue.

## `josh cost` and `josh time` lost their report scopes

`josh cost` once carried report scopes and a `--cap` threshold; both are retired, and the hand-off
aggregates they produced live in `josh time`. `josh time`'s additional report scopes
(`--issue` / `--session` / `--epic` / `--last` / `--period`) and the `--instructions` / `--top`
modifiers they carried were retired with no rule or decision reading them (joshuafolkken/kit#2017),
leaving the run tree as the only scope. `--split-at <ISO time>` is not a scope: it splits that same
tree at one instant, for the before/after reading a change to the run is judged by
(joshuafolkken/kit#4000).

## `josh edit:files` is a command rather than advice

joshuafolkken/kit#2202 folded the pre-edit _reads_ (`josh read:files`) and left the edits to native
multiple `Edit` blocks, on the ground that presupposing a multi-edit tool would leave the rule unfired
where the harness lacks one. joshuafolkken/kit#2366 measured that bet across six lanes — **230 of 230
edit turns issued a single `Edit`**, a per-turn density of exactly 1.000 — so native multiple edits
never happened. A composite command is the only lever measured to move round-trip density
(joshuafolkken/kit#2165, joshuafolkken/kit#2162, joshuafolkken/kit#2202).

## `josh read:set` lists `pre-gate-cut.md` as a point-of-use read

`pre-gate-cut.md` joined the point-of-use list in joshuafolkken/kit#2289: it is the single source of
the pre-gate cut every implementing run and every dispatched lane child reaches, so its ~10k-token
read was a point-of-use read the count had silently omitted. The per-run dollar figure assumes the
measured mean run of the 2026-09-21 backlogrun (epic joshuafolkken/kit#2280).

## `josh run:next` and `josh run:prep`

`run:next` is the consumer joshuafolkken/kit#2165's `run:prep` was built to have, and the foundation
the entry-read trim of epic joshuafolkken/kit#2166 rests on.

## `josh run:cut` lost its setup-phase cut

The setup-phase `--setup` cut (joshuafolkken/kit#2346) was retired (joshuafolkken/kit#2489): a lane
child's context is bounded by the threshold-gated implementation cut alone.

## Where each command came from

The issues that introduced or reshaped each command, kept here so the reference carries no
provenance citations. Read an issue for the decision behind a behavior; the reference states only
the behavior. joshuafolkken/kit#3277 moved these commands out of the automation reference.

| Command                              | Issues                                                               |
| ------------------------------------ | -------------------------------------------------------------------- |
| `josh run:hold` / `josh run:release` | #2760, #2796, #3023                                                  |
| `josh run:pause`                     | #4160                                                                |
| `josh run:carry`                     | #2136, #2342, #2492, #2760                                           |
| `josh run:cut`                       | #2346, #2354, #2382, #2484, #2489, #2760                             |
| `josh run:ending`                    | #2240                                                                |
| `josh run:entry`                     | #2372, #2760, #2796, #3023, #3042                                    |
| `josh run:status`                    | #2165                                                                |
| `josh run:next`                      | #2165, #2166, #2188                                                  |
| `josh run:prep`                      | #2165, #3154                                                         |
| `josh run:step`                      | #2248, #2297, #2370, #2653, #3154                                    |
| `josh run:merge`                     | #2024, #2240, #2484                                                  |
| `josh run:review`                    | #2179                                                                |
| `josh run:tail`                      | #2372, #2763, #2919, #2979                                           |
| `josh ship`                          | #2398, #2426, #2427, #2428, #2457, #2489, #2500, #2946, #2966, #3222 |
| `josh run:report`                    | #2249, #2393                                                         |
| `josh run:event`                     | #2205, #2207, #2492                                                  |
| `josh run:progress`                  | #2156, #3102                                                         |
| `josh run:board`                     | #3430                                                                |
| `josh cost`                          | #2406                                                                |
| `josh read:set`                      | #2021, #2256, #2280, #2289                                           |
| `josh doc:read`                      | #1797, #2188                                                         |
| `josh read:files`                    | #2202                                                                |
| `josh edit:files`                    | #2162, #2165, #2202, #2366, #2493                                    |

## `josh run:pause` in detail

Four steps, in order: stash the work as `run:pause: #<issue> waits on #<prerequisite>` (`stash:push`); comment on `<issue>` with the `stash:pop` that recovers it (`issue:comment`); record `<issue>` blocked by `<prerequisite>` — through `epic --add <E> <prerequisite> --before <issue>` when an open epic tracks `<issue>` but not `<prerequisite>`; directly followed by `epic --reconcile <E>` when it tracks both, so the prerequisite keeps the orders it already had; directly otherwise; then `run:release <issue>`. Each step checks whether it is already done before it writes, so a rerun after a failure continues from the step that failed — a relation already recorded inside an epic tracking both is reconciled again, so a reconcile that failed after the write is retried.

**Output / exit codes:** one `<step>: <detail>` line per step done (`already` for a step an earlier run did). A failure prints the step, the steps done and the rerun to stderr and exits 1.

## `josh run:hold` / `josh run:release` in detail

**Output / exit codes:** stdout is one token; explanations go to stderr. `run:hold`: `hold`, `busy`, `reclaim` / `resume` / `park` (preflight found uncommitted work, an open PR or a branch with commits beyond the default branch or uncommitted changes in its lane, or a merged/closed PR; a branch with none of those is no leftover work), `unknown` (exit 1). `run:release`: `released`, `none`, or `held` (exit 1). A record over 8 hours old on a clean tree is replaced; on a dirty or unreadable one, `busy`. A `hold` answer is followed by the `josh run:tidy` sweep below, reported on stderr.

## `josh run:carry` in detail

- `--stopped <reason>` rides on `--end`: the run ended by _stopping_ rather than finishing, so one ⏸️ confirmation is pushed with the reason as the record is cleared, reaching the person after a cut a headless parent's report would not. A bare `--end` (a clean finish) stays silent, and because `--end` removes the record a second `--end --stopped` never sends twice. Named without `--end` it is ignored.
- `--end` over a live record first collects each lane the run launched and never settled whose issue merged — closed by a merged pull request, or left open behind one — exactly as `run:merge` would: the merge is counted, put on the event stream and in the ledger, and the lane closed. A lane a detached `josh ship` still supervises, or one that did not merge, is left; a failed collection goes to stderr and the record is still cleared.

## `josh run:wake` in detail

**A run started by [`pnpm josh backlogrun`](../josh-commands.md#josh-backlogrun) already has its supervisor**: the command starts it beside the parent, where it inherits the credential the parent's Bash tool does not pass on, and it claims its record before the parent's `run:carry --begin`. The parent's `--start` then answers `running`. Until the record is carried, `--loop` waits while the launched parent is alive and exits without a record once it is gone.

## `josh run:cut` in detail

The relaunched child is started at the **effort of the phase it resumes into**: a pre-gate resume drives the gate, commit, PR and merge — the mechanical ship/bookkeeping region, lowered — while an `--impl` resume into implementation keeps the role default. A stored lane profile keeps its model and takes only the phase's effort, and a person's `JOSH_WORKER_EFFORT` still wins over the phase value. The phase names and the phase→effort table live in `scripts/agent/agent-role-profile.ts`, single-sourced so the phase a cut records and the phase the effort is keyed on cannot drift.

Output / exit codes: stdout is one token. `run:cut <N>`: `cut`, `not-a-lane`, `unready` (clean or default-branch tree), `busy`, `failed`, or `bad-handoff` (an unreadable or oversized `--handoff`, or an `--impl` cut given none — its resume would answer `incomplete`). `--setup` is a usage error: a lane child's context is bounded by the threshold-gated implementation cut alone ("`josh run:cut` lost its setup-phase cut" above). `run:cut --resume <N>`: `fresh`, `resume`, `resume-impl`, `stale`, `busy`, `handed-off`, `incomplete` (matched the tree but carried no instruction), or `over` (an implementation cut asked for by a session still over the context-cut threshold; the record is kept for a fresh session).

## `josh run:ending` in detail

Classify how a dispatched lane child _ended_ — a different question from `run:liveness`'s "is it still going". `run:liveness` cannot see a child that stopped mid-implementation: its output freezes exactly as a completed child's does, and a `subtype: success` exit reads as a clean finish. This reads three traces the child leaves behind — a carried cut record (it handed off), a CLOSED Issue (it merged), or an OPEN Issue with no cut (it ended in the middle) — and, for the last, prints the exit-record basis a park comment should carry.

**Output / exit codes:** stdout is one token; stderr carries the reason and the basis. `merged`, `cut`, `outage`, `abandoned` exit 0; `unreadable` exits 1. The verdict never reads `is_error: false` as a completion — completion is the CLOSED Issue. A mid-implementation ending is split in two: `outage` when the exit record ended in error on a transport-failure signature — the API could not be reached — and `abandoned` otherwise. The `abandoned` basis names the exit-record fields read (`subtype`, `num_turns`, `permission_denials`) and whether work remains; the `outage` basis names the signature, so the parent leaves the child re-dispatchable.

## `josh run:entry` in detail

shape `backlog:offer` folded the parent loop head on. It asks `run:cut --resume <N>` before the hold: any answer but `fresh` prints `entry #<N> — resume: <token>` with that command's exit code and claims nothing, since an implementation cut outside a lane keeps its hold. A stopped `halfrun`'s hold is adopted: `resume: halfrun`. A stopped `prrun`'s is adopted too, as `resume: prrun-merged` (merged by hand — the tail only), `prrun-merge` (unmoved here and on the pull request, and clean — merge without the gate) or `prrun-gate` (moved or dirty — the gate again).

`--to kickoff|halfrun|prrun|fullrun` names how far the run goes (default `fullrun`). Unless a cut resumes, the first line is `stage #<N> — at: <state> · to: <command> · start: <start>`: the state is read off the issue (`fresh`, `planned` from the `run:planned` label, `halfrun-stopped` / `prrun-stopped` from the hold's stop mark, `merged` from a closed issue) and the start is `plan`, `implement`, `gate`, `followup` or `reached`. `reached` prints that line alone and exits 0, except a merged issue under any command but `--to kickoff`, which falls through to the ordinary `already-done` / `keep-work` entry. `--to kickoff` never asks `run:cut` and claims nothing; `--to halfrun` claims without the `--fullrun` mark. The stage table is `docs/how-to/run-issues.md`.

## `josh ship` in detail

A `preflight` stage runs first: it asks every pull-request precondition at once — `git -y`'s preflight (release classification, branch and title checks) and, for a runtime change, the `## 実機証跡` section `followup` gates on, read from `--body-file` or else the open PR's body — and reports them together, then meets the scoped lint/test pair. A stop those checks would cause therefore lands before the review and the gate rather than after them. The gate stage meets the scoped pair again before `josh gate`, as a round-1 reviewer may have edited the tree since. The checks themselves are unchanged; only where they run moved.

`--review` runs review round 1 beside the gate, after any scoped check not yet green. The round-1 reviewer fixes a small, local Medium in place and marks it `fixed `, counted once the scoped pair is green; a High, an unfixed Medium or a refusal stops the ship. After the commit a `round-2` stage asks `review:round2 --round-1-closed` and, on `required`, runs the scoped pair, `review:brief --round 2`, a fresh read-only reviewer, attest and record — anything but a clean or Low-only round 2 stops before `followup`.

## `josh ship:wait` in detail

The lane session that detached a ship waits instead of ending its turn, so a stop in the gate or review round 1 comes back to the session that already holds the run rather than to a fresh one that re-reads it (joshuafolkken/kit#4711).

Each poll refreshes a heartbeat; the stopped supervisor hands its note to a session whose heartbeat is fresh, and relaunches a fresh session where none takes it within two minutes. A chunk ends `pending` after nine minutes, below the Bash tool's ceiling, and the heartbeat outlives it long enough for the next wait.

## `josh run:event` in detail

`setup` is one stage the run itself works through — `starting session`, `planning`, `handing off`, `waiting on judgment`, `judgment session running`, `no child launched`, `opening lane #<N>`, `installing dependencies #<N>`, `dispatching #<N>` — written by the step that enters it, and its `at` is the moment `run:board` counts the stage's elapsed time from; it is a trace, so it never moves the run's position.

## `josh run:board` in detail

`--every <minutes>` answers a request for periodic progress off-screen, with no model in between: started in the background, it sends the `--chat` frame as a `📊 Progress` Telegram at once and every `<minutes>` after, sends the ended run's frame once after `run:carry --end` and exits; with no run here it sends nothing and exits. It runs only when a person asks for it — the `run:progress` heartbeat still sends no Telegram — and `JOSH_PROGRESS=0` sends nothing. A failed send is reported on stderr and the next interval sends again.

The first line is how far the run is: its state (`▶` working, `⏸` idle, `✋` waiting on a person, `■` ended) and name, `⏰` elapsed as a span in degree-minute-second style (`1°15′57″`, `3′27″`, `26″` — no leading zero unit; every length on the board is written so) — counting from the moment `josh backlogrun` started the session — a progress bar with arrivals as `(+N)` and per-state counts, and `⚠` only when a plan read failed. It is the progress in every state; what only the plan knows is `-` until the plan is read. The mark stands still in every state: the spinner turns on the third line. `⏳` is a waiting child — its count on the first line, and its row, a lane's whose child has not launched yet among them — and, followed by a spinner at the end of the first line, a plan read in flight.

The third line is what the run is doing now, and is there for the whole run — blank only while the stream holds no event. Its three cells stand under the ones above: a spinner under `⏰` and `💓` — turning on a terminal while a child runs and while the run itself is at a stage, a judgment session after the first launch included, and blank while the run watches, after it ended and in a chat — then how long ago what it says happened, as a span right-aligned with theirs to the widest of the three, then the kind's icon under `💪` and the words, in English with no label. The kinds are `🔧` an operation; a child's event under its row's phase icon (`🔍 📝 🔨 👀 🚦 🔀 📦 🔂 ⚓ 📣`, `💥` failed); a stage's own icon (`🚀` starting session, `📝` planning, `🤝` handing off, `🤔` waiting on judgment, `💭` judgment session running, `🚫` no child launched, `🚪` opening lane, `📥` installing dependencies, `📤` dispatching); `🔄` children running; `🔭` watching; and `🔚` ended — the header's own end mark, as `🏁` is a done row's. The legend names `🔧` and `🔚`, the two whose words do not say what they are:

- **At a stage** — the stage's own words then why, timed from when the run reached the stage: `⠸  2′31″  🤔 waiting on judgment — 4 waiting`. The stages are `starting session`, `planning`, `handing off`, `waiting on judgment` (the driver handed its answer to a session — an untriaged child, an epic left to a person), `judgment session running` (the supervisor started that session; the next `handing off` is its end), `no child launched` (a lane's launch returned without a child — no lane was free, or a step after the open failed), `opening lane #<N>`, `installing dependencies #<N>` and `dispatching #<N>`. Before the first launch the run is at whichever is newest; after it, at a lane's stage until that lane's child launches and at a judgment stage until the next `handing off`. The time is counted from the stage's own event and starts again at each new stage, so a stage that is taking long is told from one just entered — the spinner turns on every redraw whether or not the run moved.
- At a stage a session works on — `planning` (the parent session) and `judgment session running` (the judgment session) keep the stage's icon and are followed by that session's newest operation, timed from it, in place of the reason: `⠼  3″  📝 planning · Bash pnpm josh backlog:plan`, `⠼  1″  💭 judgment session running · Read docs/setup/prerequisites.md`. An operation older than the stage is not that session's and is not drawn. Every other stage is written as above.
- Children running, no stage — the newest of the running children's operations and events (`lane-phase`, `ship-stage`), named by its issue: `⠙  4″  🔧 #<N> · Bash pnpm josh test:related`. A child inside a long `josh ship` makes no call while the ship writes on, so where a child's event is the newer, its words are drawn under its phase icon: `⠹  1″  🚦 #<N> · ship gate`. An operation wins a tie.

An operation is the tool's name and what it was pointed at, never the session's own description of the call, so the line stays English: a `Bash` call draws the first line of its command without the variables set ahead of it, cut at 40 characters with `…`; `Edit`, `Write` and `Read` draw the file's path from the checkout down (its name alone outside the checkout); any other tool draws its name alone. Each is read from the last 64 KiB of the session's log — a lane's dispatch log, the parent's transcript, the watcher's log — so a call whose line is longer than that is not found and the line falls back.

The reason after `—` is the children running (`2 running`), else what the plan has left: `pool empty`, `<n> waiting` (blocked or not yet triaged), or `<n> waiting on a person` when `needs-decision` holds all of it; it is left out until the plan is read. `run:board --chat` writes the same three lines. All three are written the same while the run works and while it waits: a wait is read off the `⏸` or `✋` mark, the `💓` that counts on from the run's last event and the third line's `watching` — and it ends the idle window (8 hours, or `--idle`) after the run last launched or collected a lane. A run whose owner and supervisor are both gone (a stranded run) is drawn `■`, not `⏸`. An ended run draws `🔚 HH:MM` in the `💓`'s place — a colon is a time of day, never a length. Below: touched children — led by its phase's icon (from the `child-launch`, `plan`, `lane-phase` and `ship-stage` events), then the elapsed span and CPU/memory; a running child ends on the phase's icon and its time in that phase (`🔨 12′17″`), as a span right-aligned to the widest so every icon stands in one column (yellow past 2×, red past 3× its ledger median, floor 2 min), then two spaces and the icon and span age of its newest activity, right-aligned the same way (yellow past 15, red past 30 min) and left out where it is the event that entered the phase — in `followup`, its newest `pr-checks` instead: `PR <n>  ✓ <n>  ⏳ <n>  ✗ <n>  🐰 <state>`, zero counts dropped, `✗` red, `🐰 ⛔` (rate-limited) yellow — a settled one on `🔚` and its end — the children not yet started in the `backlog:plan --waves` order under one `── ⏳ queued ──` rule (epic children as a tree under the epic's title, each row led by what it waits on and an 11-column condition column, so every number stands in one column — [#4288](https://github.com/joshuafolkken/kit/issues/4288)), `needs-decision` and unreached children, and the newest filings, parks and notes. A dim legend at the foot names, on one line, only the symbols the frame draws with no word beside them — the phases on the rows, the third line and the rows' ends, the settled states, the kinds, `🔗`, the check marks drawn and the notes' icons — and is left out where it would name nothing. An icon drawn beside its own word is not named: `⏳`, `🙋` and `✅` under their rules, and `📌` on its rule ([#4173](https://github.com/joshuafolkken/kit/issues/4173)); a waiting row's own icon, `📅` among them, is named. A lane whose lane state record says `paused` (`lane:pause`) is drawn `🧊 paused`, its time frozen when the record last changed, whatever processes the lane still runs; the board no longer reads it off `ps` states (joshuafolkken/kit#4269).

A row with a standing blocker leads with `🔗` unless it is untriaged (`❓`), and the reasons are read in the order above, so a row leads with the first that holds. A row whose lane is being opened leads with that lane's own stage instead, with how long the lane has stood there as a span in its condition column — `🚪 5″`, `📥 42″`, `📤 1′03″` — read from the newest `setup` event naming the issue, so lanes opened side by side each show their own stage; it is gone once the child launches, once the driver writes `no child launched` for a launch that left none — a refusal it waits out is followed by no hand-off — or once the run hands off or back, and a stopped run draws none. Where the pane is too narrow for a row with a reason, the title is cut further (never under 8 columns) so the reason stays on the row's one line. `run:board --chat` draws the same rows.

`🧵 n/limit` counts every lane holding a place under the limit (`backlog-occupied.ts`), an earlier run's lane whose child still lives among them. Whose lane it is and what it is doing are read from each open lane's lane state record (`run-board-lane-state.ts`), not guessed from the run's span, the `.env` mtime or `ps` states (joshuafolkken/kit#4269): a lane is the run's when the run that launched it started when this run did. The lanes section draws an earlier run's lane after the run's own, so its rows holding a place number n; the row is not the run's child, so it stays out of ✅ n/m, the 🎯 estimate and 🔄, and an earlier run's lane with no child working in it draws none (joshuafolkken/kit#4200). The row draws what its lane is doing as a running row does — elapsed time, CPU/MEM/CMPRS and newest activity — its running row led by `🧳` in its phase's place; a paused record draws 🧊. Each lane's status is the stream's events from the record's newest launch on, folded over the record's running child, so its time counts from that launch across a cut and a resume, and a stage line whose launch rolled off the stream still carries the run's child on (joshuafolkken/kit#3552, #4260). What the span says of an earlier run's lane is never the run's, and a cut or resume makes no status of a child the stream holds nothing earlier of. A lane with no record is drawn `❔`, counted in use and never guessed at (joshuafolkken/kit#4370).

Right above the legend, the terminal board (the live redraw and `--once`) names the people who helped review kit, on one line in the rows' own color, wrapped between names where the pane is too narrow, led by one 🙏 on its first line. When the pane is too short, the parts below the header give way in this order — the footer, the legend, the oldest notes until three are left, the finished rows, the rest of the notes, these names (wrapped lines and all), the rows not yet started, the parked rows and, last, the running rows — each stage stopping once the frame fits. A name with a `url` is an OSC 8 link to it. The roster is a Google spreadsheet published as CSV, whose URL is a constant in `scripts/run/board/run-board-thanks-read.ts`, so it changes apart from any kit release. It is read beside the board, never holding up a redraw, and its answer is kept in the project's record and reused for five minutes. A CSV whose header is not exactly `name,url` is not used; a row with an empty `name` or a `url` that is not `https://` is skipped, and a name loses its control characters and is cut to 40 columns. A read that fails or times out keeps the last answer and, with none, draws no line — nothing about the failure is shown. `--chat` and `--every` never read or draw it, and a frame with no run draws none.

Output / exit codes: the stream, the lanes and the end of each session's log re-read at most every five seconds; the plan from GitHub at most every two minutes, keeping the previous one on a failed read — an open listing that came back empty counts as failed. A touched child the open listing no longer holds is read from GitHub once — its title, when it closed, whether a merged pull request closed it and whether it was closed as not planned — and drawn `✅` (merged), `🚫` (not planned) or `🏁` with its time; until that read answers it closed, it is drawn as it was, since a listing that came back short proves nothing. A running child is asked the same way while the plan read fails — the kept plan may still list a child that merged, as when the run's last child was the repository's last open issue — and a running child whose closed read predates its launch is asked again. A child the board draws `🛑` (its lane idle, or its listing without `in-progress`) is read the same way while the listing still holds it, so a child that merged itself is drawn `✅` without waiting for the next listing; it stays `🛑` until that read answers, and one still open is asked again no sooner than the plan. A child the last ask did not hold is asked without waiting. A parked child is settled by that read alone: closed, it leaves `💤` for `✅` or `🚫` (or `🏁`); still open, it stays `💤` whatever its labels say. A `💤` row ends with its newest park's reason, and a `🚫` row with the reason given to `lane:withdraw`, if one was given. Both go where a `⏳` row puts why it waits. A `✅` or `🏁` row ends with the numbers of the Issues filed `--found-during` its child, each a link with no `#`, then a spinner while its overrun investigation runs — its start note on the stream, its end note not, its session still there, by the pid and start time the start note records — or `🔍` where no spinner turns. A park whose reason its row shows is not repeated among the newest parks, unless it is a `needs-decision` park. After `run:carry --end` the board keeps the ended run — `■`, its duration as `⏰` and when it ended in the header, only that run's events — until the next run begins. An ended run asks GitHub about its unread closed children once after it ended, then reads nothing until the next run. No run here, running or ended, prints `no run` and reads no plan. Exits 0; an unknown argument, or an `--every` that is not a positive number of minutes, exits 1; Ctrl+C exits 130 and SIGTERM 143.

Each read recomputes only what changed (#4263):

- An app name is worked out once per command line.
- The ledger and each lane's git config are parsed again only when the file's stamp (inode, mtime, ctime, size) changes.
- The main work tree is resolved once per working directory, and again after a failed resolve.
- Each process's start time comes from the board's one `ps` snapshot, never a `ps` call per process.

The live board gathers in a `worker_threads` worker (`run-board-gather-worker.ts`, #4267): the stream, lane and session-log reads, the `ps` usage sample and the machine sample run there, and each redraw takes the worker's newest answer, so a `git` or `ps` call never freezes the spinner. A local read that is unchanged since the last answer is not posted again, and a stream read again with the same events is posted without them, so the board keeps its own `events` array. The plan, the closed children and the thanks roster are still read on the board's own thread, since they wait on the network rather than block. A round whose reads throw is posted as failed and the worker reads again next round (#4387); a worker that fails or exits is started again on the next redraw. Either draws `❗ read HH:MM <reason>` in the header, the error's first line cut to 40 columns, until a read answers; with no run read yet, it takes the place of `no run`, since a failed read cannot tell whether a run is there. `--once`, `--chat` and `--every` draw one frame, so they gather on their own thread with the same code (`run-board-gather.ts`).

What stays on the board's thread — the layout, the frame and its fit — is held to a frame budget by `run-board-frame-budget.test.ts`: the best of five redraws over eight lanes, a thousand processes and six thousand events, each right after the worker read the same stream again, must take under 40ms, half a spinner frame. The folds over the whole stream (the activity and the statuses) are kept for the `events` array the board holds, so a redraw does not fold the stream again until the stream changes; before that a redraw of this fixture took 63–77ms, after it 7–13ms, and 15–18ms where every read handed the stream over afresh — a miss the test catches by the array each redraw draws, not by its time.

## The strand report in detail

The `Stop` hook reports whether the run has been left stranded: the session that owned the budget has died — at a cut it handed off, or with no hand-off at all — no successor holds it, and no `run:wake` supervisor is watching. Three facts are read and never weighed — the driver the carry record names, the owner's liveness, and the supervisor's — so a strand is detected without any judgement. It runs at each loop boundary beside the stall report; a strand emits one marker on the run's event stream and sends one 🚨 Telegram naming the recovery. It reports, it never stops: a false positive costs one notification, never a halted run or a torn-down lane.

## `josh lane:open` / `josh lane:close` / `josh lane:list` / `josh lane:prune` in detail

Open and close a lane: one linked git work tree with its own branch and its own port seat. `lane:open` cuts from `refs/remotes/origin/<default>` (falling back to the local branch), attaches to an existing `<N>-lane` branch, installs dependencies (`pnpm install --frozen-lockfile`), and warms the gate caches from the main checkout. It also copies the pre-built hook bundles (`dist/hooks/`) from the main checkout so the lane's Claude Code hooks launch off `node dist/hooks/<name>.js` rather than the slower `pnpm josh …` fallback — those bundles are git-ignored, so a lane's work tree never carries them otherwise. A consumer repository needs no such copy: its hook commands already point at `node_modules/@joshuafolkken/kit/dist/hooks/`, which the install materializes; only kit's own lanes use work-tree-relative paths. When the main checkout has no bundles (a clone that never ran `pnpm build`), the lane opens without them and the first hook's ready gate builds them; a copy that fails never fails the open — best-effort, exactly like the gate-cache warming. A copied bundle stays in use only while its recorded content digest matches the lane's source; once the lane edits a hook's inputs, the ready gate rebuilds it (see [`josh pretool:guard`](../josh-commands-automation.md#josh-pretoolguard)).

- `lane:close --all` — close every lane; `lane:prune` — close lanes left registered without a work tree and lanes that are spent (no child working in it, its Issue closed, not a lane the running `backlogrun` launched and has not collected with `run:merge`, a clean tree, no commit that is on no remote), then remove unregistered lanes-root leftovers git can fully restore (the rest are kept with a reason). Every other lane is kept and named on standard error with why — a condition that could not be read keeps the lane too — beside the `pnpm josh lane:close <N>` that discards it.

**The `in-progress` / lane difference:** `epic:next` counts lane occupancy from the `in-progress` label list, while the lanes are the work trees actually open — and the two can disagree. `lane:list` names the difference on stderr, in both directions: an issue that carries `in-progress` but has no open lane (a stale label that silently shrinks the free-lane count), and a lane whose issue carries no `in-progress` label (which lets another session claim the same issue). The per-issue judgement is three-valued — `live`, `stopped`, or `unknown` when the lane listing could not be read — and `unknown` is never collapsed to `stopped`. It reads the two sets the way `epic:next` and `lane:list` already read them, and it never changes a label — clearing `in-progress` from a live run is a person's to do, since removing it is exactly what opens a second pull request.

## `josh lane:dispatch` in detail

**Before it launches, it applies the `in-progress` label to `#<N>`** (creating the label if missing), so the lane counts as busy from the dispatch rather than only once the child's own `fullrun` reaches its apply ("`josh lane:dispatch` applies `in-progress` before it launches" above). If the label cannot be applied it launches nothing and refuses; if the launch then fails it removes the label again, leaving no `in-progress` on an idle issue.

## `josh lane:sample` / `josh lane:stats` in detail

Measure a lane limit: a per-repository ledger holds merges, gates, each lane's dispatch, ship stages and ship stops, and the machine load `backlog:drive` samples while it runs (`lane:sample [--every <seconds>]` takes a reading outside a run); `lane:stats --period <days> [--limit <n>]` prints a period as one table row, under it the median and maximum of each stage of a lane, and under those how long a stopped `josh ship` waited to resume, per stop reason. Procedure and columns: [lane-limit-measurement.md](./lane-limit-measurement.md).

## `josh lane:net` in detail

Each wait runs from the park or outage to the issue's next ship stage, re-dispatch or next of the two — the wait `josh lane:stats` derives for a stop — and a wait nothing ended stops at the merge. A ship stop's wait stays in: the relaunched child spends it on the fix. The minutes are the whole number an Issue's `- 原因のレーン: <分> 分（#<N>）` line declares (`prompts/collaboration-workflow/issue-template.md`). A usage-limit stop leaves no record yet, so its wait is not taken out (joshuafolkken/kit#4753).

## `josh cost` in detail

Answer whether the next turn exceeds a threshold from active-provider usage. `--cut` selects the shared 135,000 limit — the break-even context a cut pays back at, derived by `context-cut-payback.ts`; `--over <tokens>` sets an explicit one; any other flag is a usage error (exit 1). `josh time` carries the hand-off aggregates. History: [josh-commands-rationale.md](./josh-commands-rationale.md) — "`josh cost` and `josh time` lost their report scopes" above.

## `josh read:set` in detail

- **Every row and the total carry a per-run dollar figure**, and the report states the run size it assumes (`$ = cost per run, assuming a 118-request run`). A token read at the entry rides every later request as cached context, so its cost is the per-token cache-read rate times the request count — which is why a document worth a few thousand tokens costs real dollars per run. The rate is `cost-pricing.ts`'s, read rather than copied, so there is no second price list; the run size is one constant (a measured mean run).
- `lane-child` is a synthetic entry, not a table keyword: `pnpm josh read:set lane-child` prints the trimmed set a dispatched lane child (`JOSH_LANE_CHILD`) reads — it drops the point-of-use documents the parent owns (child dispatch, lane opening, the progress watcher and the hand-off) and skips the `SKILL.md` sections it never acts on (§0, §3), so its `total read` falls well below a normal `fullrun`'s.

## `josh doc:read` in detail

- **Under the Bash output cap it prints the document; over it, it prints one line and no content.** A `cat` of a document larger than `BASH_MAX_OUTPUT_LENGTH` hands back a middle-truncated preview and the file is then read a second time; an over-cap document never passes through the shell, so no truncated preview is produced. The directive names both byte figures and the path, so the `Read` tool reads it once.

## `josh read:files` in detail

- **The mid-implementation counterpart of `run:prep`.** `run:prep` folds a run's pre-edit reads at a pre-determined point; this folds the reads of the files Step 0 enumerated as edit targets, routed at the Step 0 seam by `report-format.md` beside the `josh lines` step. The interleaved read-then-edit sequence the batching guard could not reach in a lane child (`turn-batching.md` → "実装中の独立編集に効く合成コマンド") collapses: the reads go out in one turn, and the edits no longer wait on an interleaved read.

## `josh time` in detail

**Output:** the run-tree report `josh cost --run` builds — a header (session count, active wall clock, total dollars, run and merge counts, and counts of transcripts outside this run and unreadable ones), a by-role breakdown (cost and wall clock with their shares, session and request counts, preamble tokens), and a per-session list. When the run this checkout carries is unfinished, a run-state block (read from `run:carry` / `run:wake`) leads the report so a cut, handed-off or stalled run is surfaced at the front rather than buried. An unmeasured figure prints `not measured` rather than a zero.

`--split-at <ISO time>` adds a before → after block: each session goes to the side its first request falls on, and every role prints its wall-clock share, cost share and requests per session on both sides — `pnpm josh time --split-at 2026-10-16T21:33:19Z` reads a merge's effect on the run that spans it. An unparseable time is a usage error (exit 1).

## `josh eval` in detail

Each scenario replays a situation against a real Claude session in a throwaway sandbox carrying the documents and skills kit distributes, then judges it on the tool calls the run made — never on what it said. The `n/m` line is a number you can compare before and after a document change. Needs the `claude` CLI on `PATH`; it is deliberately not part of CI. See [docs/maintainers/eval.md](./eval.md) for the scenario format.
