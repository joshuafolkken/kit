---
name: diag
description: The procedure behind `diag fullrun` / `diag backlogrun` / `diag #<N>` (and `/diag`) — measure where a run's wall clock went with `pnpm josh time` and what it cost in dollars with `pnpm josh cost`, say whether the last speedup worked, and rank what to cut next as one table that keeps the already-filed issues in it. Read this whenever asked how long a run took, what a run cost, why `fullrun` is slow, what to do to make it faster, or to check whether a speedup landed.
---

# `diag` — read the timing report, propose the next speedup

`diag` interprets the timing and cost reports and ranks what to cut next.

**`diag` is analysis, not a workflow.** It never implements, commits, merges or starts a run. Where
its answer is "run this", it prints the command for the person to type — the explicit-invocation
rule in `CLAUDE.md` is unchanged, and `diag` is not one of the keywords it governs.

**If `josh` cannot measure it, report the gap and file an issue (step 7) — never restore the figures
by hand.** The hand tally that motivated this ordering happened only because the commands then had no
run-tree view; where a reading below is `not measured`, that gap is the finding, not a cue to
reconstruct it by eye. **Read the steps in order**: the run tree, whether it is stuck, its cost by
role, the costliest sessions, the parent's timeline — and only then one run's internals.

## 1. Which run to measure — the default is the last run tree

