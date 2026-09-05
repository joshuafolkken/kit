---
name: diag
description: The procedure behind `diag fullrun` / `diag epicrun` / `diag #<N>` (and `/diag`) — measure where a run's wall clock actually went with `pnpm josh time`, say whether the last speedup issue worked, and rank what to cut next as one table that keeps the already-filed issues in it. Read this whenever asked how long a run took, why `fullrun` is slow, what to do to make it faster, or to check whether a speedup landed.
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

## 1. Measure with `pnpm josh time`, never by hand

```bash
pnpm josh time --top 5 --json               # alias: josh tm
pnpm josh time --issue <N> --top 5 --json
pnpm josh time --epic <E> --top 5 --json
pnpm josh time --last <N> --top 5 --json    # the spread across the last N merged runs
```

**One reading is not `josh time`'s, and asking it for one is how the repetition stays invisible** ([#1313](https://github.com/joshuafolkken/kit/issues/1313)). Which checks run in more than one verification layer — `josh gate`, the pre-commit hook, the pre-push hook, CI — cannot be read from a session transcript at all: a hook's seconds are buried inside `josh git`'s, and CI's appear only as a per-check duration with nothing to compare them against. Run `pnpm josh layers` (alias `josh ly`) when a candidate is about removing work rather than about overlapping it; it reads the configuration files and re-derives the answer, so it stays true when a hook changes. It measures no seconds, so a row it produces is ranked below in step 3 on what the repeated check costs in `josh time`'s own tables.

**A second reading is not `josh time`'s either: whether a slow check was slow or merely cold** ([#1314](https://github.com/joshuafolkken/kit/issues/1314)). A transcript records one run of a command in whatever cache state that run happened to be in, so a 133-second `josh gate` in the tables says nothing about whether the next one costs 133 seconds or 17. Run `pnpm josh bench <target>` (alias `josh bn`) before proposing a saving on a verification command: it clears that target's own caches, runs it, runs it again, and prints the pair — `eslint --cache` measured 128.4 s cold against 2.9 s warm. **Rank the candidate on the figure the run will actually pay.** A row whose cold reading dominates is a cache problem, not a check to remove, and a proposal to delete a check because the transcript happened to catch it cold is the mistake this reading exists to prevent. It runs real commands and costs real minutes, so ask it about the one or two rows in question rather than the default set.

**`--top 5` is part of the call, not a nicety** ([#1301](https://github.com/joshuafolkken/kit/issues/1301)). Without it the JSON carries every row of the per-tool and per-`josh <cmd>` tables, and an epic pays for both once per child — epic #1262 measured 47.7 KB at 9 children and had more than doubled by 18. What this skill ranks off those tables is the handful of rows at the top, so the tail is read into the context and never used. Everything else the steps below quote — the four shares, every phase, the round trips and their price — is unaffected: the cap reaches the **row tables** and nothing else.

**Four tables are capped, not two** ([#1311](https://github.com/joshuafolkken/kit/issues/1311)): `by_tool` and `by_josh_command`, plus `segments` — the run read as timed stretches — and `by_invocation`, each call of a command that ran more than once. **`segments` is the one whose cut is not a tail.** The table is in run order, so the cap keeps the **longest** five stretches and puts them back in that order rather than keeping the first five and losing the merge; five rows are therefore a sample of the run and never its shape. **Read a segment listing as evidence about the stretches it names, never about the ones between them** — and where the shape of the run is itself the question, drop the flag and say that you did, exactly as for a thin per-tool tail.

- **A cut table says so, and that note is not a zero.** The report's `notes` carry `by_tool: showing the top 5 of 34 rows — 29 withheld by --top`, which is the same distinction between *withheld* and *measured as nothing* that `span_count: 0` and `not detected` make elsewhere here. **Never read a capped table as the whole of what ran.**
- **Drop the flag when the tail is the question.** A run whose cost is spread thin across many commands rather than concentrated in a few is exactly the case five rows cannot show; re-run the same call without `--top` and say that you did.

**Never write a script to read the transcripts, and never restore the timings by eye.** That is what
the command replaced, and a second reader is a second classification — the one thing a measurement
meant to compare two runs must not have. If the command cannot answer, report what it printed and
stop; it says which of `--issue` / `--session` picks a scope, and it exits non-zero rather than
printing a table of zeroes.

Read from the JSON, in this order:

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
- **`is_detected` per phase** — a phase that never appeared prints `not detected`, and that is not a
  measured zero. Never rank a phase you did not measure. `wait`, `wait-outside` and `other` rest on
  no marker, so they are `false` only where no span was read — the same state the three transcript
  shares are withheld in.
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
  issued from. **The price is not a share of `elapsed_ms`** — human wait, CI wait and the turns that
  called nothing are all outside it, so the product can be ranked beside the `wait` and `ci` rows
  without counting the same minutes twice. It is withheld rather than zeroed where there was no round
  trip to divide by
- **how much of the round-trip count was avoidable** — `bundles`, and `recoverable_round_trips` inside
  it ([#1344](https://github.com/joshuafolkken/kit/issues/1344)). The density says calls went out one
  per turn; only this says how many of them **could have gone out together**, read from the run rather
  than assumed from the floor. **Rank a batching proposal on this, never on the floor arithmetic**:
  on the run this was built from, bundling every call to 1.50 implied 33 round trips and the measured
  figure was 25. Multiply it by `model_ms_per_round_trip`, which is what the block's third row already
  prints. `is_measured: false` withholds it on the same criterion the shares are withheld on, and
  `recoverable_round_trips: 0` on a measured run is a real answer — a run that batched everything
  had nothing to recover, which is not the same as a run nobody could read.
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
  block says how many of those turns could actually have been one. `by_josh_command` carries neither
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
- **"Cannot tell" is an answer.** A phase that is `not detected` in either run, or a run with no
  merge read, cannot support a verdict, and reporting one anyway is how a speedup that did nothing
  keeps its reputation.

## 3. One ranked list — already-filed issues stay in it

Emit **one** table, ordered by the time each item would save per run, largest first. Estimate that
saving from step 1's figures, not from how easy the work looks.

**Do not drop an item because it is already filed.** Avoiding duplicates means not filing a second
issue for the same work; it does not mean leaving the work out of the ranking. **A filed but
un-started issue is usually the highest-priority action in the table** — it needs no filing at all,
only a run — and a table that hides it reports the backlog as emptier than it is and re-proposes the
same work a week later.

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
- It does not measure anything itself. Every figure in its report came out of `pnpm josh time`, and
  the two things no transcript records came out of the two commands built for them: which check runs
  in more than one verification layer, from `pnpm josh layers`, which reads the configuration files
  and measures no seconds either; and what a check costs cold against warm, from `pnpm josh bench`,
  which is the one source here that re-runs a command instead of reading a record of one.
