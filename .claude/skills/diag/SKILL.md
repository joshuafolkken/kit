---
name: diag
description: The procedure behind `diag fullrun` / `diag epicrun` / `diag #<N>` (and `/diag`) — measure where a run's wall clock actually went with `pnpm josh time` and what it cost in dollars with `pnpm josh cost`, say whether the last speedup issue worked, and rank what to cut next as one table that keeps the already-filed issues in it. Read this whenever asked how long a run took, what a run cost, why `fullrun` is slow, what to do to make it faster, or to check whether a speedup landed.
---

# `diag` — read the timing report, propose the next speedup

The measurement is a command; deciding what to cut from it was still being pasted in as a prompt
every time. Two real requests, three weeks apart, asked for the same thing in different words — one
asked for a verification of the previous speedup and one did not, so the two answers were not
comparable (joshuafolkken/kit#1270). This skill is that request written down once.

**`diag` is analysis, not a workflow.** It never implements, commits, merges or starts a run. Where
its answer is "run this", it prints the command for the person to type — the explicit-invocation
rule in `CLAUDE.md` is unchanged, and `diag` is not one of the keywords it governs.

## Which run to measure

| Typed | What it measures | The call |
| --- | --- | --- |
| `diag` / `diag fullrun` | The most recently merged run | `pnpm josh time --top 5 --json` |
| `diag #<N>` | Issue `#N`'s whole run, from the `fullrun` invocation to the merge | `pnpm josh time --issue <N> --top 5 --json` |
| `diag epicrun` / `diag #<E>` where `#<E>` is an epic | Every child of the epic, in execution order | `pnpm josh time --epic <E> --top 5 --json` |
| `diag backlog` / `diag <N> days` | The backlog over a period — lanes, idle, serialization, throughput | `pnpm josh time --period <N> --top 5 --json` |

**The period scope answers a different question from the three above it**
([#1470](https://github.com/joshuafolkken/kit/issues/1470)). Those three report where **one run's**
wall clock went; `--period` reports how fast the **backlog** emptied, which is what actually wants
shortening and which no single run's internals can show. Read it when the question is whether a lane
sat idle, whether the work serialized behind one run, or whether a wait was hidden behind other work
rather than exposed bare — and read one of the three above when the question is which phase of one
run was slow. It is built from `.time-history.jsonl` alone, so it needs no `gh` call and no
transcript, and a checkout whose history is empty is told so rather than shown a table of zeroes.

An epic is measured child by child because a run is measured from its `fullrun` invocation to its
merge, and an `epicrun` is several of those. **One call does the whole batch**
([#1271](https://github.com/joshuafolkken/kit/issues/1271)): `--epic` enumerates the children from
the epic body itself, orders them by when they actually ran, and carries each child's own report
under `children[]` — so there is no loop to write and no list of numbers to assemble first. It also
prints the **model wait per turn** of each child and the direction across them, which is the one
figure a `--issue` call per child could never produce.

**Read the four child states before quoting a figure.** `not run`, `no transcript` (merged, but no
session transcript attributed — only the CI wait is known) and `not merged` are not durations of
zero, and the batch totals withhold any half no child contributed to. A child named in one of those
states is reported as unmeasured, never counted as zero.

## 1. Measure with `pnpm josh time` and `pnpm josh cost`, never by hand

```bash
pnpm josh time --top 5 --json               # alias: josh tm
pnpm josh time --issue <N> --top 5 --json
pnpm josh time --epic <E> --top 5 --json
pnpm josh time --last <N> --top 5 --json    # the spread across the last N merged runs
pnpm josh time --period <N> --top 5 --json  # the backlog over the last N days — lanes, idle, serialization
```

**For a `backlogrun` or `epicrun` *parent*, read `Turns by contributor:` first** ([#1715](https://github.com/joshuafolkken/kit/issues/1715)). A parent barely implements anything, so its durations rank tools rather than work; the contributor block is what says whether the turns went on progress polling, on confirming children, on the loop's own asks, or on reading issues — and a parent's cost grows as n²/2 in its own request count ([#1567](https://github.com/joshuafolkken/kit/issues/1567)), which makes its **turn count** the thing to cut. Measured over four recorded `backlogrun` parents the largest was `issue bookkeeping` at 26.6% of 414 turns. **A large contributor is a reason to look, never a finding** — whether those turns were avoidable is `Bundling:`'s answer, and the two are ranked together in step 3.

**One reading is not `josh time`'s, and asking it for one is how the repetition stays invisible** ([#1313](https://github.com/joshuafolkken/kit/issues/1313)). Which checks run in more than one verification layer — `josh gate`, the pre-commit hook, the pre-push hook, CI — cannot be read from a session transcript at all: a hook's seconds are buried inside `josh git`'s, and CI's appear only as a per-check duration with nothing to compare them against. Run `pnpm josh layers` (alias `josh ly`) when a candidate is about removing work rather than about overlapping it; it reads the configuration files and re-derives the answer, so it stays true when a hook changes. It measures no seconds, so a row it produces is ranked below in step 3 on what the repeated check costs in `josh time`'s own tables.

**A second reading is not `josh time`'s either: whether a slow check was slow or merely cold** ([#1314](https://github.com/joshuafolkken/kit/issues/1314)). A transcript records one run of a command in whatever cache state that run happened to be in, so a 133-second `josh gate` in the tables says nothing about whether the next one costs 133 seconds or 17. Run `pnpm josh bench <target>` (alias `josh bn`) before proposing a saving on a verification command: it clears that target's own caches, runs it, runs it again, and prints the pair — `eslint --cache` measured 128.4 s cold against 2.9 s warm. **Rank the candidate on the figure the run will actually pay.** A row whose cold reading dominates is a cache problem, not a check to remove, and a proposal to delete a check because the transcript happened to catch it cold is the mistake this reading exists to prevent. It runs real commands and costs real minutes, so ask it about the one or two rows in question rather than the default set.

**A third reading is not `josh time`'s either, and it is the one every report has been missing whole: what the run cost in dollars** ([#1609](https://github.com/joshuafolkken/kit/issues/1609)). `josh time` measures wall clock and nothing else, so a `diag` table ordered off it alone can only ever rank minutes — and the 2026-09-09 report did exactly that, on a backlog whose own epic ([#1262](https://github.com/joshuafolkken/kit/issues/1262)) records credit rather than wall clock as the larger of the two costs. **The figures were already shipping and nobody was reading them.** Take them with the scope flag:

```bash
pnpm josh cost --issue <N> --json     # this run's cost; alias: josh co
pnpm josh cost --session <id> --json  # one session, or one delegated unit as <session-id>/agent-<agent-id>
```

**`--over` is not the flag this step wants, and the command refuses it beside `--issue`, `--all` and `--json` alike** — it answers a different question, whether *this* session has grown too large to hand off, so it reads the session it is already in rather than a scope and exits with the usage line rather than reconciling the two. `diag` reads a scope, so what it passes is the scope flag with `--json` beside it, never `--over`.

**The output is an array of reports even where the scope is one issue**, so read `[0]` rather than the document. Four fields carry the reading — `request_count`, `cost_usd`, `breakdown` and `missing` — and the `breakdown` half is `resident_baseline_tokens`, `resident_billed_tokens`, `history_billed_tokens` and `billed_input_tokens`. **Four derived readings come out of them, and the JSON prints none of them**: the resident and history shares of `billed_input_tokens`, the tokens per request, and the dollars per request. The human-readable report prints the two shares and `--over` prints the tokens per request — but `diag` reads the JSON, so derive all four here rather than taking a second reading in another mode to get two of them. Run #1597 read 92 requests and **$13.16**, resident **32.7%** against history **67.3%**, **168,919** tokens per request and **$0.143** per request — the numbers a hand measurement re-derived that same day, which is what this reading exists to stop.

**Read `missing` before quoting any of them, and a non-zero count is unmeasured rather than zero.** Its four counters — `no_usage_lines`, `malformed_lines`, `unreadable_sessions` and `unattributed_sessions` — say how much of the corpus could not be priced or attributed, and on an `--issue` scope the first three are the **whole corpus's** rather than that issue's, deliberately: a line nobody could parse carries no branch, so it cannot be ruled out of the issue either. **`unattributed_sessions` is the fourth, and it is why a `missing` of three zeros is not proof of a complete read** ([#1812](https://github.com/joshuafolkken/kit/issues/1812)): a delegated unit runs before the commit, so it carries no issue branch, and where its parent named no single issue it follows nothing — its cost lands in no issue at all, and until then was silence rather than a count. This is the same distinction `span_count: 0` and `not detected` make everywhere else here — **withheld is not measured as zero** — so a `cost_usd` reported beside a non-zero `missing` is a floor and is labelled one, never quoted as the run's cost. A non-empty `unpriced_models` is a second floor, and that one the command flags itself.

**Three more fields carry a reading, and until [#1853](https://github.com/joshuafolkken/kit/issues/1853) the four above named none of them — `curve`, `outliers` and `cap_simulation`.** `curve` is the positional growth of context across the run, and it is built from the **main-line session alone**: a scope spanning sessions — an issue whose parent delegated units, or a run resumed in a second session — carries `measured: false` and a `session_count` rather than a curve, which is `not measured` and never a flat or downward one, so a hand-off decision reads the main line's own direction instead of a mix that ran backwards. **Read `curve.measured` before quoting its direction** — a `false` is withheld, not a run that did not grow. `outliers` names the requests whose cache write dominated the run, largest first, each with its minute offset from the run's first request and its estimated cost — the single most expensive round trip, which both `totals` and `curve` average away; a mid-run Skill load that rewrote the whole prefix reads as one 303,637-token, $3.06 request here and as nothing in any other field. `cap_simulation` is present only under `--cap`: the share of priced cost incurred at or under a per-request token cap, `not measured` where nothing could be priced.

**The phase axis is `josh time`'s, not this command's, and it is read from there** ([#1606](https://github.com/joshuafolkken/kit/issues/1606)). `josh cost`'s own record attributes a request to an issue and to nothing finer, so nothing here charges a dollar to `gate` or `review`; what does is `phase_costs` on the run-scope `josh time` report, which places each billed request's own instant inside the phase window that contains it. Read the money per phase there and the run total here, and never construct a per-phase figure by taking a share of `cost_usd` — that is the guess wearing a measurement's clothes this paragraph was written against, and it is the same error the ranking rule in step 3 forbids.

**`--top 5` is part of the call, not a nicety** ([#1301](https://github.com/joshuafolkken/kit/issues/1301)). Without it the JSON carries every row of the per-tool and per-`josh <cmd>` tables, and an epic pays for both once per child — epic #1262 measured 47.7 KB at 9 children and had more than doubled by 18. What this skill ranks off those tables is the handful of rows at the top, so the tail is read into the context and never used. Everything else the steps below quote — the four shares, every phase, the round trips and their price — is unaffected: the cap reaches the **row tables** and nothing else.

**Five tables are capped, not two** ([#1311](https://github.com/joshuafolkken/kit/issues/1311), [#1387](https://github.com/joshuafolkken/kit/issues/1387)): `by_tool` and `by_josh_command`, plus `segments` — the run read as timed stretches — `by_invocation`, each call of a command that ran more than once, and `rework.files`, one row per file the run edited. **`rework.files` is ordered dropped-first, so a cut table keeps the findings** and its `dropped_count` / `outside_file_count` stay totals over what was measured rather than sums of the printed rows. **`segments` is the one whose cut is not a tail.** The table is in run order, so the cap keeps the **longest** five stretches and puts them back in that order rather than keeping the first five and losing the merge; five rows are therefore a sample of the run and never its shape. **Read a segment listing as evidence about the stretches it names, never about the ones between them** — and where the shape of the run is itself the question, drop the flag and say that you did, exactly as for a thin per-tool tail.

- **A cut table says so, and that note is not a zero.** The report's `notes` carry `by_tool: showing the top 5 of 34 rows — 29 withheld by --top`, which is the same distinction between *withheld* and *measured as nothing* that `span_count: 0` and `not detected` make elsewhere here. **Never read a capped table as the whole of what ran.**
- **Drop the flag when the tail is the question.** A run whose cost is spread thin across many commands rather than concentrated in a few is exactly the case five rows cannot show; re-run the same call without `--top` and say that you did.

**Never write a script to read the transcripts, and never restore the timings by eye.** That is what
the command replaced, and a second reader is a second classification — the one thing a measurement
meant to compare two runs must not have. If the command cannot answer, report what it printed and
stop; it says which of `--issue` / `--session` picks a scope, and it exits non-zero rather than
printing a table of zeroes.

Read from the JSON, in this order:

- **the three nested windows** — `windows.run`, `windows.pull`, `windows.issue`
  ([#1409](https://github.com/joshuafolkken/kit/issues/1409)). They are the frame everything below
  sits in: the run body is what the run itself controlled, the pull request's open→merged is the
  stretch the merge gate owned, and the issue's opened→closed is how long the work was outstanding at
  all. **Read them before the shares**, because a saving is only ever a saving *of one of the three* —
  a proposal that cuts two minutes of gate time cuts the run body and moves the issue window not at
  all, and a table that does not say which one it acts on cannot be added up. **They are not phases
  and never enter the phase table**: they cover no spans, so nothing here is a share of `elapsed_ms`,
  and `pre-run` / `post-run` are the opposite question — transcript spans that fall *outside* the run
  window rather than windows the run falls inside. **Each carries its own `is_read`, and a `false`
  there is not a zero**: a `--session` scope has neither a pull request nor an issue, an issue with no
  pull request has no middle window, and one still open has no third — the printed rows say
  `not measured`, exactly as `span_count: 0` and `not detected` do elsewhere here.
- **the four shares** — model wait, tool execution, human wait, CI wait. **A run with `span_count: 0`
  measured none of the first three**: the JSON still carries their milliseconds as `0`, and that zero
  is an unknown rather than a measurement — the printed table says so with `not measured`. Ranking a
  stage off them there is ranking an unknown
- **the phase breakdown** — `plan` / `setup` / `implement` / `gate` / `rework` / `review` / `pr` /
  `wrapup` / `ci` / `merge` / `wait` / `wait-outside` / `pre-run` / `post-run` / `other`, which says
  which *stage* is long where the per-tool table says which *command* is slow. **`pre-run`,
  `post-run` and `wait-outside` are not stages and are never ranked** (joshuafolkken/kit#1299,
  joshuafolkken/kit#1331): they are what the branch attribution swept in from before the run opened
  and after it merged, so a cut proposed against any of them would cut a different piece of work —
  and `wait-outside` is the same sweep's share of the waiting, which is why `wait` alone is the row
  a stop-reducing proposal is measured against. `setup` and `wrapup` are the run's own, and both can
  be ranked.
- **`ci` is not the `CI wait` share, and it is the row a CI proposal is ranked off**
  (joshuafolkken/kit#1384). The share is the part of the open→merge window no span covers; the phase
  adds what the merge command itself sat waiting for, read from the check-runs of **every commit of
  the pull request** rather than the head one alone. So a run that watched its own merge reads
  `CI wait 0.0 min` beside a `ci` of real minutes, and the note under the heading says by how much.
  **`ci: 0` never meant "nobody waited" and now does not read that way either**: it was this exact
  misreading that ranked joshuafolkken/kit#1226 last as work with no wall clock behind it, when the
  cycle it would have cut ran 70 seconds of a 117-second merge command. A cycle that ran beside the
  review or beside a gate is genuinely free and stays out of the row, and where the cycles could not
  be read the phase says `not detected` rather than zero.
- **`gate` is read like `ci`, and for the same reason** ([#1812](https://github.com/joshuafolkken/kit/issues/1812)).
  The gate is launched into the background (§2h), so the `gate` phase and its `by_invocation` rows
  carry only the two-second dispatch rather than the minutes it ran. Its real runtime is the
  `Gate runtime (backgrounded)` block, in the shape the `CI cycles` block uses: the real length and
  the `naked` part the run spent on it alone, and `not measured` rather than a zero where the
  backgrounded gate was never read back. **A small `gate` figure no more means the gate was fast than
  `ci: 0` meant nobody waited** — read the runtime block, and where it says `not measured` the length
  is unknown rather than zero.
- **`is_detected` per phase** — a phase that never appeared prints `not detected`, and that is not a
  measured zero. Never rank a phase you did not measure. `wait`, `wait-outside` and `other` rest on
  no marker, so they are `false` only where no span was read — the same state the three transcript
  shares are withheld in.
- **`phase_costs` — what each stage cost in dollars** (joshuafolkken/kit#1606). `by_phase` carries a
  `request_count` and a `cost_usd` per phase, placed by each billed request's own instant falling
  inside that phase's window; it is the dollar column beside the minutes column above, and it is what
  lets a proposal against `review` or `gate` be ranked in money rather than only in wall clock.
  **`unattributed` is a bucket, not a rounding error**: a request inside no phase window — and one
  whose timestamp could not be read — is counted there and **never prorated into the phases**, the
  same treatment `wait-outside` and `pre-run` get in the phase table, so it is reported and never
  ranked. **`is_measured: false` means the cost corpus was not read for this scope, not that the run
  spent nothing** — only `--issue` and the no-argument latest-run scope read it, because pricing walks
  the whole transcript directory and `--epic` / `--last` would pay that walk once per child. A phase
  with minutes and no row here had no billed request of its own inside it, which is a real answer.
- **`contributor_costs` — what each _purpose_ cost, and the turns that called nothing** (joshuafolkken/kit#1872). Where `phase_costs` keys the dollars by stage, this keys them by what the turn was _for_: `by_contributor` carries a `request_count` and a `cost_usd` for each of the eight purposes the `Turns by contributor:` block counts — `implementation`, `child dispatch`, `progress polling`, `child confirmation`, `loop asks`, `issue bookkeeping`, `investigation`, `other` — so a run whose bill is mostly bookkeeping or polling reads as that rather than as a long `review` phase. **`no_tool_call` is a bucket, not a rounding error**: every assistant message is billed whether or not it issued a tool, and the utterance-only turns `group_round_trips` drops land here — counted, and **never prorated** into the purposes that did call something, because the count of them is exactly the reading this block was added for. **`is_measured: false` means the cost corpus was not read for this scope, not that the turns were free** — the same `--issue` / latest-run opt-in `phase_costs` has, so a zero here is an unknown and never a free run. **Turn it into a ranked row the way the phase costs are**: the purpose's `cost_usd` is the row's weight — the money, not the turn count — and `Bundling:` is what says how much of it was avoidable; a large purpose is a reason to look at what those turns did, never a finding on its own, and a high `no_tool_call` is the one that points at deliberation rather than at any tool to bundle.
- **`delegated_cost` — what launching each subagent cost, and the run's total**
  ([#1882](https://github.com/joshuafolkken/kit/issues/1882)). A delegated unit starts from an empty
  context and writes the whole resident prefix into cache on its first request, so every launch
  carries a fixed cost the run report was blind to. `units[]` names each one with its
  `baseline_tokens` — that context construction — and its `cost_usd`; `unit_count`, `baseline_tokens`,
  `cost_usd` and `per_unit_cost_usd` are the run's totals and its per-launch average, read on the same
  `--issue` and latest-run scopes `phase_costs` is. **Read it before crediting a delegation with a
  saving**: a step handed to a unit whose own work is cheaper than `per_unit_cost_usd` cost more to
  delegate than to run in the main line, which is the finding this block exists to make visible.
  **`is_measured: false` means the cost corpus was not read for this scope, not that no subagent ran**
  — a measured run with `unit_count: 0` did its work in the main line, which is a real answer. **A
  unit on a model the price table does not carry contributes tokens and no dollars** —
  `unpriced_unit_count` makes `cost_usd` a floor, said in words beside the launch total.
- **the two review rounds against each other** — `segments`, read as one pair rather than as two rows
  ([#1412](https://github.com/joshuafolkken/kit/issues/1412)). The listing already carries both rounds
  of a two-round run, and a report that prints them as two numbers converts nothing into a reading: on
  run #1399 they read 260.1 s and 259.9 s and the report stopped there, while the run's `review` phase
  was 496.1 s of 1,198.1 s — 41% of it.
  **A pair is identified by a `pr` segment between the two `review` rows, and by nothing else.** Round
  2 runs after `pnpm josh git -y` (`prompts/review.md` → "The pull request opens between the rounds, so
  CI runs beside round 2"), so that row is the positive evidence that two rounds ran — the earlier
  `review` row is round 1 and the later one round 2. **Its absence proves nothing, and there are two
  ways to lose it.** `--top 5` keeps the *longest* five segments, and the `pr` row is short where both
  review rows are long — on run #1399 it was 43.2 s, and the cap drops it while keeping both rounds; a
  `josh git` under `MIN_SEGMENT_MS` is absorbed by the flicker rule instead of printed. So **re-read
  `segments` without `--top` before deciding a `pr` row is missing**.
  **Two `review` rows with no `pr` between them in an uncapped listing are ambiguous, and ambiguous is
  the answer.** They are either two rounds whose commit was absorbed, or one round cut in two by any
  intervening stretch over `MIN_SEGMENT_MS` — a `gate` call, or the `rework` a round's own fixes are
  charged to. Report that the pair could not be identified rather than a ratio built on a guess; a
  round is unambiguously one forked agent, so `pnpm josh time --session <session-id>/agent-<agent-id>`
  is where that question is settled.
  **Take the ratio round 2 ÷ round 1, and report it at 0.95 or above.**
  `prompts/review.md` → "The second round is a verification pass, not a second full review" specifies
  round 2 as a pass over the fix delta, so a round 2 that costs what round 1 cost is not the cheaper
  pass that specification describes, and that is worth saying out loud.
  **The threshold rests on a distribution, and that distribution is not quoted here.** This rule's own
  reading is run #1399's — 259.9 / 260.1 = **1.00**, taken from `segments` and recorded on
  joshuafolkken/kit#1305. Where 0.95 comes from is the record below: `prompts/review.md` → "The
  re-derivation round 2 does is real, and it is not what round 2 costs" reports the round-2 ÷ round-1
  ratio over every pair it measured, and **0.95 sits above that median and inside the group at the top
  of it** — so it catches the tail without firing on an ordinary run, which a threshold set near the
  median would do. **Read those figures there rather than from a copy here**: they move whenever the
  phase is re-measured, and a copy in this file would go on quoting a retired number with nothing
  failing.
  **The ratio is read on this grain and on no other.** A segment's `duration_ms` sums its member spans,
  the flickers it absorbed included, so it is a stretch of the run rather than either round's own cost
  — on run #1399 the two rows total 520.0 s against a `review` phase of 496.1 s. The record's ratios
  are span-level and can place the same run a little differently from this reading, which is one more
  reason the row is a reading rather than a filing.
  **Name no cause, and never read one run as the mechanism.** `segments` carries durations and nothing
  whatever about what either round did, so "round 2 re-read the whole diff" and "the fix delta never
  reached it" are inventions — on run #1399 both are false, and #1418 found round 2's first command was
  a `git diff` over the fix delta alone. A single ratio near 1.00 is the tail of the distribution above
  rather than evidence about the mechanism, which is what
  `prompts/review.md` → "The re-derivation round 2 does is real, and it is not what round 2 costs"
  records. So the row carries both durations, the ratio, that this run sits in that tail, and that the
  cause is readable only from the forked review agents' own transcripts —
  `pnpm josh time --session <session-id>/agent-<agent-id>`. **It is a reading, not a filing**: step 3
  ranks `review` against the record those two sections hold, and this row does not lift that bar.
  **A pair is exactly two `review` rows with a `pr` row between them, and five states are not one.**
  **One `review` row is not a one-round run.** A clean round 1 does produce one — but so does a
  two-round run whose `pr` group fell under `MIN_SEGMENT_MS` and was absorbed, since the review spans
  either side then take the group's name back and the two rounds are emitted as a single row. A lone
  row therefore says the pair could not be identified, never that one round ran. **More than two
  `review` rows** is that same answer from the other side: at least one round was cut, and "the earlier
  row is round 1" would divide a whole round by a fragment of one. `review` reading `not detected` in
  the phase table — no round ran that this could be about. `span_count: 0` — no transcript was read, so
  the listing is empty and withheld rather than zero. And a `segments` table the `--top` cap cut: the
  review rows are normally among the longest five and survive it while the short `pr` row between them
  does not, so **re-read without the flag before calling any of these states the run's shape**
- **what the round-2 disposition cost — the extra commit and the CI cycle behind it**
  ([#1403](https://github.com/joshuafolkken/kit/issues/1403)). `prompts/review.md` → "Three-way
  disposition after the cap" gives a finding still standing after round 2 three exits — fix it in
  place, file it, or drop it with a one-line PR note — and **only the first pushes a second commit**,
  which runs CI once more — and that second cycle is the one the merge command sits on, the gate
  beside it having finished first (`prompts/review.md` → "The round-2 fix commit is pushed before its
  gate, so its CI runs beside it"). That choice is made on every
  two-round run, and this row is the instrument that priced it: its acceptance condition was the
  serial cost **and the frequency** across several runs, and joshuafolkken/kit#1382's answer — both
  of those, and why the status quo was kept over cutting the cycle — is
  `prompts/review.md` → "What a round-2 fix-in-place costs, and how often it is paid".
  **Read that record before proposing a cut here**, on the rule step 3 already applies to the
  `review` phase: this row produces one run's figures and holds no memory of what an earlier reading
  concluded, so a proposal it already answers is required to say why the recorded data does not reach
  it. **The distribution stays there and no part of it is copied here** — what this row keeps below
  is run #1399's own worked example, which is arithmetic over one immutable run rather than a set
  that moves every time it is re-measured.
  **The detector is a `pr` segment *after* the round-2 `review` row.** The pair is
  identified first, by the rule above: the `pr` row *between* the two rounds is the pull request
  opening, and a *second* one after the later `review` row is the fix commit. On run #1399 the tail
  reads `review 259.9 s · wrapup 37.7 s · pr 34.5 s · merge 177.1 s`, and that third row is the commit
  this prices. **`by_invocation` corroborates it in both directions, and neither answer is read
  without it**: `josh git — 2 call(s)` beside a second `pr` row, and **no `josh git` row at all**
  beside a run reported as not having one — a command called once is filtered out of that table, so
  its absence is what one commit looks like there.
  **Read both from uncapped output, always.** `--top 5` keeps the longest five of each, and the `pr`
  rows are short: on run #1399 they were 43.2 s and 34.5 s against a `merge` of 177.1 s and two
  `review` rows of 260 s, so the default call drops the evidence for both halves of this reading — and
  an absence the cap produced is not a measurement.
  **A `pr` group under `MIN_SEGMENT_MS` (30 s) is absorbed rather than printed, and run #1399's was
  34.5 s.** A fix commit five seconds shorter than that one therefore leaves exactly the shape the
  negative answer is written from, which is why that answer rests on `by_invocation` rather than on
  `segments` alone. **Where the two disagree — no second `pr` row beside two `josh git` calls — the
  answer is `could not tell`, never the negative.**
  **A second `pr` row is not proof the commit was round 2's.** A commit pushed to repair a red CI or a
  red gate lands in the same place and reads identically, so the price would be charged to a
  disposition that did not buy it. Read the report's `failures` over that stretch first: a failure
  chain there means the cycle was bought by the failure, and the row says so instead of pricing it
  here.
  **Sum exactly four stretches, and print each one beside the total** — the four
  [#1403](https://github.com/joshuafolkken/kit/issues/1403) enumerated, each with one source. **The
  second `josh git`** and **the last `josh gate`** are that row's own entries in
  `by_invocation.durations_ms`: the commit the fix pushed, and the gate that then ran beside its CI.
  **The second CI cycle is the last row of the `CI cycles` block, read as its `naked` figure**
  ([#1465](https://github.com/joshuafolkken/kit/issues/1465)). The block prints one row per check
  window — `00:44:43 → 00:46:26  1.7 min  naked 103.0 s` — and the naked figure is the part of that
  cycle nothing but the merge command overlapped, which is exactly what the run waited.
  **The phase difference it replaces read low, and by more than half.** `ci` minus
  `categories.ci_ms` is `serial_ci_ms`: the part of a cycle the merge spans cover *and nothing else
  does*, which drops every minute of a cycle that no span covers at all — `followup` not yet issued,
  or between attempts. On run #1441 that difference read **56.5 s** against a hand-measured **103 s**,
  and the sum it fed was reported as sitting in the middle of the recorded distribution when the run
  was in fact above its maximum. **It also could not say which cycle was which**: that run's first
  cycle (1 m 49 s) ran wholly behind the second review round and cost nothing, its second (1 m 43 s)
  ran naked, and one folded number reads them the same.
  **A row whose `naked` equals its length ran with nothing beside it; one that says `behind …` names
  the phase and the busiest command it hid behind** — the evidence that the hiding place was real,
  rather than an inference from two totals. **The single check the fix reached** has two
  readings and no third: the last entry of that check's `by_invocation` row where it ran more than
  once, and `single_checks.duration_ms` where the run issued exactly one single check all told —
  **a check called once has no `by_invocation` row**, which is this component's ordinary case rather
  than its exception. Where neither holds, **report the check as unattributed and the total as a lower
  bound**; never estimate it. Run #1399, in run order — check 4.4 s, `josh git` 27.0 s, `josh gate`
  17.4 s, CI 84.0 s — totals **132.8 s, 11.1% of a 1,198.1 s run**, the check 4.4 s of it against
  128.4 s for the other three.
  **The sum is a re-reading of rows already in the tables, never minutes to add to the run.** All four
  are already counted once — three in tool execution, the fourth in the `ci` phase — so the line
  prices a decision and does not lengthen the run it was read from.
  **That last row is an *extra* cycle only where the detector fired.** It is the CI the merge command
  sat on, and a clean round 2 has one cycle that can be partly serial too — so the same figure means
  "the second cycle" here and "the only cycle" there. Never quote it as an extra cycle on a run whose
  second commit was not found.
  **The fix's own editing time stays out of the sum.** The `wrapup` stretch between round 2 and the
  second commit — 37.7 s on run #1399 — is what the finding cost to resolve, and filing it as a
  follow-up Issue costs writing time too. What the three-way choice buys is the verification cycle, so
  that is what this prices.
  **Three answers, and only one of them is a number.** A second `pr` row after round 2, with
  `josh git — 2 call(s)` beside it, is **occurred**, reported with the sum. No second `pr` row **and**
  no `josh git` row at all is **did not occur** — a round 2 that found nothing to fix in place,
  **never reported as 0 minutes**. Everything else is **could not tell**: the two evidences
  disagreeing, a pair that could not be identified in the first place — any of the five states above —
  a listing read with `--top`, `ci` reading `not detected`, a `CI cycles` block reading
  `not measured`, or a `failures` chain that makes the
  second commit someone else's. Report it as such rather than resolving it either way.
  **A `CI cycles` block that is absent is not `not measured`**: the block is withheld only where the
  scope has no pull request at all, and a scope with no pull request has no second commit to price
  either.
  **Frequency comes from `--last <N>`, by applying this detector per run.**
  `pnpm josh time --last <N> --json` carries every run's whole report under `runs[]`, so the three
  answers counted across that set are the frequency joshuafolkken/kit#1382 asks for. Drop `--top`
  there for the reason above, and **report the three counts rather than a rate** — a set whose runs
  were mostly `could not tell` has no rate worth quoting
- **the round trips** — `tool_call_count` and `round_trip_count`, and the density between them
  (joshuafolkken/kit#1304). Once the verification commands were cut, this is what sets a run's floor:
  the tools themselves run for well under a minute while the turns they sit in cost ten times that.
  **A density near 1.00 is the finding, not a detail** — it says independent calls went out one per
  turn, and the printed block says so in a line. It rests on the same transcript the three shares do,
  so a scope with `span_count: 0` measured none of it either
- **how many turns the density is made of** — `batched_turn_count` and `single_call_turn_count`
  ([#1385](https://github.com/joshuafolkken/kit/issues/1385)). They sum to `round_trip_count`, and a
  density of 1.07 over 101 round trips can be 7 turns of two calls against 94 single-call ones, or 3
  turns issuing three and four calls against 98 — the same number over two differently-shaped runs,
  and the second has less than half as much batching to build on. Quote the pair beside the density rather
  than the density alone.
  Withheld with the block they are printed in, so `span_count: 0` reports them unmeasured too
- **the price of one round trip** — `ms_per_round_trip`, with `model_ms_per_round_trip` beside it
  (joshuafolkken/kit#1307). The counts above say how *often* a run went round; this says what one of
  them is worth, and **without it the round trips cannot enter step 3's table at all** — that table
  ranks by minutes saved per run, and a count is not minutes. Multiply the price by the trips a
  proposed change would remove, and rank the product against the phases. **The model share is the
  part batching actually removes**, because a tool's own execution is paid whichever turn it was
  issued from. **`usd_per_round_trip` is the same reading in money** (joshuafolkken/kit#1606), on
  **the same denominator** — `round_trip_count`, so one recoverable-trip figure multiplies both and a
  bundling proposal enters step 3's table with a minutes column and a dollars column rather than one.
  **What differs is the numerator's unit of work, and the block prints both counts so it cannot be
  missed**: minutes are measured over the spans a turn issued, while dollars are measured over billed
  requests, and a run has more requests than round trips because every assistant message is billed
  whether or not it called anything. So `usd_per_round_trip` × trips removed is the saving; `cost_usd`
  ÷ `request_count` × requests removed is the other reading, and the two answer different questions.
  **The price is not a share of `elapsed_ms`** — human wait, CI wait and the turns that
  called nothing are all outside it, so the product can be ranked beside the `wait` and `ci` rows
  without counting the same minutes twice. It is withheld rather than zeroed where there was no round
  trip to divide by
- **the spread that price is a mean of** — `gaps`, and `distribution` inside it
  ([#1386](https://github.com/joshuafolkken/kit/issues/1386)). The price above says what a round trip
  cost *typically*; only this says whether the run was slow everywhere or slow once, and the two need
  opposite fixes. On run #1379 the mean was 8.13 s against a median of 3.8 s and a **maximum of 189 s**
  — one stretch, 12% of the run, invisible in the mean. **Read `max` and `p90` before proposing a
  batching change**: a run whose spread is flat is one batching can help, and a run whose spread is one
  long think is not — `longest` names the phase each stretch was spent in, so the row says where to
  look. Withheld on the same two criteria as the price beside it — `not measured` where no span was
  read, `no tool call to divide` where nothing was called
- **how much of the round-trip count was avoidable** — `bundles`, and `recoverable_round_trips` inside
  it ([#1344](https://github.com/joshuafolkken/kit/issues/1344)). The density says calls went out one
  per turn; only this says how many of them **could have gone out together**, read from the run rather
  than assumed from the floor. **Rank a batching proposal on this, never on the floor arithmetic**:
  on the run this was built from, bundling every call to 1.50 implied 33 round trips and the measured
  figure was 25. Multiply it by `model_ms_per_round_trip`, which is what the block's third row already
  prints. **`by_tool` inside it names whose turns those trips were**
  ([#1607](https://github.com/joshuafolkken/kit/issues/1607)): one row per tool, carrying how many of
  the recoverable trips were its and how many separate sequences to go and look at — so **the tool a
  batching proposal names is read off this block rather than reconstructed from the transcript by
  hand**, which is what it cost before the breakdown existed. **An `Agent` row is the spread-apart
  launch series** ([#1854](https://github.com/joshuafolkken/kit/issues/1854)): independent subagent
  launches that went out one per turn when they could have fanned out in one, kept out of the
  consecutive series because a launch is never bundleable and its turns sit minutes apart rather than
  adjacent. Read it as the other rows are — its `sequence_count` is how many separate fan-outs to look
  at and its trips are what issuing them together would have saved — and the launches that referenced a
  prior finding or sat behind an intervening write are already dropped from it, so it names only the
  ones that genuinely could have been one turn. The `recoverable by tool` row prints the
  reconciliation — `13 of 13 attributed` — and **it balances on every real run**, because only a
  bundleable call enters a sequence and every one of those carries a label. **So a shortfall is a
  defect in the report, not a bucket of unlabelled calls**: report it rather than ranking off the
  table beneath it. `is_measured: false` withholds it on the
  same criterion the shares are withheld on — **the breakdown included, which is why an empty
  `by_tool` is never read as "nothing to batch"** — and
  `recoverable_round_trips: 0` on a measured run is a real answer — a run that batched everything
  had nothing to recover, which is not the same as a run nobody could read.
- **the idle spent waiting on a delegated unit — `delegated_wait`, read like the `CI cycles` block**
  ([#1881](https://github.com/joshuafolkken/kit/issues/1881)). `resolve_delegated` folds a delegation's
  wait into the model share, so the `categories` model wait counts it and nothing else separates a run
  that sat idle behind a subagent from one that overlapped it. Each row is one delegation window with
  its `naked` part — the wall clock the main line spent with nothing else running and only one unit in
  flight, which a second lane would remove — and its counterpart named the way a cycle's is: `behind
  <phase>` for concurrent main-line work, and `parallel` for the wall clock two or more units ran at
  once, a fan-out that was never a serial wait. **Rank a "parallelize this delegation" proposal on the
  naked figure, not on the window's length** — a window that ran wholly `behind` other work or as a
  `parallel` launch is already overlapped and saves nothing, exactly as a CI cycle hidden behind the
  review does. **`not measured` is not zero, and the block is withheld entirely for a run that never
  delegated**: an unread unit transcript has an unknown window rather than an empty one, so a
  `naked 0.0 s` row is a measured overlap while a withheld block is a run with no subagents at all.
- **the work that was thrown away, and how much change the run bought** — `rework`
  ([#1387](https://github.com/joshuafolkken/kit/issues/1387)). Two readings out of one field. `files`
  names every path the run's `Edit` / `Write` calls touched with its edit count, and `presence` says
  whether it reached the merged diff — a row reading `scripts/verification-gate.ts — 2 · never reached
  the merged diff` is a mid-implementation change of approach, which no other block here can see, and a
  high `edit_count` on a file that *did* land is the same signal at lower confidence. `size` is the
  merged diff's `changed_file_count` / `additions` / `deletions`, and **without it a run's minutes
  cannot be compared with another run's at all**: 27 minutes on a 254-line change and 27 on a 4-line one
  are the same number and not the same run, which is why step 2 quotes it beside the phase it compares.
  Three withheld states, and none is a zero: `is_measured: false` is a transcript nobody read;
  `state: "refused"` is a merged diff nobody could read — there every row's `presence` is `unknown` and
  `dropped_count` stays 0 because nothing was reconciled, never because nothing was dropped; and
  `state: "absent"` is a scope that never had a pull request, where the block is not printed at all.
  `outside_file_count` is edits made outside the work tree — a scratchpad script — counted apart rather
  than reported as work thrown away, so **read it as its own signal and never add it to
  `dropped_count`**. **The reconciliation under-reports a file rewritten only through the shell**,
  since `sed -i` is not an `Edit` call; it over-reports nothing
- **the per-tool and per-`josh <cmd>` totals** — where a single command is the cost. **Rank a tool by
  its round trips as well as its duration**: a tool called thirty times one call per turn costs thirty
  round trips at the price above, which is routinely larger than the seconds the calls themselves ran
  for — the reading that was missed before the price was reported. Since
  [#1385](https://github.com/joshuafolkken/kit/issues/1385) each `by_tool` row carries that reading
  rather than leaving it to be inferred: `round_trip_count` beside `call_count`, and
  `alone_in_turn_count` for the calls that were the only one in their turn. **Name the tool to batch,
  never the density.** A row reading `Edit — 39 call(s) · 39 round trip(s) · 39 alone` is the
  candidate; "the density is 1.07" is not one, and a proposal written from the density alone is what
  three consecutive runs failed to move. Multiply that row's alone count by
  `model_ms_per_round_trip` to rank it, and check it against `recoverable_round_trips` — the bundling
  block says how many of those turns could actually have been one.
  **Name the tool from `bundles.by_tool`, and use this table as the check on it**
  ([#1607](https://github.com/joshuafolkken/kit/issues/1607)): `alone_in_turn_count` counts calls that
  were alone in their turn, which includes every one that had nothing it could have gone out beside,
  while the bundling breakdown counts only the turns that could actually have been one — so the two
  disagree by design, and it is the smaller of them a proposal is sized on. `by_josh_command` carries neither
  count on purpose: a `josh` subcommand is a `Bash` call under another name, so its round trips are
  already the `Bash` row's. These are two of the four tables `--top`
  caps, so read the `notes` line beside them before saying a command is absent from the run

## 2. Say whether the last speedup actually worked

Re-measure the earlier run with `pnpm josh time --issue <M> --json` and compare it against step 1 on
the phase the speedup issue named. State the verdict in one line — worked, did not, or cannot tell —
with both figures beside it.

- **Compare the same phase, not the totals.** Human wait swamps everything and moves for reasons no
  change controls, so a run that got slower overall can still carry a phase that halved.
- **One run is not a sample, and there is a call that says so with figures**
  ([#1312](https://github.com/joshuafolkken/kit/issues/1312)). `pnpm josh time --last <N> --top 5 --json`
  reports the last N merged runs as a min/median/max per phase and per CI check, with the **sample
  count** on every row — so "the effect is smaller than the spread" and "there were not enough
  readings to tell" become two different sentences instead of one shrug. Take it before writing a
  verdict that rests on two runs; where two runs still disagree, say so rather than picking the one
  that supports the change.
- **The runs nobody measured are recorded anyway, in `.time-history.jsonl`**
  ([#1471](https://github.com/joshuafolkken/kit/issues/1471)). Every merged run appends one line —
  issue, timestamp, elapsed, turns, tool calls, round trips and the two per-round-trip costs — from
  `josh followup`, so the sample accumulates whether or not anyone typed `diag`. **It is a headline
  record, not a report**: it carries no phase table, so a verdict about a phase still comes from
  `pnpm josh time --issue <M> --json` above. What it is for is the question that used to have no
  answer at all — which runs happened, and roughly where each one sat — for a run whose report was
  never taken. The file is gitignored, so a fresh checkout legitimately has none and its absence is
  not a measurement.
- **The backlog over a period is read from those records, with
  `pnpm josh time --period <N> --top 5 --json`**
  ([#1470](https://github.com/joshuafolkken/kit/issues/1470)) — the row the table above adds. It
  answers what no single run's internals can: **issues finished per day**, **per-lane busy and idle
  time** against the effective throughput, **the stretches the work serialized on** each named by the
  run that held the only busy lane, and **the wall clock another run was hiding** told apart from the
  wall clock that was exposed with nothing else running. **Lanes are derived from the wall clock**,
  since no lane field exists to read, so with nothing overlapping the honest answer is one lane and
  the report says so in its notes. Reach for it when the verdict is about the backlog rather than
  about a phase; a verdict about a phase still comes from `--issue` above.
- **"Cannot tell" is an answer.** A phase that is `not detected` in either run, or a run with no
  merge read, cannot support a verdict, and reporting one anyway is how a speedup that did nothing
  keeps its reputation.

## 3. One ranked list — already-filed issues stay in it

**Open the report with the three windows, then emit one table**
([#1409](https://github.com/joshuafolkken/kit/issues/1409)). The header is the three lines step 1
read — the run body, the pull request's open→merged, the issue's opened→closed — each with its
length, or `not measured` where that window was not read. It goes above the table because it is what
the table's numbers are lengths *of*: without it a reader cannot tell whether a five-minute saving is
a quarter of the run or a fiftieth of the issue's life, and the two argue for very different work.

Emit **one** table, ordered by the time each item would save per run, largest first. Estimate that
saving from step 1's figures, not from how easy the work looks. **Every row names the window it acts
on** — run body, pull request, or issue — because a saving is always a saving of one of the three, and
rows against different windows do not add up. A row whose proposal reaches more than one names the
innermost it actually cuts.

**A batching row names the tool, never the density**
([#1607](https://github.com/joshuafolkken/kit/issues/1607)). Take it from step 1's
`bundles.by_tool` — the heaviest row is the proposal, and its `sequence_count` says how many separate
places in the run to go and look at — and size the saving from that row's own
`recoverable_round_trips` times `model_ms_per_round_trip`, never from the whole block's total, which
belongs to every tool at once. **An `Agent` row proposes a fan-out rather than a tool batch**
([#1854](https://github.com/joshuafolkken/kit/issues/1854)): the independent subagent launches it
names went out one per turn and could have been issued together, so the row's action is "launch these
in one turn", and its saving is sized from its own `recoverable_round_trips` exactly as any other row's
is. **"The density is 1.39, so batch harder" is not a row**: nothing in it
says what to change, and it is what three consecutive runs failed to move. Where the breakdown is
withheld (`is_measured: false`), say so and rank the row on the evidence that is left rather than
reporting a tool the block did not name. A `recoverable by tool` row that does not balance is a defect
in the report itself — say so and do not rank off the table beneath it.

**Every row carries both units — minutes per run and dollars per run — and names which one it acts on** ([#1609](https://github.com/joshuafolkken/kit/issues/1609)). A table ordered by minutes alone has no column a cost row could appear in, which is why the 2026-09-09 report emitted no cost row at all. **The two do not follow from one another and are never converted between**: cutting a CI wait saves wall clock and no money whatever, because nothing is billed while a check runs, and cutting what every request carries in its prompt saves money on all of them while moving the wall clock by an amount no run can resolve. So a row states its saving in the unit it acts on and `—` in the other, and a row that genuinely acts on both states two figures.

**Order by whichever unit the report was asked for, and say which at the head of the table.** "Why is `fullrun` slow" orders by minutes; "what is the backlog costing" orders by dollars. Neither ordering hides the other column, so a row that ranks second on the chosen axis is still visible on the one it wins.

**A row against one stage takes its dollars from that stage's own `phase_costs` row, not from the run total** ([#1606](https://github.com/joshuafolkken/kit/issues/1606)). A proposal that cuts work out of `review` is worth what `review` cost, exactly as it is ranked on what `review` took in minutes; taking a share of `cost_usd` instead re-imports the error the next paragraph names. **A stage carrying no row was not free** — it had no billed request of its own inside it — and a scope whose `phase_costs.is_measured` is `false` was never priced at all, so both take `not measured` rather than a zero. **The unattributed bucket is never spread across the rows to make them add up**: it is quoted as its own figure where it is large enough to matter, and no row is ranked off it.

**A proposal to stop delegating a step is ranked on `delegated_cost`, not on wall clock** ([#1882](https://github.com/joshuafolkken/kit/issues/1882)). The launch's fixed cost is `per_unit_cost_usd` in dollars, and a step whose own work is cheaper than that saves money by staying in the main line — so the row states its saving in dollars with `—` in the minutes column, since folding one subagent back moves the wall clock by an amount no run can resolve. Where `delegated_cost.is_measured` is `false` the block was not read for this scope, so say so rather than ranking off a zero.

**Estimate the dollar saving from step 1's per-request figures, never as a share of `cost_usd`.** Dollars per request multiplied by the requests a change removes is a saving; a percentage of the total is not, because the total covers work the change leaves exactly where it is — the same error as ranking a phase off a run's `elapsed_ms`. A change that removes carried tokens rather than requests is ranked on the resident and history shares instead, which is the arithmetic the round-trip price above already does for minutes. **Where `missing` was non-zero, a row that has a dollar saving still prints one and is never blanked.** Withholding it there would be the wrong reading of the same rule: on an `--issue` scope those counters are the whole corpus's, so a single malformed line in any unrelated session would empty the dollar column of every row and reproduce exactly the missing cost row this reading was added to end. **Label such a figure approximate rather than as a bound.** The run total `cost_usd` is a floor because it can only fall short of the true figure, but the dollars per request derived from it is an average over the priced subset alone and can sit either side of the true one — so a `≥` on a per-row saving claims more than the arithmetic gives. `not measured` is kept for the case that earns it, a scope with no priced record at all, and **a row that saves no money keeps the `—` the rule above gives it** — none of this reaches a cell that was empty by design.

**Do not drop an item because it is already filed.** Avoiding duplicates means not filing a second
issue for the same work; it does not mean leaving the work out of the ranking. **A filed but
un-started issue is usually the highest-priority action in the table** — it needs no filing at all,
only a run — and a table that hides it reports the backlog as emptier than it is and re-proposes the
same work a week later.

**A phase whose earlier measurement is recorded is ranked against that record, not from the tables
alone** ([#1305](https://github.com/joshuafolkken/kit/issues/1305)). A large phase invites a proposal
every time it is measured, and a `diag` reads this run's tables rather than the record of what an
earlier one concluded — so the same measure gets re-filed against a phase that has already been
measured and found not to move. **`review` is the phase that has such a record**, and it is
`prompts/review.md` → "The narrowing is real in scope and does not show in the wall clock", the
single source for what was measured and how strongly. **The record is three sibling sections, and
reading only the first one misses most of it**
([#1418](https://github.com/joshuafolkken/kit/issues/1418),
[#1436](https://github.com/joshuafolkken/kit/issues/1436)): "The re-derivation round 2 does is real,
and it is not what round 2 costs" follows it, measures the forked review agent's own transcript
rather than the phase, and is where a proposal to hand round 1's reading to round 2 is already
answered — which is the proposal a `diag` re-derives, since two review transcripts visibly open the
same files. **The third is where the first one's round-1 coefficient was re-measured and overturned**:
"Round 1's cost does track the change size, and splitting is still not how to cut it" re-fitted round
1 against the diff at a larger sample, and it is the current single source for that reading — so a
`diag` that quotes the first section's coefficient as the live one is quoting a retired number. **It
also decides two proposals a `diag` re-derives from the `review` row every time**: moving the split
assessment's threshold, and narrowing what round 1 is given. **Read all three before ranking
`review`, and quote no figure from any of them that you have not read there** — the numbers live in
those three sections alone, so a copy here is one that goes stale silently. **A proposal it already covers is not forbidden: it is required
to say why the recorded data does not reach it**, which is a different bar from being refused. **The
row still appears in the table either way** — a phase measured as immovable is reported as such,
which is the distinction this note exists to keep.

**The `review` phase is not the only recorded reading, and the second one is not about a phase at all**
([#1382](https://github.com/joshuafolkken/kit/issues/1382)). Step 1's round-2 disposition row prices the
extra commit and the CI cycle a fix-in-place buys, and `prompts/review.md` → "What a round-2 fix-in-place
costs, and how often it is paid" records what that came to across a set of runs, how often the detector
found it, and why the status quo was kept over cutting the cycle. **A proposal to cut that cycle is
ranked against that record on exactly the terms above** — the row still appears in the table, and it is
required to say why the recorded distribution does not reach it. **It is not folded into the two sibling
sections**, because it reads the `ci`, `pr` and `merge` stretches rather than the `review` phase: a
reader who follows the pointer above alone never arrives at it, which is the miss this paragraph exists
to prevent.

**Enumerate the backlog before ranking it — never from memory.** The rule above says an un-started
issue usually ranks highest and said nothing about how to find one, so the candidate set came from
whatever that session happened to remember: the 2026-09-04 run left #1226, #1170, #1095 and #1102 out
of its table, and a report written by hand from the same run carried all four
(joshuafolkken/kit#1308). One listing, run every time, is what makes two `diag` reports comparable at
all.

```bash
gh api --paginate "repos/{owner}/{repo}/issues?state=open&per_page=100" \
  --jq '.[] | select(.pull_request | not) | "\(.number)\t\(.title)"'
```

- **It lists every open issue, and that breadth is the point.** `select(.pull_request | not)` drops
  the pull requests the REST issues endpoint returns beside them, and nothing else is filtered here.
  `--paginate` reads to the end on purpose — a listing that stopped early is the miss this step
  exists to prevent — at one request per hundred rows, which that endpoint counts issues and open
  pull requests together for. It is `gh api` rather than `gh issue list` because that one goes
  through GraphQL, which a cloud session is refused — the same reason `pnpm josh issue:state` exists.
- **It is the one GitHub call this skill makes by hand, and that is deliberate.** No `josh` command
  enumerates a whole backlog: `issue:state` reads issues you already have the numbers for, and the
  prohibition printed beside it is about deciding `OPEN` / `in-progress` by eye rather than about
  listing. kit's own code does not repeat the call either — `scripts/git/git-gh-issue-list.ts`
  single-sources this same endpoint for its callers, so a command that one day replaces the line
  above is built on that helper rather than as a second copy of it.
- **An epic's child is an ordinary issue and appears on its own row.** #1170 sat inside epic #1153
  and is in this listing exactly as an unattached issue is, so there is no second enumeration to run
  for the children. **An epic is an issue too** — #1095 and #1102 are rows of their own; rank an epic
  where its children are the work, and never drop a row for being one. The one thing the listing does
  not reach is a child in **another** repository, written `owner/repo#N` in an epic body.
- **A foreign repository is named in the path, never by a flag.** `gh api` takes none, so the call
  becomes `repos/<owner>/<name>/issues?state=open&per_page=100`. Its rows then need a state call of
  their own: `pnpm josh issue:state <N> --repo <owner/repo>` applies that repository to **every**
  number in the call, so a foreign row batched in with this repository's is answered for whichever
  issue happens to carry the same number there.
- **It enumerates; it does not read state.** The listing says which issues exist, and
  `pnpm josh issue:state` below says what state each one is in — never classify a row from the number
  and title this prints.
- **Narrow by reading the titles, then say what you narrowed to.** Report how many open issues the
  listing returned and which numbers you carried into the table. That one line is what lets a later
  reader re-run the command above and see whether a row was missed — the check this step exists to
  make possible.

| State | What the row prints |
| --- | --- |
| Un-filed | The proposal, and the estimated saving. Go to step 4 |
| Filed, not started | `#N`, and **the command to run next** — `fullrun #N`, or `epicrun #E` for the epic that tracks it. Never a second filing |
| In progress | `#N` and that it is in progress. Do not propose running it again |
| Done | The verdict from step 2 — whether it worked, with both figures |

**Read the state from `pnpm josh issue:state <N> [<N> ...]`, never by parsing `gh` output yourself —
and pass the whole table's numbers in one call.** One call per row costs a process start and a round
trip each, about 1.6 seconds a row, so a five-row table spent about eight seconds on nothing but its
states; one call reads them all at once (joshuafolkken/kit#1302).

**Pass the numbers the enumeration above kept**, plus any issue step 2 re-measured — that one has
shipped, so a `state=open` listing never carries it and the `Done` row would go unfilled. A row whose
state was never read cannot be placed in the table above at all.

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
#
# issue: 1176
# state: OPEN
# labels: route:split
# human_review: no
```

**Attribute each block by its `issue:` line, never by position.** A number that produced no state
prints no block, so counting blocks off against the numbers you passed misreads every row after the
gap. A single number is unchanged — the three lines below, with no `issue:` heading — which is the
form `.claude/skills/workflow-commands/SKILL.md` §2z reads.

**Pass bare numbers, not the `#N` the table prints.** A token carrying the `#` refuses the whole
call with the usage line rather than being dropped from it — which is the answer you want, since a
dropped number would leave the report shorter than the table with nothing saying so.

It is the command because `gh issue view --json state` goes through GraphQL, which a cloud session
is refused, and because the `OPEN` / `CLOSED` casing rule then lives in one place rather than in
prose. Map its output to the table above: `CLOSED` is **done**; `OPEN` carrying `in-progress` is
**in progress**; `OPEN` without it is **filed, not started**. A number that `does not resolve`, or a
read that answers `could not read`, is reported as unknown — both name the number they are about, so
a mixed call still says which row it could not answer for, and `could not read` is a failed read,
never "the issue is open".

**Matching `in-progress` is yours to do, and the `labels:` line is compared case-insensitively —
lowercase that one line before matching, and leave the `state:` line's casing alone.** Only
`human_review:` arrives already decided that way; `labels:` prints the spelling each label was
created with, and GitHub treats `In-Progress` as the same label as `in-progress`. A match against
the lowercase string alone reports an in-progress issue as un-started, and the table then tells
someone to start a run that is already going — the failure this whole step exists to prevent.

Which epic to name for a filed row comes from `pnpm josh epic:bundle <N>`, which names the epic that
already tracks it rather than only reporting that one exists. **Read
`.claude/skills/epic-commands/SKILL.md` before running that or any other `epic:*` command**, as
`CLAUDE.md` requires — this skill routes to it rather than restating it.

## 4. File only through `pnpm josh issue:scout`

An un-filed row is filed only after the scout has answered:

```bash
pnpm josh issue:scout "<title>" --body "<one line, citing the issue this follows from>"
```

- **`Duplicates:` is read, not skimmed.** Open each candidate. One that covers the same work turns
  the row from un-filed into filed — move it to that state in the table, with the command to run —
  and **do not file**.
- **Pass `--body`.** The epic half decides from the issue numbers the summary names, so a title-only
  call answers `Epic: not asked`, which is not `Epic: none`.
- **`Epic:` is the placement**, and `add_to_epic` / `create_epic` are Tier A: execute them with
  `pnpm josh epic --add` / `pnpm josh epic`, never by hand-editing an epic body. `ask` is Tier A too —
  choose the epic you recommend and record why.
- Filing is Tier A only for a first-party target — an owner equal to this repository's. A
  third-party tracker is Tier C and is not written to here (`CLAUDE.md` → "Third-party repositories
  are Tier C").
- Run `pnpm josh epic:bundle <new>` on each issue filed, so it is one `epic:next` will offer rather
  than one parked forever.

## What `diag` does not do

- It does not implement anything, and it opens no pull request.
- It does not run `fullrun` / `epicrun` on what it ranks. It prints the command; the person types it.
- It does not measure anything itself. **Every figure in its report came out of one of four
  commands**, and none is re-derived here. The wall clock is `pnpm josh time`'s and the dollars are
  `pnpm josh cost`'s — two readings of the same recorded sessions, which is why they can be quoted
  side by side. The two things no transcript records came out of the two commands built for them:
  which check runs in more than one verification layer, from `pnpm josh layers`, which reads the
  configuration files and measures no seconds either; and what a check costs cold against warm, from
  `pnpm josh bench`, which is the one source here that re-runs a command instead of reading a record
  of one.
