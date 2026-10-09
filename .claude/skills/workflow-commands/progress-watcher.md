# The progress watcher — every implementing run

**Read this file in full when the run's hold is claimed, before the watcher starts.** It is a
point-of-use document, never an entry read, and the single source of the heartbeat for `fullrun`,
`halfrun`, `prrun` and the `backlogrun` parent alike. `kickoff` starts none.

## Progress while the run is quiet

**Start the progress step without being asked** — in a single-issue run immediately after
`pnpm josh run:hold` succeeds, in a `backlogrun` before step 1 of its loop.

```bash
pnpm josh run:progress --wait --output <the transcript path of each delegated unit>   # in the background
```

**Start it once; it reports by itself.** Each silence interval appends the
five labelled lines to the run's event stream as a heartbeat and to the ambient log, prints nothing to
standard output and keeps running — so a scheduled report never wakes the session, and the session
relays none. **It exits only on one of three, and the command computes which:**

| Exit                                                    | What the session does                                                  |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| Newly runnable backlog work (the `ready #N` line)       | Read the ready line, act on it, and restart the watcher in that turn  |
| `pnpm josh followup` removed the run's life record      | Nothing — the run has ended                                            |
| `--hours` elapsed (8 by default for `--wait`)           | Restart the watcher in that turn                                       |

**A report is not an exit, and neither is a decline** — with no run recorded it keeps waiting, and the
`--hours` exit says so on standard error.

**`pnpm josh run:watcher:guard` detects a missed restart**: wired into
`pretool-guard`, it refuses the next tool call while lane children are in
flight and the watcher's life record has gone stale — once per run, so the restart is not blocked.

**`--mark` at every real report.** Whenever the run reports something of its own, run
`pnpm josh run:progress --mark` in the same turn to restart the silence clock. The clock is silence,
never a timer (`docs/josh-commands-run.md` → "`josh run:progress`").

**Do not keep a progress clock of your own** — the hook refuses the arm rather than asking
(`scripts/rules/early-heartbeat.ts` → `decide`), though a single correctly-spaced arm is allowed.
`--wait` is not a wait timer.

**The default interval is twenty minutes, overridable — by the person, not the run.**
`JOSH_PROGRESS_INTERVAL_MINUTES` moves both sides (the guard reads it through the watcher's reader);
`josh` → `progress_interval_minutes` in `package.json` sits one step below the variable. **`--interval`
moves the watcher alone** — it makes the watcher quieter than the floor, never the guard stricter.
Rationale: `docs/maintainers/progress-watcher-rationale.md` → "Why the heartbeat reads as it does".

### What a report says

**Every unscheduled progress statement is answered by `pnpm josh run:progress --once`** — under
`backlogrun`, `pnpm josh run:board --chat` in one code block — the reply to an explicit ask and
the note just after a run starts alike; each is exempt from the interval and records the report
itself, so no `--mark` beside it. **Relay its lines verbatim** — round, rephrase
or re-label nothing, and **never write a clock time the command did not print**; where a field is
missing, say so. **A field's empty value is an observation, never a state** (`record unread` is not
*not stalled*), and **nothing in the lines is a verification result** — no gate, CI or check rollup.

**The heartbeat is ambient, never a Telegram.** `pnpm josh run:board` is its reader, in a pane of the
person's own; **no session relays the stream** — name the board command once, at the first cut or when
asked; `.vscode/tasks.json` starts it on folder open once VSCode's automatic-task prompt is allowed.
`pnpm josh run:event --watch` stays for following the raw events one by one. `pnpm josh run:wake --list` is the one-line read for a person who types for it.
**A request for periodic progress is never a CronCreate job** — on screen, name `pnpm josh run:board`;
off-screen, start `pnpm josh run:board --every <minutes>` in the background (`docs/josh-commands-run.md`).

**A stop is the only interrupt**: a `backlogrun` that has stopped ends with
`pnpm josh run:carry --end --stopped "<reason>"`, which sends one ⏸️ confirmation; a parked child sends
its own (`backlogrun-park.md`). Rationale: `docs/maintainers/progress-watcher-rationale.md` → "Why the
signal tiers are split this way".

### Who starts it, and what counts as a report

**One watcher per run, and the outermost invocation is the one that starts it.** `fullrun`, `halfrun`,
`prrun` and `backlogrun` start the same watcher under these rules. A `fullrun` running as a
`backlogrun` named issue or child starts none. **A dispatched lane child is refused a watcher by its
`JOSH_LANE_CHILD` mark** — it still runs `--mark` for the parent's clock, but every reporting form
(`--wait`, `--once`, the default watch) exits at once with a notice.

**It is started in the target repository's checkout, and `--mark` is run there too.** A heartbeat is
emitted from the moment a run has started — a registered lane, a held work tree or a carried budget —
even before any child carries `in-progress`; only a checkout with no run recorded stays silent.

**In a single-issue run, a real report is any turn that puts a progress statement in front of the
person** — four of them, `--mark` run in the same turn as each: **the Step 0 work summary, the pull
request opening, each review round's verdict, and any `confirmation` / `failure` / `completion`
notification or stop.** **A tool result only you read is not one** — a gate run, a `gh` read, an edit.
`--output` is omitted there, and `record` reads `unread`. In a `backlogrun`, a child merged, parked or
stopped is the report.

**A run that merges needs no teardown; a run that stops has to end the reporting itself.** A stop
keeps the `in-progress` label on purpose, so **no further `--wait` is started** after the stop
notification, and the running `--wait` is stopped in the same turn, since no report ends it. That
covers `halfrun`'s stop before commit, a `needs-human-review` stop, a split or prerequisite stop, and a
`backlogrun` named issue's failure stop. Rationale: `docs/maintainers/progress-watcher-rationale.md` →
"Why the watcher runs where it does".

Provenance of each rule: `docs/maintainers/progress-watcher-rationale.md` → "Where each rule came from".
