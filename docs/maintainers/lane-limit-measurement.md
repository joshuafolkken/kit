# Measuring the lane limit

For kit maintainers tuning `JOSH_LANE_LIMIT`; projects that use kit can skip this page.

How many lanes one machine runs well is a measurement, not a guess
([#3347](https://github.com/joshuafolkken/kit/issues/3347)). Each candidate limit is run for a period
of real `backlogrun` work and recorded as one row of the same table, so the limits compare on
throughput, gate duration and machine load side by side.

## Where the numbers come from

One append-only ledger per repository, `josh-lane-ledger-<digest>.jsonl` in the josh temp root, keyed
on the common git directory so every lane, the parent and the sampler write to the same file.

| Entry      | Written by                                                    | Fields                                                 |
| ---------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| `merge`    | `josh run:merge`, when a child merged                         | `at`, `issue`                                          |
| `gate`     | `josh gate`, when it finishes (passed or failed)              | `at`, `elapsed_ms`, `is_passed`, `unit_ms?`            |
| `load`     | `josh backlog:drive` while it runs, and `josh lane:sample`    | `at`, `load`, `available_mb?`, `swapped_mb?`, `lanes?` |
| `dispatch` | `josh lane:dispatch`, when a child started                    | `at`, `issue`                                          |
| `stage`    | `josh ship`, as each stage ends; `josh followup` for the wait | `at`, `stage`, `elapsed_ms`, `issue?`                  |

A `stage` entry's `at` is when the stage ended, so it began `elapsed_ms` earlier. `josh followup`
writes one of its own, `ci-wait` — the time it spent waiting for the checks — and that one carries no
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

**Close the period before a reboot.** The ledger lives in the temp root, which a reboot clears; a
period that has to span one is closed before it and continued as a second row.

## The columns

| Column                          | Source                                                          |
| ------------------------------- | --------------------------------------------------------------- |
| `JOSH_LANE_LIMIT`               | `--limit`, else the limit `lane:stats` reads                    |
| `period (days)`                 | `--period`                                                      |
| `merges`                        | `merge` entries in the period                                   |
| `merges / hour`                 | merges per active hour — time `load` samples saw a lane working |
| `effective lanes`               | mean of the working `load` samples' `lanes` (child running)     |
| `gate median (min)` / `max`     | `gate` entries' `elapsed_ms`                                    |
| `load peak` / `mean`            | `load` samples' one-minute load average                         |
| `swapped peak` / `mean (GB/h)`  | the `swapped_mb` difference between consecutive `load` samples  |
| `free memory min` / `mean (GB)` | `load` samples' `available_mb`                                  |
| `load samples`                  | how many `load` samples the period holds                        |

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

| Row                             | Source                                                                     | Read for                                                    |
| ------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `implement`                     | a `dispatch` entry to the start of the same issue's first `stage` after it | how much of a lane neither decision below can move          |
| `review`                        | `stage` entries of `josh ship`'s round-one review                          | whether to overlap the round-one review with CI             |
| `ci-wait`                       | `stage` entries `josh followup` writes for its wait on the checks          | whether to overlap the round-one review with CI             |
| `gate`                          | `stage` entries of `josh ship`'s gate                                      | whether to lower `JOSH_LANE_LIMIT`, beside the load columns |
| `preflight`, `sync`, `commit`   | `stage` entries of `josh ship`                                             | the rest of the time from dispatch to the pull request      |
| `round-2`, `followup`, `report` | `stage` entries of `josh ship`                                             | the rest of the time from the pull request to the merge     |

**A stage nothing recorded prints `not measured`, never `0`** — a period that ran no second review
round has no `round-2` duration, which is not a round that took no time. A stage that found nothing
to do — a round 2 that was not due, a round 1 already recorded — writes no entry.

**`runs` counts entries, not lanes.** A ship relaunched after a fix runs its stages again, and a lane
child runs the preflight once itself before the supervisor does, so a stage can hold more runs than
the period has merges.

**`implement` is derived, not recorded.** It runs from a child's dispatch to the start of the first
ship stage of the same issue; a child dispatched again before it shipped contributes nothing, so the
replacement's ship is not counted against it.

**`ci-wait` is inside `followup`**, not beside it: the two rows overlap, and `ci-wait` is the part of
`followup` that waited for the checks. Only a wait that ran to its end is recorded — one that was
interrupted leaves no entry.

**The two decisions the table is for.** Overlapping the round-one review with CI saves one CI wait when
`review`'s median is at least `ci-wait`'s, and almost nothing when `review` is under a minute. Lowering
`JOSH_LANE_LIMIT` is worth it when `gate` grows with the effective lanes while the load peak is above
the core count.
