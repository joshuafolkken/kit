# The progress watcher — every implementing run

**"Progress while the run is quiet" is never fetched: `pnpm josh run:progress --wait` prints it as it
starts, once per session.** It is a
point-of-use document, never an entry read, and the single source of the heartbeat for `fullrun`,
`halfrun`, `prrun` and the `backlogrun` parent alike. `kickoff` starts none.

## Progress while the run is quiet

**Start the progress step without being asked** — in a single-issue run immediately after
`pnpm josh run:hold` succeeds, in a `backlogrun` before step 1 of its loop.

```bash
pnpm josh run:progress --wait --output <the transcript path of each delegated unit>   # in the background
```

**Start it once; it reports by itself.** Each silence interval appends the five labelled lines to the
event stream and the ambient log, prints nothing to standard output and keeps running — the session
relays none. **It exits only on one of three, and the command computes which:**

| Exit                                                    | What the session does                                                  |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| Newly runnable backlog work (the `ready #N` line)       | Read the ready line, act on it, and restart the watcher in that turn  |
| `pnpm josh followup` removed the run's life record      | Nothing — the run has ended                                            |
| `--hours` elapsed (8 by default for `--wait`)           | Restart the watcher in that turn                                       |

**A report is not an exit, and neither is a decline** — with no run recorded it keeps waiting, and the
`--hours` exit says so on standard error.

**`pnpm josh run:watcher:guard` detects a missed restart** — via `pretool-guard` it refuses the next
tool call while lane children are in flight and the watcher's record is stale, once per run.

**`--mark` at every real report** — `pnpm josh run:progress --mark` in the same turn restarts the
silence clock (`docs/josh-commands-run.md` → "`josh run:progress`").

**Do not keep a progress clock of your own** — the hook refuses the arm
(`scripts/rules/early-heartbeat.ts` → `decide`), though a single correctly-spaced arm is allowed.
`--wait` is not a wait timer.

**The default interval is twenty minutes, overridable — by the person, not the run.**
`JOSH_PROGRESS_INTERVAL_MINUTES` moves both sides; `josh` → `progress_interval_minutes` in
`package.json` sits one step below it. **`--interval` moves the watcher alone** — quieter, never the
guard stricter.

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
asked; the person starts it, or the `josh: run board` task in `.vscode/tasks.json`, by hand.
`pnpm josh run:event --watch` stays for following the raw events one by one. `pnpm josh run:wake --list` is the one-line read for a person who types for it.
**A request for periodic progress is never a CronCreate job** — on screen, name `pnpm josh run:board`;
off-screen, start `pnpm josh run:board --every <minutes>` in the background (`docs/josh-commands-run.md`).

**A stop is the only interrupt**: a `backlogrun` that has stopped ends with
`pnpm josh run:carry --end --stopped "<reason>"`, which sends one ⏸️ confirmation; a parked child sends
its own (`backlogrun-park.md`).

### Who starts it, and what counts as a report

**One watcher per run, and the outermost invocation is the one that starts it.** `fullrun`, `halfrun`,
`prrun` and `backlogrun` start the same watcher under these rules. A `fullrun` running as a
`backlogrun` named issue or child starts none. **A dispatched lane child is refused a watcher by its
`JOSH_LANE_CHILD` mark** — it still runs `--mark` for the parent's clock, but every reporting form
(`--wait`, `--once`, the default watch) exits at once with a notice.

**It is started in the target repository's checkout, and `--mark` is run there too.** It beats from the
moment a run has started — a registered lane, a held work tree or a carried budget; only a checkout
with no run recorded stays silent.

**In a single-issue run, a real report is any turn that puts a progress statement in front of the
person** — `--mark` in the same turn as each: **the Step 0 work summary, the pull request opening, each
review round's verdict, and any `confirmation` / `failure` / `completion` notification or stop.** **A
tool result only you read is not one.** `--output` is omitted there, and `record` reads `unread`. In a
`backlogrun`, a child merged, parked or stopped is the report.

**A run that merges needs no teardown; a run that stops has to end the reporting itself** — **no
further `--wait` is started** after the stop notification, and the running one is stopped in the same
turn: `halfrun`'s stop before commit, a `needs-human-review`, split or prerequisite stop, a
`backlogrun` named issue's failure stop.
