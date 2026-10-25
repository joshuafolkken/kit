# Measuring the lane limit

For kit maintainers tuning `JOSH_LANE_LIMIT`; projects that use kit can skip this page.

How many lanes one machine runs well is a measurement, not a guess
([#3347](https://github.com/joshuafolkken/kit/issues/3347)). Each candidate limit is run for a period
of real `backlogrun` work and recorded as one row of the same table, so the limits compare on
throughput, gate duration and machine load side by side.

## Where the numbers come from

One append-only ledger per repository, `josh-lane-ledger-<digest>.jsonl` in `<common git dir>/josh/run-state/`, keyed
on the common git directory so every lane, the parent and the sampler write to the same file.

| Entry       | Written by                                                    | Fields                                                               |
| ----------- | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| `merge`     | `josh run:merge`, when a child merged                         | `at`, `issue`                                                        |
| `gate`      | `josh gate`, when it finishes (passed or failed)              | `at`, `elapsed_ms`, `is_passed`, `unit_ms?`                          |
| `load`      | `josh backlog:drive` while it runs, and `josh lane:sample`    | `at`, `load`, `available_mb?`, `swapped_mb?`, `lanes?`, `processes?` |
| `dispatch`  | `josh lane:dispatch`, when a child started                    | `at`, `issue`                                                        |
| `stage`     | `josh ship`, as each stage ends; `josh followup` for the wait | `at`, `stage`, `elapsed_ms`, `issue?`                                |
| `stop`      | `josh ship`, when it stops at a stage or on a conflict        | `at`, `issue`, `reason`                                              |
| `core-wait` | a command a held core-budget claim admitted after a wait      | `at`, `command`, `waited_ms`, `issue?`                               |

A `stage` entry's `at` is when the stage ended, so it began `elapsed_ms` earlier. `josh followup`
writes one of its own, `ci-wait` — the time it spent waiting for the checks — and, when its polls saw
CodeRabbit still running or rate-limited, `coderabbit-wait` and `coderabbit-rate-limit`; these carry no
`issue`.

`unit_ms` is the unit suite's own duration, present when the gate ran it; `josh metrics` reads the
gate and unit durations it holds to a baseline from these entries.

**A `load` sample's memory is the reading the gate admits against** (`machine_capacity`):
`available_mb` is the memory still available — on macOS the kernel's `kern.memorystatus_level`, not
Node's free-memory figure, which reads near zero with gigabytes to spare — and `swapped_mb` is a
counter, every page swapped in or out since boot. Rows measured before
[#3593](https://github.com/joshuafolkken/kit/issues/3593) recorded Node's figure as `free_mb` and swap
in use as `swap_mb`; both fields were renamed with their meaning, so `lane:stats` reads those rows for
their load and lanes only and their memory never mixes into a later period's columns.

Recording is best-effort: a ledger that cannot be written never fails the gate or the merge it
measures. Test suites never write to it.

## Running one period

1. Set the candidate limit in `.env`: `JOSH_LANE_LIMIT=<n>`.
2. Run `backlogrun` as usual for the period — several days, or enough merges for the rate to settle.
3. Close the period with `pnpm josh lane:stats --period <days> --limit <n>` and paste the first table's
   row into #3347's table.

**Nobody starts a sampler.** `josh backlog:drive` takes a `load` sample every minute for as long as it
runs and stops with it, so a period holds the load of the runs themselves. `pnpm josh lane:sample` is
still there for a reading outside a run.

## The columns

| Column                          | Source                                                           |
| ------------------------------- | ---------------------------------------------------------------- |
| `JOSH_LANE_LIMIT`               | `--limit`, else the limit `lane:stats` reads                     |
| `period (days)`                 | `--period`                                                       |
| `merges`                        | `merge` entries in the period                                    |
| `merges / hour`                 | merges per active hour — time `load` samples saw a lane working  |
| `effective lanes`               | mean of the working `load` samples' `lanes` (child running)      |
| `lane median (min)`             | median per merge of the time since its issue's latest `dispatch` |
| `lanes over 40 min`             | merges whose lane time is over the overrun threshold             |
| `lane p90 (min)`                | nearest-rank 90th percentile of the same lane times              |
| `gate median (min)` / `max`     | `gate` entries' `elapsed_ms`                                     |
| `load peak` / `mean`            | `load` samples' one-minute load average                          |
| `swapped peak` / `mean (GB/h)`  | the `swapped_mb` difference between consecutive `load` samples   |
| `free memory min` / `mean (GB)` | `load` samples' `available_mb`                                   |
| `load samples`                  | how many `load` samples the period holds                         |

**A column with no samples prints `—`, never `0`** — a period no `backlogrun` ran in has no load,
which is not an idle machine. **The swap columns need two samples between half a minute and an hour apart** — a
longer gap is a stopped sampler, and a shorter one is a drive that restarted seconds after its last
sample, whose burst is not an hour's rate; neither yields one, so a period can hold samples and still
print `—` there. **Throughput is per active hour** — the time from each `load`
sample whose `lanes` is above zero to the next sample (gaps over an hour excluded) — so the nights
between runs in a several-day period do not dilute the rate, even with the sampler left running through
them; only a period with no such sample falls back to the gaps of up to an hour between `merge` and
`gate` entries. **The means (`effective lanes`, load, swap, free memory) take only those working
samples**; peaks and minima take every sample. **An open lane is not an effective lane**: a lane a park
kept, or a stranded one, has no child running and adds no load.

## Where a lane's time goes

Under the lane-limit row, `lane:stats` prints a second table: one row per stage of a lane, in the
order a lane passes them, each with its median, its maximum and how many runs the period holds.

| Row                           | Source                                                                      | Read for                                                          |
| ----------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `implement`                   | a `dispatch` entry to the start of the same issue's first `stage` after it  | how much of a lane neither decision below can move                |
| `review`                      | `stage` entries of `josh ship`'s round-one review                           | whether to overlap the round-one review with CI                   |
| `ci-wait`                     | `stage` entries `josh followup` writes for its wait on the checks           | whether to overlap the round-one review with CI                   |
| `coderabbit-wait`             | `stage` entries `josh followup` writes for CodeRabbit's part of its waits   | whether CodeRabbit is what holds a followup up                    |
| `coderabbit-rate-limit`       | `stage` entries `josh followup` writes for the rate-limited part of that    | whether to file a remedy for CodeRabbit's rate limit              |
| `gate`                        | `stage` entries of `josh ship`'s gate                                       | whether to lower `JOSH_LANE_LIMIT`, beside the load columns       |
| `preflight`, `sync`, `commit` | `stage` entries of `josh ship`                                              | the rest of the time from dispatch to the pull request            |
| `pre-detach`                  | `stage` entries of a detached `josh ship`'s fast checks in the child's turn | the time the child's own turn spends checking before the hand-off |
| `round-2`                     | `stage` entries of `josh ship`'s round-two review                           | its `runs` against `review`'s: the overlap's clean rate           |
| `followup`, `report`          | `stage` entries of `josh ship`                                              | the rest of the time from the pull request to the merge           |

**A stage nothing recorded prints `not measured`, never `0`** — a period that ran no second review
round has no `round-2` duration, which is not a round that took no time. A stage that found nothing
to do — a round 2 that was not due, a round 1 already recorded, a gate that reused the green record
of its tree — writes no entry.

**`runs` counts entries, not lanes.** A ship relaunched after a fix runs its stages again, and a lane
child runs the preflight once itself before the supervisor does, so a stage can hold more runs than
the period has merges.

**`implement` is derived, not recorded.** It runs from a child's dispatch to the start of the first
ship stage of the same issue; a child dispatched again before it shipped contributes nothing, so the
replacement's ship is not counted against it.

**`ci-wait` is inside `followup`**, not beside it: the two rows overlap, and `ci-wait` is the part of
`followup` that waited for the checks. Only a wait that ran to its end is recorded — one that was
interrupted leaves no entry.

**`coderabbit-wait` is the part of `followup`'s check waits CodeRabbit was still running or
rate-limited, and `coderabbit-rate-limit` the rate-limited part of it**
([#4574](https://github.com/joshuafolkken/kit/issues/4574)). CodeRabbit does not gate the merge, so
both overlap the check waits rather than add to them. Unlike `ci-wait`, they cover every check wait of
the run — the one the merge goes back to, and one that ended on a red check — so they are not bounded
by `ci-wait`.

Each interval between two polls counts as the state the earlier poll saw. A run whose polls never saw
CodeRabbit waiting writes neither, so `runs` counts the followups CodeRabbit overlapped.

**The two decisions the table is for.** Overlapping the round-one review with CI pays only when round
one finds nothing to fix: CI then runs once, on the head the review passed. When round one fixes
something, the CI run on the pre-review head is wasted and runs again on the fixed head. So overlap only
when the gain outweighs the loss:

- Gain: the clean rate × the shorter of `review`'s and `ci-wait`'s medians, the time the two would
  share — next to nothing when `review` is under a minute.
- Loss: the fix rate × the cost of one extra CI run — another CI concurrency slot and another
  CodeRabbit review against its rate limit, on top of the CI time itself.

The clean rate is approximated from the table's `runs`: 1 − `round-2`'s runs ÷ `review`'s runs. A
round 2 that was not due writes no entry, so the ratio counts the round-one reviews that led to a
second round. It is an approximation, biased both ways:

- Too high: a round 2 is skipped when every path round 1 fixed is inert — documentation, a prompt,
  or a comment-only edit. Such a fix still moves the head and wastes the CI run on the pre-review head,
  but adds no `round-2` entry.
- Too low: a round 2 runs with no fix when round 1 recorded no snapshot, or the base moved since
  and round 1's tree could not be carried onto it, and runs again when new work is pushed after it,
  while round 1 records once — one lane can add two `round-2` runs against one `review` run, and the
  ratio can fall below zero.

Read it as a direction, not a figure: a ratio far from the break-even point decides the question, one
near it does not.

A worked example, from the ledger in October 2026: 79 of the 97 round-one reviews from 2026-10-07 ran a
round 2, a clean rate of about 19% — four of five overlapped CI runs would be thrown away, for a saving
on one lane in five.

The too-high bias only strengthens that reading, and the too-low one would have to
account for most of the 79 runs to turn it, so the answer was not to overlap ([#3902](https://github.com/joshuafolkken/kit/issues/3902) was decided on this reading).

Lowering `JOSH_LANE_LIMIT` is worth it when `gate` grows with the effective lanes while the load peak is
above the core count.

## How long a stopped ship waits

Under the per-stage table, `lane:stats` prints a third: one row per reason a `josh ship` stopped —
each stage, plus `conflict` for a merge git could not finish, the reasons the retrospective counts —
with the median (`wait median (min)`), the maximum (`wait max (min)`) and the sum (`wait total (min)`)
of the wait from the stop to its end, how many waits ended (`runs`) and how many never did
(`not resumed`). The stage rows above time the work; this table times the time between the work,
which none of them holds.

**The wait is derived, not recorded.** Every stopped ship writes a `stop` entry naming its issue and its
reason; the wait runs from it to whichever comes first of the same issue's next `stage` entry (the
lane resumed), its next dispatch (a fresh lane took it over) and its `park` on the run's event stream
(the run gave up on it) — the time the stop held the issue.

**A stop none of the three followed is `not resumed`, never a wait.** A lane left stopped has no end to
its wait, so it is counted beside the row and kept out of the median, the maximum and the total. A
stop late in the period whose end falls after it reads as `not resumed` as well. The event stream
keeps about a week of a run's events, so a park older than that is gone and its stop reads as
`not resumed`.

The `causes` column counts each reason's stops by cause, most frequent first (`infra 2, check 1`):
`finding`, `conflict`, `infra` (a rate limit, missing checks, a network failure), `check`, `auth` (a
reviewer that could not authenticate) or `attest` (a refused review attestation).

Of the stages outside the review rounds, only `sync`, `commit`, `followup` and `report` can read as
`infra`. `josh ship` re-runs such a stage up to twice, a minute apart, before it stops
(`run-ship-infra-retry.ts`).

A `review` or `round-2` stop is counted under the cause of the step
that stopped it — `check` for a red scoped pair or join, `infra` for a reviewer that did not finish,
`attest` for a refused attestation — and is never re-run in place; only a stop on a recorded finding
is a `finding`. A stop recorded before causes existed reads as `unrecorded`.

A `preflight` stop is counted under each precondition it found unmet instead (`run-ship-preflight.ts`),
once under each when it found two:

- `issue`, `branch`, `classification`, `live-evidence`, `acceptance-map`, `lock`
- `scoped` — the scoped pair went red
- `unreadable` — a precondition could not be read
- `pre-detach` — not a precondition: a lane child's fast checks went red beside the refusal
  (`run-ship-cli.ts`), so a preflight stop's causes can outnumber its unmet preconditions

A preflight stop recorded before the preconditions were kept reads under its cause.

A `review` or `round-2` stop is counted under the `<category>:<severity>` of each blocking finding it
listed instead (`bug-risks:medium 3, tests:medium 1`), once under each kind — or, on a stop its
fixes decided (round-1 fixes red on the scoped pair, a round 2 that edited the tree), of each fixed
finding. A review stop that no finding decided — a red gate at the join, a reviewer that never answered — and one recorded before the
kinds were kept read under its cause.

**The decision the table is for**: which stop reason to remove next — the reason with the largest
`wait total (min)` costs the lanes the most time.

An `overlap` entry is the wait that targets the `conflict` row. Before its sync, a ship waits for every
lane whose open pull request changes a path its own change does (`run-ship-overlap.ts`).

The entry names the lanes, the shared paths, `waited_ms` and whether the wait cleared. Read it against
the `conflict` row of the same period.

## Why round 2 ran or was skipped

Under the stop table, `lane:stats` prints one row per round-2 verdict and reason code, most frequent
first, with how many decisions fell there. A period with no decision prints a `none` row.

`josh ship` reads `review:round2 --round-1-closed --json` and records the verdict and its `code` as a
`round-two` entry before acting on it. The codes are one per branch of `review-round2.ts`: `open-finding`,
`no-snapshot`, `base-moved`, `empty`, `inert` and `live`.

**The decision the table is for**: what to change next. A frequent `live` shows how often round 1's
fixes reach code that runs. A frequent `open-finding`, `no-snapshot` or `base-moved` means the procedure
is not giving the decision what it needs.

## Whether the split notice led to a split

Under the round-2 table, `lane:stats` prints one row: how many lanes got the split notice in the period
(`noticed lanes`), and how many of those filed a split child (`split`), whenever it was filed.

The first showing of the notice writes a `split-notice` entry with the Issue and the measured files and
lines (`split-early-notice.ts`); `josh issue:file --route split` from a lane writes a `split-filed`
entry (`split-resolution.ts`).

## Why a free lane stayed empty

Under the stop table, `lane:stats` prints one row per reason `backlog:drive` left a free lane empty. Each
row shows the total, median and maximum minutes, how many holds were recorded (`holds`), and how many
had no end (`not ended`). A period with no hold prints a `none` row.

The driver records the hold only while a lane is free. A pass that collects a child asks for the
next offer in that same pass, so a freed lane is offered at once. Two passes record a `held` entry:

- An offered pass that started nothing. The entry is `offer:<verdict>[:<answer>]`, for example
  `offer:wait:blocked`. A `stop` verdict is not a hold, because the run is finishing. A wait the
  `run:solo` gate caused names its cause in place of the answer, `offer:watch:solo`, so the lanes a
  solo run left empty show apart from every other `blocked` offer.
- A `blocked` offer whose issues wait on another issue or on a start condition (`実施可能日` /
  `実施可能条件`) names the cause: `offer:<verdict>:chain`, `:gate` or `:chain+gate`, and `waiting`
  lists those issues. Other waits stay `blocked` (`scripts/backlog/backlog-wait-cause.ts`).
- A driver end that hands control back to a session. The entry is `hand-back:<reason>`, for example
  `hand-back:merge` or `hand-back:window`. A finished run (`stop`, or the drain's `watch` or
  `retrospective`) is not a hold.

Every lane taken is the limit, not idle capacity, and a finished run owes no lane a child. Either one
records a `released` entry instead, once per hold. This ends a hold that a lane opened outside the
driver filled, such as an epic run or a person's `lane:open`.

The time is derived, not recorded. A hold runs until the next `held`, `released` or `dispatch` entry.
The driver offers once a minute while it waits, so consecutive entries cover the wait and the last one
ends at the dispatch or the release. A hold past an hour is a driver nobody restarted, and it reads as
ended at the hour.

**The decision the table is for**: what the `Stop` hook's stall report's "ready, free lane, no dispatch" time is
made of. `hand-back:*` rows are time spent waiting on a session, and `offer:*` rows are the backlog's
own answer. Compare the rows from one period to the next to show the idle time shrinking.

## How long a lane waited for the core budget

Under the hold table, `lane:stats` prints one row per lane whose commands waited for the core budget:
the total and median minutes and how many waits. A wait outside a lane is its own `outside a lane`
row; a period with no wait prints a `none` row.

A claim writes its `core-wait` entry once it is admitted, and only after a wait — one admitted on its
first read cost nothing. `issue` is the lane of the checkout the claim ran in.

The decision the table is for: how much of a lane's time is waiting rather than work. A wait inside
a ship stage is also inside that stage's duration; this table names the part the budget held back.

## What the load is made of

A `load` sample's `processes` is the machine's process list at that minute, grouped by the kind of
tool each command line runs — `vitest`, `eslint`, `tsc`, `cspell`, `prettier`, `playwright`, the
browsers, `claude`, `josh`, `vscode`, `node`, else `other` — with each kind's summed CPU (`ps`'s
`%cpu`, so 300 is three cores) and resident size, the five heaviest kept. A `ps` that fails or
overruns the probe budget leaves the field out rather than recording an empty list.

Under the stop table, `lane:stats` prints a fourth: one row per kind over the period, with its mean and
peak CPU in cores, its peak resident size in GB and how many samples named it, heaviest mean first. A
period whose samples carried no breakdown prints the header alone.

**The decision the table is for**: what is loading the machine beyond the core budget's ledger
([#3874](https://github.com/joshuafolkken/kit/issues/3874)) — a kind with a high mean that nothing
reserves is the next thing to put on the budget.

## Which check a gate waited on

A `gate` entry's `checks` is one row per check it ran — its label, duration, verdict and whether it was
reused from its own green record (`scripts/gate/check-reuse.ts`). Under the process table, `lane:stats`
prints a fifth: one row per check in first-appearance order — median and maximum seconds, runs, reuses,
no-ops and whole-suite fallbacks.

The first row, `gate (whole)`, is the whole gate. A gate that reused its green record writes a `gate`
entry with `is_reused: true` and no `checks`: a run and a reuse there, and outside the summary row's
gate median ([#4397](https://github.com/joshuafolkken/kit/issues/4397)).

A unit leg that ran the whole suite carries `fallback`, the reason's stable kind read off the line
`test:related` printed (`related_scope.fallback_kind`). A table under it counts the fallbacks by kind.

**A reused check is counted, never timed** — it started no process, so its zero would pull the median
toward a check that never ran. A check that was only ever reused prints `not measured`. A gate recorded
before the field existed contributes no check row.

The unit leg's since-green no-op is counted the same way — `test:related` found nothing moved since
its last green run and ran no test, so the check carries `is_unmoved` (`related_scope.is_unmoved`) and
its second stays out of the median and maximum
([#4457](https://github.com/joshuafolkken/kit/issues/4457)).

## What the lane sessions' transcripts show

The last table is read from the lane sessions' transcripts (`~/.claude/projects/<lane-slug>/*.jsonl`),
not the ledger ([#4418](https://github.com/joshuafolkken/kit/issues/4418)).

It prints tool time per session, the verification calls (`lint:related` / `test:related` /
`cspell:dot` / `gate` / `ship` / `metrics`), the share that waited for the core budget, and the
`lint:related` / `test:related` medians.

- The verification calls are also split by class: the scoped checks, `gate` / `metrics` run by hand,
  and `ship`. A gate inside `ship` is not a call; the ledger's `gate (whole)` row counts it
  ([#4442](https://github.com/joshuafolkken/kit/issues/4442)).
- A call is timed from its `tool_use` line to its `tool_result` line, in the foreground only.
- One Bash call naming two verification commands is counted as chained; the medians take solo calls.
- The period is cut at each call's timestamp. A delegated unit's transcript is not a session.
