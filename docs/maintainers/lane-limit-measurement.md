# Measuring the lane limit

For kit maintainers tuning `JOSH_LANE_LIMIT`; projects that use kit can skip this page.

How many lanes one machine runs well is a measurement, not a guess
([#3347](https://github.com/joshuafolkken/kit/issues/3347)). Each candidate limit is run for a period
of real `backlogrun` work and recorded as one row of the same table, so the limits compare on
throughput, gate duration and machine load side by side.

## Where the numbers come from

One append-only ledger per repository, `josh-lane-ledger-<digest>.jsonl` in the josh temp root, keyed
on the common git directory so every lane, the parent and the sampler write to the same file.

| Entry   | Written by                                       | Fields                                        |
| ------- | ------------------------------------------------ | --------------------------------------------- |
| `merge` | `josh run:merge`, when a child merged            | `at`, `issue`                                 |
| `gate`  | `josh gate`, when it finishes (passed or failed) | `at`, `elapsed_ms`, `is_passed`, `unit_ms?`   |
| `load`  | `josh lane:sample`                               | `at`, `load`, `free_mb`, `swap_mb?`, `lanes?` |

`unit_ms` is the unit suite's own duration, present when the gate ran it; `josh metrics` reads the
gate and unit durations it holds to a baseline from these entries.

Recording is best-effort: a ledger that cannot be written never fails the gate or the merge it
measures. Test suites never write to it.

## Running one period

1. Set the candidate limit in `.env`: `JOSH_LANE_LIMIT=<n>`.
2. Start the sampler in its own terminal and leave it running:
   `pnpm josh lane:sample --every 60`.
3. Run `backlogrun` as usual for the period — several days, or enough merges for the rate to settle.
4. Close the period with `pnpm josh lane:stats --period <days> --limit <n>` and paste the printed row
   into #3347's table. Stop the sampler.

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
| `swap peak` / `mean (GB)`       | `load` samples' `swap_mb`                                       |
| `free memory min` / `mean (GB)` | `load` samples' `free_mb`                                       |
| `load samples`                  | how many `load` samples the period holds                        |

**A column with no samples prints `—`, never `0`** — a period nobody ran the sampler through has no
load, which is not an idle machine. **Throughput is per active hour** — the time from each `load`
sample whose `lanes` is above zero to the next sample (gaps over an hour excluded) — so the nights
between runs in a several-day period do not dilute the rate, even with the sampler left running through
them; only a period with no such sample falls back to the gaps of up to an hour between `merge` and
`gate` entries. **The means (`effective lanes`, load, swap, free memory) take only those working
samples**; peaks and minima take every sample. **An open lane is not an effective lane**: a lane a park
kept, or a stranded one, has no child running and adds no load.