**The default scope is the last _run tree_, not the last merged child** (joshuafolkken/kit#1937,
joshuafolkken/kit#1939). A bare `pnpm josh time` reports the whole run — parent, wakes, lanes and
subagents — and a bare `pnpm josh cost` reports that same tree in dollars; `--run` names it
explicitly. Measure one issue on its own **only** when `diag #<N>` was typed.

| Typed | What it measures | The call |
| --- | --- | --- |
| `diag` / `diag fullrun` | The last run tree — every session of the run | `pnpm josh time --run --top 5 --json` and `pnpm josh cost --run --json` |
| `diag #<N>` | Issue `#N`'s whole run, from the `fullrun` invocation to the merge | `pnpm josh time --issue <N> --top 5 --json` |
| `diag backlogrun` / `diag #<E>` where `#<E>` is an epic | Every child of the epic, in execution order | `pnpm josh time --epic <E> --top 5 --json` |
| `diag backlog` / `diag <N> days` | The backlog over a period — lanes, idle, serialization, throughput | `pnpm josh time --period <N> --top 5 --json` |

**`--period` answers a different question from the three above it.** Those three report where **one
run's** wall clock went; `--period` reports how fast the **backlog** emptied — lane idle,
serialization, throughput — which no single run's internals can show. It is built from
`.time-history.jsonl` alone, so it needs no `gh` call and no transcript, and an empty history is
reported rather than shown as a table of zeroes. Read it when the question is whether a lane sat idle
or the work serialized behind one run; read one of the three above when the question is which phase
of one run was slow.

**An epic is measured child by child, in one call.** `--epic` enumerates the children from the epic
body, orders them by when they actually ran, and carries each child's report under `children[]` — so
there is no loop to write and no list to assemble. It also prints each child's **model wait per
turn** and the direction across them, the one figure a `--issue` call per child could not produce.
**Read the four child states before quoting a figure**: `not run`, `no transcript` and `not merged`
are not durations of zero, and the batch totals withhold any half no child contributed to. A child
in one of those states is reported unmeasured, never counted as zero.

## 2. Is the run even progressing? — read the run state first

A merged run always ended; a run tree may still be **stuck**, and that is the first thing to read.
`pnpm josh time` on a run scope leads with a `Run state (from run:carry / run:wake):` block whenever
the run is unfinished — the presence of a `run:carry` record _is_ the incompleteness, since a clean
finish removes it, and `--json` carries the same figures.

- **`status`** is the axis that says how the _run_ stands, kept apart from a session's `end_state`.
  The states no merged-run report could show belong at the top of the ranked table:
  `cut_no_successor` (cut, and nothing took over), `owner_stalled` / `owner_gone` (the owner is idle
  or gone), and `expired` (past the whole-run bound). `running` and `handed_off` are healthy.
- **`whiffs`** — wake sessions that spun up, checked `run:carry` / `run:hold`, moved nothing and
  exited. Read `whiffs.count` and `whiffs.cost_usd`: idle wakes that cost dollars and produced no
  work are a ranking row of their own.
- **`is_measured: false` is "no carry record to read here", never "the run is fine".** `cuts`,
  `is_handed_off`, `is_owner_live`, `last_cut_at` and `idle_ms` fill in how many times it was cut and
  how long it has sat silent.

## 3. Where the run's cost and time went, by role

Before any single-run phase, read how the tree split across its roles — the share question the hand
tally answered and no command could. `pnpm josh cost --run` leads with dollars, `pnpm josh time
--run` with wall time; both roll the tree up under `roles[]`.

- **Each `roles[]` row is one of `parent` / `wake` / `lane` / `subagent`**, cost-heaviest first, with
  `cost_share` and `elapsed_share` in `[0, 1]` (the four shares sum to one), and `cost_usd`,
  `elapsed_ms`, `session_count` beside them. The `wake` role is the run's resumes — its
  `preamble_tokens` is the resume cost the run keeps re-establishing.
- **`sessions[]` is one row per session, cost-heaviest first** — `session_id`, `role`, `issue`,
  `depth`, `parent_id`, `cost_usd`, `elapsed_ms`, `preamble_tokens` — the input to step 4.
- **`unreadable_count` is withheld from the shares, never folded in as a zero.** A large role is a
  reason to look, not a finding on its own.

## 4. The costliest sessions

Take the top rows of `sessions[]` (run scope) or `by_session[]` (`--issue` and the latest-run scope,
keyed by the same session id) and read what each spent its money on. The per-row detail lives on two
commands:

- **`pnpm josh cost --issue` → `by_session[].metrics`**: `primary_model` and `other_models` (which
  model priced the row), `thinking` (`thinking_tokens` over `output_tokens` — the reasoning share,
  withheld when `measured` is false), and `context` (`median_ms` / `p90_ms` / `max_ms`, read as
  tokens — how large the context grew).
- **`pnpm josh time` → `by_session[].signals`**: `check_loop` (`count` edit-then-check transitions
  and their `median_context_tokens` — a check loop repeating at a large context), and `stalls[]`
  (each `wait_ms` of model wait and the `output_tokens` produced in it — the request-level stall).
  `by_session[].end_state` says whether the session `merged`, `stopped`, or was `not_detected`.
- **The stopped session's cost is a ranking row** — the work that produced no merge (step 7). Each
  cost row also carries `cost_usd_with_delegated` and `output_turns`; each time row carries
  `elapsed_ms`, `model_ms`, `round_trip_count` and, for a resume, `to_first_progress_ms`.

## 5. The parent's timeline

`pnpm josh time` on a run scope carries `parent_timeline` — where the parent's own wall clock went,
the reading a batch's speed turns on.

- **`dispatch.first_offset_ms`** — how long until the first lane was dispatched; `dispatch.dispatches[]`
  lists each with its `offset_ms` and `issue`, and `has_dispatch` / `is_measured` say whether any ran
  and whether the transcript was read.
- **`foreground_waits.total_ms`** — the time the parent sat in the foreground waiting; each `waits[]`
  row names its `command` (`josh followup` or a `sleep`) and its `duration_ms`.
- **`implementation`** — the parent's own work: `request_count`, `cost_usd`, `median_context_tokens`
  and the `issues[]` it implemented itself.
- **For a `backlogrun` parent, read `contributor_costs.by_contributor` first.** A parent
  barely implements, so its durations rank tools rather than work; the block keys the dollars by what
  the turn was _for_ (`child dispatch`, `progress polling`, `child confirmation`, `loop asks`, …),
  with `no_tool_call` a bucket that is never prorated. A large contributor is a reason to look;
  whether those turns were avoidable is `Bundling:`'s answer (step 7). `is_measured: false` is an
  unknown, not a free run.

## 6. Then, only if needed — one run's phases, round trips and rework

The readings below are one run's internals, read after steps 1–5 when the question is which phase of
a single run was slow or expensive.

- **The output is an array even where the scope is one issue**, so read `[0]`. Four fields carry the
  reading — `request_count`, `cost_usd`, `breakdown`, `missing` — and `breakdown` is
  `resident_baseline_tokens` / `resident_billed_tokens` / `history_billed_tokens` /
  `billed_input_tokens`. **Derive the four readings the JSON does not print**: the resident and
  history shares of `billed_input_tokens`, the tokens per request, and the dollars per request.
- **`--over` is not this step's flag** — it reads whether _this_ session is too large to hand off,
  not a scope, and is refused beside `--issue` / `--all` / `--json`. `diag` passes the scope flag with
  `--json`, never `--over`.
- **`documents`** ranks the point-of-use candidates: one row per instruction document read at the
  entry, largest carry cost first — `tokens` is what it stacked, `carried_requests` how many billed
  requests re-read it from cache, `cost_usd` that carry at the cache-read rate. Moving a document to
  "read at the point of use" removes its `carried_requests`, so the top rows are the conversion
  candidates and their `cost_usd` the saving. **Read `is_measured` before quoting a row** — `false`
  is unmeasured, not zero. Present on `--issue` and single-session scopes, absent on `--all`.
- **Read `missing` before quoting any figure; a non-zero count is unmeasured, not zero.** Its
  counters — `no_usage_lines`, `malformed_lines`, `unreadable_sessions`, `unattributed_sessions` —
  say how much could not be priced or attributed; on `--issue` the first three are the **whole
  corpus's**. A `cost_usd` beside a non-zero `missing` is a floor and is labelled one;
  `unpriced_models` is a second floor the command flags itself.
- **`curve` / `outliers` / `cap_simulation`**: `curve` is context growth across the run, built from
  the **main-line session alone** — read `curve.measured`, since a cross-session scope carries
  `measured: false`, which is `not measured` and never a flat curve. `outliers` names the requests
  whose cache write dominated, largest first. `cap_simulation` is present only under `--cap`.
- **The phase axis is `josh time`'s, not this command's.** Read the money per phase from
  `phase_costs` there and the run total here, and never construct a per-phase figure as a share of
  `cost_usd` — that is the guess wearing a measurement's clothes.

**`--top 5` is part of the call, not a nicety.** Without it the JSON carries every row of the
per-tool and per-`josh` tables, and an epic pays for both once per child. The cap reaches the **row
tables** and nothing else. A cut table says so in `notes` (`by_tool: showing the top 5 of 34 rows`),
and **that note is not a zero**. **Drop the flag when the tail is the question** — a cost spread thin
across many commands is what five rows cannot show — and say that you did.

**Five tables are capped**: `by_tool`, `by_josh_command`, `segments`, `by_invocation`,
`rework.files`. `rework.files` is ordered dropped-first, so a cut table keeps the findings.
`segments` is in run order, so the cap keeps the **longest** five and reorders them — **read a
segment listing as evidence about the stretches it names, never the ones between them**, and where
the run's shape is the question drop the flag.

Read from the JSON, in this order:

- **the three windows** — `windows.run`, `windows.pull`, `windows.issue`. They are the frame
  everything sits in: the run body, the pull request's open→merged, the issue's opened→closed. **Read
  them before the shares**, because a saving is only ever a saving of one of the three. They are not
  phases and never enter the phase table. Each carries `is_read`; a `false` there is `not measured`,
  not a zero.
- **the four shares** — model wait, tool execution, human wait, CI wait. **A run with
  `span_count: 0` measured none of the first three**: the JSON carries `0` but the table says
  `not measured`, and ranking a stage off them there is ranking an unknown.
- **the phase breakdown** — `plan` / `setup` / `implement` / `gate` / `rework` / `review` / `pr` /
  `wrapup` / `ci` / `merge` / `wait` / `wait-outside` / `pre-run` / `post-run` / `other`.
  **`pre-run`, `post-run` and `wait-outside` are not stages and are never ranked**; `wait` alone is
  the row a stop-reducing proposal is measured against, and `setup` and `wrapup` are the run's own and
  can be ranked.
- **`ci` is not the `CI wait` share, and it is the row a CI proposal is ranked off.** The share is
  the part of the open→merge window no span covers; the phase adds what the merge command itself
  waited for, read from the check-runs of **every commit of the pull request**. **`ci: 0` never means
  "nobody waited"**: a cycle beside the review or a gate is free and stays out, and where cycles could
  not be read it says `not detected`.
- **`gate` is read like `ci`.** The gate is backgrounded (§2h), so the phase carries only the
  dispatch; its real runtime is the `Gate runtime (backgrounded)` block — the real length and the
  `naked` part the run spent on it alone, `not measured` where it was never read back. A small `gate`
  figure no more means the gate was fast than `ci: 0` meant nobody waited.
- **`is_detected` per phase** — a phase that never appeared prints `not detected`, which is not a
  measured zero; never rank a phase you did not measure.
- **`phase_costs`** — `by_phase` carries a `request_count` and a `cost_usd` per phase, placed by each
  billed request's own instant. `unattributed` is a bucket, **never prorated into the phases**.
  `is_measured: false` means the corpus was not read for this scope (only `--issue` and the
  latest-run scope read it).
- **`delegated_cost`** — `units[]` names each subagent launch with its `baseline_tokens`, `cost_usd`,
  `model` and `purpose`; the totals are `unit_count`, `baseline_tokens`, `cost_usd` and
  `per_unit_cost_usd`. **Read it before crediting a delegation with a saving**: a step whose own work
  is cheaper than `per_unit_cost_usd` cost more to delegate than to run inline. `unpriced_unit_count`
  makes `cost_usd` a floor; `unit_count: 0` on a measured run is a real answer.
- **`cost_composition` and `output_turns`** — `cost_composition` splits `cost_usd` into uncached
  input / cache-write 5m / cache-write 1h / cache-read / output, so a "cut the cache-read carry" or
  "cut output" proposal is ranked on the term it acts on. `output_turns` is the per-turn output
  distribution — median, p90, max — and the share of turns over 5,000 tokens; a high share is long
  deliberation. Both `not measured` on an empty scope, never zero.
- **the two review rounds against each other** — `segments`. **A pair is identified by a `pr` segment
  between the two `review` rows, and by nothing else** (round 2 runs after `pnpm josh git -y`). Its
  absence proves nothing — `--top 5` can drop the short `pr` row, and a `josh git` under
  `MIN_SEGMENT_MS` is absorbed — so **re-read `segments` without `--top` before deciding a `pr` row
  is missing**. Two `review` rows with no `pr` between them are ambiguous: report that the pair could
  not be identified rather than a ratio built on a guess. **Take the ratio round 2 ÷ round 1, and
  report it at 0.95 or above** — round 2 is a verification pass over the fix delta, so a round 2 that
  costs what round 1 cost is worth flagging. **The threshold rests on a distribution measured in
  joshuafolkken/kit#1418 (round 2 ÷ round 1 at a median 0.66 over 61 pairs) — read the figures in that
  Issue, never a copy here.** Name no cause; a single ratio near 1.00 is the tail of
  that distribution, not evidence about the mechanism, readable only from the forked agents' own
  transcripts (`pnpm josh time --session <session-id>/agent-<agent-id>`). **Five states are not a
  pair**: one `review` row (a clean round 1, or a two-round run whose `pr` was absorbed), more than
  two rows, `review` reading `not detected`, `span_count: 0`, and a `--top`-cut table — re-read
  without the flag before calling any of these the run's shape.
- **what the round-2 disposition cost** — the extra commit and the CI cycle a fix-in-place buys
  (`prompts/review.md` → "Three-way disposition after the cap"). **The detector is a `pr` segment
  _after_ the round-2 `review` row**, corroborated by `by_invocation` in both directions
  (`josh git — 2 call(s)` beside a second `pr` row, or **no `josh git` row at all** for one commit).
  **Read both from uncapped output.** A second `pr` row is not proof the commit was round 2's — read
  the report's `failures` over that stretch first, since a commit repairing a red CI or gate reads
  identically. **Sum exactly four stretches, each printed beside the total**: the second `josh git`
  and the last `josh gate` from `by_invocation.durations_ms`; the second CI cycle from the last row
  of the `CI cycles` block read as its `naked` figure; and the single check the fix reached (its last
  `by_invocation` entry, or `single_checks.duration_ms` where the run issued exactly one). The sum
  re-reads rows already counted, never minutes to add. **Three answers, one a number**: occurred
  (reported with the sum), did not occur (never 0 minutes), could not tell (everything else — the two
  evidences disagreeing, an unidentifiable pair, a `--top` listing, `ci` reading `not detected`, or a
  `failures` chain that makes the commit someone else's). Frequency comes from `--last <N>` applying
  the detector per run — **report the three counts, not a rate**. Rank a proposal to cut the cycle
  against the measurement in joshuafolkken/kit#1382 (its lower-bound CI reading corrected in joshuafolkken/kit#1465).
- **the round trips** — `tool_call_count` and `round_trip_count`, and the density between them. **A
  density near 1.00 is the finding, not a detail** — it says independent calls went out one per turn.
  It rests on the same transcript the shares do.
- **how many turns the density is made of** — `batched_turn_count` and `single_call_turn_count`, which
  sum to `round_trip_count`. The same density over two differently-shaped runs has different room to
  batch, so quote the pair beside the density rather than the density alone.
- **the price of one round trip** — `ms_per_round_trip`, with `model_ms_per_round_trip` beside it;
  **without it the round trips cannot enter step 7's table**, which ranks by minutes and a count is
  not minutes. Multiply the price by the trips a change would remove. **The model share is the part
  batching actually removes.** **`usd_per_round_trip` is the same reading in money**, on the same
  denominator — so one recoverable-trip figure multiplies both. It is not a share of `elapsed_ms`
  (human wait, CI wait and the no-tool turns are outside it), so the product ranks beside `wait` and
  `ci` without double-counting; withheld, not zeroed, where there was no round trip.
- **the spread that price is a mean of** — `gaps`, and `distribution` inside it. Only this says
  whether the run was slow everywhere or slow once. **Read `max` and `p90` before proposing a batching
  change** — a flat spread is one batching helps, a single long think is not. `longest` names the
  phase each stretch was in. Withheld where no span or no tool call.
- **how much of the count was avoidable** — `bundles`, and `recoverable_round_trips` inside it. **Rank
  a batching proposal on this, never on floor arithmetic**, and multiply by `model_ms_per_round_trip`.
  **`by_tool` inside it names whose trips those were**; an **`Agent` row is the spread-apart launch
  series** (independent subagent launches that could have fanned out in one turn). The `recoverable by
  tool` row balances on every real run, so **a shortfall is a report defect**. `is_measured: false`
  withholds it; `recoverable_round_trips: 0` on a measured run is a real answer.
- **the idle spent waiting on a delegated unit** — `delegated_wait`, read like the `CI cycles` block.
  Each row is one delegation window with its `naked` part (main line idle with one unit in flight,
  which a second lane would remove); `behind <phase>` and `parallel` are already overlapped. **Rank a
  "parallelize this delegation" proposal on the naked figure, not the window's length.**
  `not measured` is not zero, and the block is withheld entirely for a run that never delegated.
- **the work thrown away** — `rework`. `files` names every path an `Edit` / `Write` touched with its
  edit count and `presence` (whether it reached the merged diff). `size` is the merged diff's
  `changed_file_count` / `additions` / `deletions`, **without which two runs' minutes cannot be
  compared**. `outside_file_count` is edits outside the work tree, **never added to `dropped_count`**.
  Three withheld states, none a zero: `is_measured: false`, `state: "refused"`, `state: "absent"`.
- **the per-tool and per-`josh` totals** — **rank a tool by its round trips as well as its
  duration**. Each `by_tool` row carries `round_trip_count` beside `call_count` and
  `alone_in_turn_count`. **Name the tool from `bundles.by_tool`, and use this table's
  `alone_in_turn_count` as the check** — the two disagree by design, and a proposal is sized on the
  smaller. `by_josh_command` carries neither count: a `josh` subcommand's round trips are already the
  `Bash` row's. Two of the capped tables, so read `notes` before saying a command is absent.
- **which guard refused, how often, and what re-issuing cost** — `guard_refusals`. Each `by_guard[]`
  row is one guard: `refusal_count`, the `cost_usd` of re-issuing, and `same_args_reissue_count` (the
  false-positive hint — a refusal answered with the identical call). **Rank by `cost_usd`.** Absent
  where no refusal fired; `is_cost_measured: false` prices none.
- **the entry-read documents, with re-reads** — `rows[].read_count` / `reads[]` /
  `duplicate_cost_usd`. **A whole-document re-read at a late, large context is the waste to name**:
  rank a document by `duplicate_cost_usd`, and read `reads[].context_tokens` to say whether the
  re-read fell where the context was largest.

**Never write a script to read the transcripts, and never restore the timings by eye** — a second
reader is a second classification, the one thing a measurement meant to compare two runs must not
have. If the command cannot answer, report what it printed and stop.

## Did the last speedup actually work?

**Before judging, confirm what the run actually shipped — never from the commit title.** Read the
merged diff's size (`rework.size`, which step 6 already read) and the Issue's completion comment, and
say whether the run **shipped a speedup** or was **analysis only**. A run whose merged diff is a
handful of lines, or whose completion comment reports analysis rather than a change, has no speedup to
verify: say so and skip the phase comparison rather than inventing a verdict from the title.

Re-measure the earlier run with `pnpm josh time --issue <M> --json` and compare it against step 6 on
the phase the speedup issue named. State the verdict in one line — worked, did not, or cannot tell —
with both figures beside it.

- **Compare the same phase, not the totals.** Human wait swamps everything and moves for reasons no
  change controls, so a run that got slower overall can still carry a phase that halved.
- **One run is not a sample.** `pnpm josh time --last <N> --top 5 --json` reports the last N merged
  runs as a min/median/max per phase and per CI check, with the **sample count** on every row. Take
  it before a verdict that rests on two runs; where two still disagree, say so.
- **The runs nobody measured are recorded in `.time-history.jsonl`** — one headline line per merged
  run from `josh followup` (issue, timestamp, elapsed, turns, tool calls, round trips, the two
  per-round-trip costs). It carries no phase table, so a phase verdict still comes from `--issue`. It
  is gitignored, so a fresh checkout legitimately has none.
- **The backlog over a period** — `pnpm josh time --period <N> --top 5 --json`: issues finished per
  day, per-lane busy and idle time, the stretches the work serialized on, and the wall clock another
  run was hiding. Lanes are derived from the wall clock. Reach for it when the verdict is about the
  backlog rather than a phase.
- **"Cannot tell" is an answer.** A phase `not detected` in either run, or a run with no merge read,
  cannot support a verdict.

## 7. One ranked list — already-filed issues stay in it

**Open the report with the three windows, then emit one table.** The header is the three lines step 6
read — the run body, the pull request's open→merged, the issue's opened→closed — each with its length
or `not measured`. It goes above the table because it is what the table's numbers are lengths _of_:
without it a reader cannot tell whether a five-minute saving is a quarter of the run or a fiftieth of
the issue's life.

Emit **one** table, ordered by the time each item would save per run, largest first — estimated from
step 6's figures, not from how easy the work looks. **Every row names the window it acts on** — run
body, pull request, or issue — because rows against different windows do not add up.

**Lead the table with the run-state findings from step 2.** A `cut_no_successor`, an `owner_stalled`,
an `expired` run, or a stretch of whiff wakes is the largest thing a run can lose and belongs at the
top, ranked by the idle time and the whiff dollars it cost.

**A batching row names the tool, never the density.** Take it from `bundles.by_tool` — the heaviest
row is the proposal, and its `sequence_count` says how many places in the run to look at — and size
the saving from that row's own `recoverable_round_trips` times `model_ms_per_round_trip`, never from
the whole block's total. **An `Agent` row proposes a fan-out** (launch these in one turn), sized from
its own `recoverable_round_trips`. "The density is 1.39, so batch harder" is not a row. Where the
breakdown is withheld (`is_measured: false`), say so and rank on the evidence left; a
`recoverable by tool` row that does not balance is a report defect.

**Every row carries both units — minutes per run and dollars per run — and names which one it acts
on.** The two do not follow from one another and are never converted between: cutting a CI wait saves
wall clock and no money, and cutting what every request carries in its prompt saves money on all of
them while moving the wall clock by an amount no run can resolve. A row states its saving in the unit
it acts on and `—` in the other; a row that genuinely acts on both states two figures.

**Order by whichever unit the report was asked for, and say which at the head of the table.** "Why is
`fullrun` slow" orders by minutes; "what is the backlog costing" orders by dollars. Neither hides the
other column.

**A row against one stage takes its dollars from that stage's own `phase_costs` row, not the run
total.** A stage carrying no row was not free (no billed request of its own inside it), and a scope
whose `phase_costs.is_measured` is `false` was never priced — both take `not measured`. **The
unattributed bucket is never spread across the rows** to make them add up.

**A role or a session is a ranking row too.** A large `roles[]` share from step 3, or a costly
`by_session[]` row from step 4 — including the stopped session, the one whose `end_state` is
`stopped`, weighted by that session's `cost_usd` — is the work that produced no merge and ranks by its
own dollars. A run with one session, or one that merged its first, has no such row, which is a real
answer.

**A proposal to stop delegating a step is ranked on `delegated_cost`, not on wall clock.** The
launch's fixed cost is `per_unit_cost_usd`, and a step whose own work is cheaper than that saves money
by staying in the main line — so the row states its saving in dollars with `—` in the minutes column.
Where `delegated_cost.is_measured` is `false`, say so rather than ranking off a zero.

**Estimate the dollar saving from step 6's per-request figures, never as a share of `cost_usd`.**
Dollars per request multiplied by the requests a change removes is a saving; a percentage of the total
is not, because the total covers work the change leaves in place. A change that removes carried tokens
rather than requests is ranked on the resident and history shares instead. **Where `missing` was
non-zero, a row that has a dollar saving still prints one** — on `--issue` those counters are the
whole corpus's, so one unrelated malformed line would otherwise empty every row — and it is labelled
**approximate** rather than a bound. `not measured` is kept for a scope with no priced record at all,
and a row that saves no money keeps its `—`.

**Rank a run's `cost_usd` against its change size, and flag an outlier in one line.** Put the run's
`cost_usd` beside the merged diff's line count (`rework.size`), compare against the last N runs
(`pnpm josh time --last <N> --json`), and where this run sits outside that distribution say so in one
line — **the figures only, never a cause named from them**.

**Read the observation ledger for the run's window, and add the un-filed ones as candidates.**
`docs/observations.md` records observations a run made but did not file, one line each; the ones in
the measured run's window are ranking candidates the backlog enumeration below never returns, because
an un-filed observation has no Issue to list. Carry the lines whose window overlaps the run into the
table as un-filed rows — the filing section files them through the scout — and say which you carried.

**Do not drop an item because it is already filed.** Avoiding duplicates means not filing a second
issue for the same work; it does not mean leaving the work out of the ranking. **A filed but
un-started issue is usually the highest-priority action in the table** — it needs no filing, only a
run — and a table that hides it reports the backlog as emptier than it is and re-proposes the same
work a week later.

**A phase whose earlier measurement is recorded is ranked against that record, not from the tables
alone.** A large phase invites a proposal every time it is measured, so the same measure gets
re-filed against a phase already found not to move. **`review` is the phase that has such a record** —
measured across joshuafolkken/kit#1305 (round-2 narrowing does not show in the wall clock),
joshuafolkken/kit#1418 (round 2's cost tracks its turn count, not how much of round 1 it repeats) and
joshuafolkken/kit#1436 (round 1's cost is dominated by a fixed part that splitting pays twice).
**Read those Issues before ranking `review`, and quote no figure you have not read there.** A proposal
one already covers is not forbidden but is **required to say why the recorded data does not reach it**,
and the row still appears in the table. The second recorded reading is the round-2 disposition cost —
measured in joshuafolkken/kit#1382 (corrected in joshuafolkken/kit#1465) — which reads the
`ci`, `pr` and `merge` stretches rather than the `review` phase.

**Enumerate the backlog before ranking it — never from memory.** A candidate set drawn from what a
session happened to remember leaves issues out; one listing, run every time, is what makes two `diag`
reports comparable.

```bash
gh api --paginate "repos/{owner}/{repo}/issues?state=open&per_page=100" \
  --jq '.[] | select(.pull_request | not) | "\(.number)\t\(.title)"'
```

- **It lists every open issue.** `select(.pull_request | not)` drops the pull requests the REST
  issues endpoint returns beside them, and nothing else is filtered; `--paginate` reads to the end. It
  is `gh api` rather than `gh issue list` because that one goes through GraphQL, which a cloud session
  is refused.
- **It is the one GitHub call this skill makes by hand** — no `josh` command enumerates a whole
  backlog.
- **An epic's child is an ordinary issue on its own row, and an epic is an issue too** — rank an epic
  where its children are the work, and never drop a row for being one. The one thing the listing does
  not reach is a child in **another** repository, written `owner/repo#N`.
- **A foreign repository is named in the path, never a flag**:
  `repos/<owner/repo>/issues?state=open&per_page=100`, and its rows need
  `pnpm josh issue:state <N> --repo <owner/repo>`.
- **It enumerates; it does not read state.**
- **Narrow by reading the titles, then say what you narrowed to** — report how many open issues the
  listing returned and which numbers you carried, so a later reader can re-run the command and see
  whether a row was missed.

| State | What the row prints |
| --- | --- |
| Un-filed | The proposal, and the estimated saving. Go to the filing section |
| Filed, not started | `#N`, and **the command to run next** — `fullrun #N`, or `backlogrun #E --only` for the epic that tracks it. Never a second filing |
| In progress | `#N` and that it is in progress. Do not propose running it again |
| Done | The verdict from the speedup section — whether it worked, with both figures |

**Read the state from `pnpm josh issue:state <N> [<N> ...]`, never by parsing `gh` output yourself —
and pass the whole table's numbers in one call.** One call per row costs a process start and a round
trip each; one call reads them all at once.

**Pass the numbers the enumeration kept**, plus any issue the speedup section re-measured — that one
has shipped, so a `state=open` listing never carries it. A row whose state was never read cannot be
placed.

```bash
pnpm josh issue:state 1262 1222 1176
# issue: 1262
# state: OPEN
# labels: in-progress, route:split
# human_review: no
#
# issue: 1222
# state: CLOSED
# labels: (none)
# human_review: no
```

**Attribute each block by its `issue:` line, never by position.** A number that produced no state
prints no block, so counting blocks off against the numbers you passed misreads every row after the
gap. A single number is unchanged — the three lines with no `issue:` heading, the form the
`workflow-commands` skill §2z reads.

**Pass bare numbers, not the `#N` the table prints** — a token carrying the `#` refuses the whole call
with the usage line.

Map its output to the table above: `CLOSED` is **done**; `OPEN` carrying `in-progress` is **in
progress**; `OPEN` without it is **filed, not started**. A number that `does not resolve`, or a read
that answers `could not read`, is reported as unknown — `could not read` is a failed read, never "the
issue is open".

**Matching `in-progress` is yours to do, and the `labels:` line is compared case-insensitively —
lowercase that one line before matching, and leave the `state:` line's casing alone.** Only
`human_review:` arrives already decided that way; GitHub treats `In-Progress` as the same label as
`in-progress`, so a match against the lowercase string alone tells someone to start a run that is
already going.

Which epic to name for a filed row comes from `pnpm josh epic:bundle <N>`, which names the epic that
already tracks it. **Read the `epic-commands` skill before running that or any other `epic:*`
command**, as `CLAUDE.md` requires.

## File only through `pnpm josh issue:scout`

An un-filed row is filed only after the scout has answered:

```bash
pnpm josh issue:scout "<title>" --body "<one line, citing the issue this follows from>"
```

- **`Duplicates:` is read, not skimmed.** Open each candidate. One that covers the same work turns the
  row from un-filed into filed — move it to that state in the table, with the command to run — and
  **do not file**.
- **Pass `--body`.** The epic half decides from the issue numbers the summary names, so a title-only
  call answers `Epic: not asked`, which is not `Epic: none`.
- **`Epic:` is the placement**, and `add_to_epic` / `create_epic` are Tier A: execute them with
  `pnpm josh epic --add` / `pnpm josh epic`, never by hand-editing an epic body. `ask` is Tier A too —
  choose the epic you recommend and record why.
- Filing is Tier A only for a first-party target — an owner equal to this repository's. A third-party
  tracker is Tier C and is not written to here (`CLAUDE.md` → "Third-party repositories are Tier C").
- Run `pnpm josh epic:bundle <new>` on each issue filed, so it is one `epic:next` will offer rather
  than one parked forever.

## What `diag` does not do

- It does not implement anything, and it opens no pull request.
- It does not run `fullrun` / `backlogrun` on what it ranks. It prints the command; the person types it.
- It does not measure anything itself. **Every figure came out of one of two commands**, and none is
  re-derived here: the wall clock from `pnpm josh time` and the dollars from `pnpm josh cost` — two
  readings of the same recorded sessions, which is why they can be quoted side by side.
