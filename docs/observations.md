# Observation ledger

**This file is where a mid-run observation goes when it is real but has not yet blocked anything.**
Before it existed such an observation had two destinations — an Issue or nothing — and
`SKILL.md` → §2i's depth test sends most of them to "not filed". Dropped, the fact that the same
thing was seen twice was never recorded anywhere, so every sighting looked like the first one and the
depth gate was walked past instead of held (joshuafolkken/kit#1728).

**The line format, the identity key, the count that decides a repeat and the promotion that follows
it are all defined in `.claude/skills/workflow-commands/SKILL.md` → §2i, which is their single
source.** They are written there rather than here because that skill is distributed to every
repository consuming this package while `docs/` is not, and a consumer's ledger has to be shaped by a
rule the consumer actually receives.

**The ledger is append-only.** A line is never edited and never deleted, because the count of lines
carrying one key is exactly what says whether an observation has recurred. A second sighting is a
**second line with the same key**, not a rewrite of the first.

**A merge conflict here is resolved by keeping both sides.** Two branches appending at once is the
ordinary case, and a repeated key is the whole signal this file carries — resolving the conflict by
dropping either side destroys exactly what it exists to record.

## Ledger

<!-- Append only. Newest at the bottom. One observation per line; the format is SKILL.md → §2i. -->

- k:investigation-guard-verification-log | d1 | 2026-09-11 | pnpm josh investigation:guard | Reading a background gate run's own output file was refused as investigating an unedited subject file, costing a round trip each time
- k:scripts-cli-near-line-limit | d1 | 2026-09-11 | scripts/epic/epic-bundle-cli.ts | Two scripts CLI files sit past the near threshold at 277 and 259 of 300 code lines, so the next feature touching either owes a splitting plan
- k:open-issue-listing-reader-duplicated | d1 | 2026-09-11 | scripts/issue/issue-depth-share-cli.ts | The fetch-then-undefined-check-then-read-json-listing shape now stands in four places, each returning a different type, so no single reader has been extracted
- k:wake-worst-case-near-cut-interval | d1 | 2026-09-11 | pnpm josh run:wake | Worst case from a cut to the warning is about 40 minutes against a measured cut interval of about 50, so a lost wake costs most of a cycle
- k:issue-labels-individual-exports | d1 | 2026-09-11 | scripts/git/issue-labels.ts | The module exports functions individually rather than through a namespace object, and a third one was added rather than converting the existing two
- k:unit-tests-near-timeout-under-load | d1 | 2026-09-11 | pnpm josh test:unit | Four unit tests sit at 1.6-2.8 s against the 10 s budget and inflate about 12x under full-suite parallelism, so a heavier machine load puts them in the band that reddened an unrelated gate
- k:vitest-worker-spawn-overhead | d1 | 2026-09-11 | pnpm josh test:unit | Vitest reports 687 workers spawned at about 101 ms each and estimates 6.81 s saved with isolation off, roughly a quarter of the unit stage
- k:investigation-guard-verification-log | d1 | 2026-09-11 | pnpm josh investigation:guard | A queue parent was refused twice — reading a background run:progress watcher's own output file, and reading the workflow procedure documents the command requires it to read
- k:observations-flush-auto-mode-refusal | d1 | 2026-09-11 | pnpm josh observations:flush | The auto-mode classifier refused the flush once mid-run and allowed the same command after the merge, so a command whose only job is a docs pull request can be gated unpredictably in an unattended run
- k:observations-flush-happy-path-untested | d1 | 2026-09-11 | pnpm josh observations:flush | Only the refusals and the message builders carry unit tests, so the flush's first real execution was the run that shipped it
- k:auto-mode-classifier-splits-on-spelling | d1 | 2026-09-11 | pnpm josh run:release | The classifier refused the long spelling and allowed the alias that runs the identical code path, so the gate cost a round trip without withholding anything
- k:threshold-issue-site-count-mismatch | d1 | 2026-09-11 | joshuafolkken/kit#1775 | The issue heading named 22 sites while its per-file breakdown summed to 24, so the acceptance criterion could not be checked literally
- k:stale-worktree-carries-old-document | d1 | 2026-09-11 | .claude/worktrees/ | Worktree copies of the workflow documents can hold a superseded threshold, so a lane opened from one would read the old value
- k:eval-unmeasured-whole-batch | d2 | 2026-09-11 | pnpm josh eval:scope | Every issue of a six-issue batch answered skip because the measurement is opt-in, so the batch carries no rule-compliance signal at all
- k:detached-supervisor-keeps-spawn-time-code | d1 | 2026-09-11 | pnpm josh run:wake | A detached supervisor runs the code it was spawned with for hours and a start against a live one silently declines, so a merged fix takes effect only after a manual stop and start
- k:tmpdir-resolved-per-caller | d1 | 2026-09-11 | scripts/run/stamp-file.ts | The temp directory is resolved per call, so a supervisor spawned with a different setting writes its record and log where the person's shell will not look
- k:woken-session-no-assistant-record | d1 | 2026-09-11 | pnpm josh run:wake | Three earlier woken sessions died with no assistant record at all, an earlier failure point than the connection refusal that was fixed
- k:agent-command-constant-third-copy | d1 | 2026-09-11 | scripts/eval/eval-session.ts | The agent command name now stands in a third place with different flags, so folding it in is a design decision rather than a rename
- k:liveness-synopsis-stale-in-document | d1 | 2026-09-11 | .claude/skills/workflow-commands/epicrun.md | The liveness synopsis still shows a superseded option and is pinned verbatim by a marker test, so correcting it requires updating that test in the same change
- k:lane-dispatch-unexercised | d1 | 2026-09-11 | pnpm josh lane:dispatch | The dispatch command ships but nothing invokes it automatically, so its behavior in a real multi-lane run is untested
- k:round2-brief-taken-before-push-lands | d1 | 2026-09-11 | pnpm josh review:brief | A round two brief taken while the backgrounded push was still committing pinned the pre-commit head and wasted a review round, and no document states the ordering
- k:followup-leaves-in-progress-label | d1 | 2026-09-11 | pnpm josh followup | The completion step merged and closed the issue but left the in-progress label on it, seen on two issues of one batch
- k:wake-session-test-near-line-limit | d1 | 2026-09-11 | scripts/run/run-wake-session.test.ts | The test file sits at 280 of 300 code lines, so the next addition there owes a splitting plan
- k:measurement-inside-measured-document | d1 | 2026-09-11 | pnpm josh read:set | Quoting a document's own measured size inside that document changes the number on every edit, so any future measurement of a distributed document carries the same hazard
- k:investigation-guard-verification-log | d1 | 2026-09-11 | pnpm josh investigation:guard | Refused more than ten times across a queue parent and six delegated children, including reads of files a run was about to edit
- k:followup-leaves-in-progress-label | d1 | 2026-09-11 | pnpm josh followup | Both issues of this queue closed with the in-progress label still on them, the second sighting of the same phenomenon
- k:observations-flush-happy-path-untested | d1 | 2026-09-11 | pnpm josh observations:flush | The rollback suite now drives the flush end to end against a mocked git, but the real push and merge path is still not exercised
- k:scripts-file-near-line-limit | d1 | 2026-09-11 | scripts/git/git-command.ts | Two non-CLI scripts files now sit near the limit at 277 and 293 of 300 code lines, so the next change to either owes a splitting plan
- k:no-global-shim-write-flags-comment | d1 | 2026-09-11 | scripts/no-global-shim-write.test.ts | The marker suite greps source strings, so naming a forbidden helper in a comment alone turned the gate red
- k:investigation-guard-batch-refusal-unnamed | d1 | 2026-09-11 | pnpm josh investigation:guard | Batching an exempt file with counted files refuses the whole call and the refusal names no file, so the exempt read looks like the cause
- k:pull-ff-only-multiple-branches | d1 | 2026-09-12 | pnpm josh git -y | The pull step aborted with "Cannot fast-forward to multiple branches" because FETCH_HEAD held the default branch twice as for-merge, and a fresh fetch alone restored it
- k:agent-dispatch-breaks-batching-run | d1 | 2026-09-12 | pnpm josh batch:guard | Agent, Task and Skill are absent from the bundleable set, so a turn dispatching one agent flushes the run of single-call turns the guard counts
- k:stale-in-progress-on-closed-issues | d1 | 2026-09-12 | pnpm josh followup | Over a hundred already-closed issues still carry the in-progress label from before the removal shipped, and a retroactive sweep is a bulk write nobody has authorized
- k:review-fork-skips-attest | d1 | 2026-09-12 | pnpm josh review:attest | A review fork reported findings without attesting, so the check answered no review and a full round had to be paid for twice
- k:skip-pr-push-reports-ahead | d1 | 2026-09-12 | pnpm josh git -y --skip-pr | The command exited zero but the branch still read ahead by one, and a later push answered everything up-to-date
- k:hand-written-josh-command-vocabularies | d2 | 2026-09-12 | scripts/time/time-parent-turns.ts | Three hand-written vocabularies of josh command names hold entries nothing asserts are canonical, and one of them held an alias that silently miscounted a contributor
- k:scripts-file-near-line-limit | d1 | 2026-09-12 | scripts/time/time-last.test.ts | A third file reached 271 of 300 code lines and was found only because someone asked about that one file, filed as #1809
- k:distribution-ms-fields-carry-turn-counts | d2 | 2026-09-12 | scripts/time/time-contributors.ts | The shared distribution helper names its fields for milliseconds but now also carries turn counts, so the naming misleads at the new call site
- k:round2-brief-refuses-on-identical-tree | d1 | 2026-09-12 | pnpm josh review:brief | The round two brief refused for want of green scoped checks right after the commit, on a byte-identical tree those checks had just passed on, because the greenness record is keyed to the moved head
- k:classify-reads-rearm-drift | d2 | 2026-09-12 | pnpm josh time | The read classifier always applies the accumulation re-arm while the live guard withholds it inside a delegated unit, so a per-unit report over-counts refusals
- k:investigation-block-per-run-only | d2 | 2026-09-12 | pnpm josh time --last | The new investigation-reads block is produced per run only, so a cross-run trend of it still needs a hand-written probe
- k:epic-no-blocked-by-relation | d1 | 2026-09-12 | pnpm josh followup | The completion step reported that the epic holds no blocked-by relation on any child, so the batch order it was run in was never recorded natively
- k:lane-child-runs-josh-latest | d1 | 2026-09-12 | pnpm josh lane:dispatch | Each dispatched lane child asked latest:scope in its own project root and was told required, so four of six lanes ran josh latest and carried unrelated lock file changes into their pull requests
- k:lane-transcript-not-attributed | d2 | 2026-09-12 | pnpm josh time --issue | A dispatched lane child files its transcript under the lane's own project slug while the lookup still resolves a lane back to the main checkout, so all eight merged lane runs reported no transcript attributed and none reached the time history
- k:dispatch-log-empty-until-child-exits | d1 | 2026-09-12 | pnpm josh lane:dispatch | A dispatched child writes its output only when it exits, so its log held nothing through 19 minutes of real work and both the progress record field and the run:liveness output trace read a working child as frozen
- k:dispatch-pgrep-pattern-never-matches | d1 | 2026-09-12 | pnpm josh lane:dispatch | The poll command it prints matches the lane directory while the child it started runs as claude -p fullrun #N, so pgrep finds nothing for a live child and the process trace run:liveness is given answers none
- k:lane-child-starts-progress-watcher | d1 | 2026-09-12 | pnpm josh lane:dispatch | The child is started with a bare fullrun invocation carrying nothing that says it descends from an epicrun, so it followed fullrun.md and started its own run:progress watcher that the lane rules say a child must not start
- k:pre-gate-cut-relaunch-never-arrived | d1 | 2026-09-13 | pnpm josh run:cut | A lane child reported taking the cut and handing the run to a fresh process, and afterwards run:cut --resume answered fresh with no process alive, so the announced hand-off left the run stopped with its implementation uncommitted and its in-progress label removed
- k:last-child-merge-leaves-no-wake | d1 | 2026-09-13 | pnpm josh run:progress --wait | The merge of the last child in flight removes the very in-progress label the watcher needs to print, so the watcher never exits, a detached lane child cannot wake the parent either, and the parent stayed silent for 27 minutes until the person asked whether the epic had finished
- k:dispatch-log-empty-until-child-exits | d1 | 2026-09-13 | pnpm josh lane:dispatch | All six dispatched child logs stayed at their 72-byte start line ten minutes into real work, so the record field read every live child as unchanged
- k:dispatch-pgrep-pattern-never-matches | d1 | 2026-09-13 | pnpm josh lane:dispatch | The printed pgrep on the lane directory found no process for three children that ps showed alive with the lane as their working directory
- k:lane-child-starts-progress-watcher | d1 | 2026-09-13 | pnpm josh lane:dispatch | The dispatched fullrun #1937 child started its own run:progress --wait watcher inside its lane
- k:pre-gate-resume-claims-own-hold | d1 | 2026-09-13 | pnpm josh run:hold | The fresh process relaunched by a pre-gate cut claimed the working-tree hold and was answered busy by its dead predecessor's record over the uncommitted implementation, so the child stopped although run:cut still carried a handed-off pre-gate record
- k:epic-add-move-drops-outgoing-chain | d1 | 2026-09-14 | pnpm josh epic --add | Moving existing child #1925 before #1927 also removed its unrelated #1925 -> #1928 relation and rewired it to #1959 -> #1928, so #1928 was offered while #1925 was still in flight until the chain was restored by hand
- k:lane-child-asks-user-question | d1 | 2026-09-14 | pnpm josh lane:dispatch | Dispatched children #1925, #1926 and #1927 each ended their run by calling AskUserQuestion, which a headless child cannot deliver, instead of parking with needs-decision
- k:progress-wait-declines-on-failed-read | d1 | 2026-09-15 | pnpm josh run:progress --wait | One gh pull request read failing with unexpected EOF made the whole observation throw, so the watcher printed nothing for its full one-hour bound and delivered no wake while nine lanes were in flight
- k:lane-child-dies-on-api-socket-error | d1 | 2026-09-15 | pnpm josh lane:dispatch | Four dispatched children ended within half an hour on "The socket connection was closed unexpectedly" during a network outage, each leaving its lane stopped until the parent's liveness window elapsed
- k:lane-child-dies-on-api-socket-error | d1 | 2026-09-21 | pnpm josh lane:dispatch | The child dispatched for #2236 exhausted all ten retries on "Unable to connect to API (ConnectionRefused)" after 19 turns and exited, so the parent booked an environment outage as a child failure and parked the issue
- k:nested-epic-blocker-reads-human | d1 | 2026-09-21 | pnpm josh backlog:plan | #2213 was listed under "Waiting on a person (needs-decision)" although it carries no such label, because its blocker #2183 is a nested epic classified as waiting on a person even though that epic's own remaining children were runnable and would close it without anyone deciding anything
- k:guard-reason-names-scratchpad-as-exempt | d1 | 2026-09-22 | pnpm josh investigation:guard | The refusal reason lists this session's scratchpad among the files never counted, while is_session_artifact exempts only the state root and a tasks/<id>.output file and investigation-reads.test.ts pins the scratchpad as counted, so a refused run is told its scratchpad reads cannot be what took the count
- k:wake-role-waiting-heavy | d1 | 2026-09-22 | pnpm josh retrospective | The wake role took 52% of the wall clock against 25% of the cost over 520 sessions and the digest marked it waiting-heavy, with nothing yet saying whether a woken session's ramp is the wait or the cost
- rf:none | none | - | 2026-09-22 | #2342
- rf:bug-risks | medium | .claude/skills/workflow-commands/backlogrun-steps.md | 2026-09-23 | #2393
- rf:bug-risks | medium | scripts/retrospective/retrospective-cli.ts | 2026-09-23 | #2393
- rf:performance | low | scripts/run/run-report-cli.ts | 2026-09-23 | #2393
- rf:project-conventions | low | scripts/run/run-report.ts | 2026-09-23 | #2393
- rf:tests | low | scripts/run/run-report.test.ts | 2026-09-23 | #2393
- rf:tests | low | scripts/run/run-report-cli.ts | 2026-09-23 | #2393
- rf:project-conventions | low | .claude/skills/workflow-commands/backlogrun-steps.md | 2026-09-23 | #2393
- rf:project-conventions | low | docs/josh-commands.md | 2026-09-23 | #2393
- rf:comments | low | .claude/skills/workflow-commands/backlogrun-steps.md | 2026-09-23 | #2393
- rf:project-conventions | low | scripts/run/run-ship-cli.ts | 2026-09-23 | #2398
- rf:bug-risks | medium | scripts/rules/poll-loop.ts | 2026-09-23 | #2421
- rf:none | none | - | 2026-09-23 | #2421
- rf:bug-risks | medium | scripts/run/run-event-scope.ts | 2026-09-23 | #2426
- rf:bug-risks | medium | scripts/run/run-ship-stage.ts | 2026-09-23 | #2426
- rf:bug-risks | medium | scripts/run/run-ship-probe.ts | 2026-09-23 | #2426
- rf:bug-risks | low | scripts/run/run-ship-stage.ts | 2026-09-23 | #2426
- rf:tests | low | scripts/review/review-record.test.ts | 2026-09-23 | #2431
- k:lane-child-ends-turn-with-ship-backgrounded | d1 | 2026-09-23 | pnpm josh ship | A headless lane child ended its turn with ship still backgrounded, so the process exit killed ship and run:merge booked a finished child as abandoned; #2428's detached supervisor is the planned fix
- rf:none | none | - | 2026-09-23 | #2431
- rf:none | none | - | 2026-09-23 | #2434
- rf:bug-risks | medium | eslint/portable-parser-options.js | 2026-09-23 | #2435
- rf:none | none | - | 2026-09-23 | #2439
- rf:bug-risks | medium | scripts/git/git-gh-exec.ts:52 | 2026-09-23 | #2436
- rf:assumptions | medium | scripts/git/git-gh-exec.ts:46 | 2026-09-23 | #2436
- rf:bug-risks | medium | scripts/run/run-ship-stage.ts:95 | 2026-09-23 | #2427
- rf:bug-risks | low | scripts/run/run-ship-review-steps.ts:43 | 2026-09-23 | #2427
- rf:none | none | - | 2026-09-23 | #2427
- rf:assumptions | low | scripts/agent/claude-agent-argv.ts | 2026-09-23 | #2435
- rf:bug-risks | high | scripts/git/git-gh-exec.ts | 2026-09-23 | #2436
- rf:bug-risks | medium | scripts/josh/agent-session-environment.ts | 2026-09-23 | #2436
- rf:bug-risks | high | scripts/lane/lane-child-invocation.ts:28 | 2026-09-23 | #2428
- rf:bug-risks | medium | scripts/lane/lane-relaunch.ts:42 | 2026-09-23 | #2428
- rf:bug-risks | low | scripts/run/run-ship-cli.ts | 2026-09-23 | #2428
- rf:bug-risks | low | scripts/run/run-ship-detach.ts | 2026-09-23 | #2428
- rf:bug-risks | low | scripts/run/run-ship-detach.ts | 2026-09-23 | #2428
- rf:bug-risks | medium | scripts/run/run-event-scope.ts:112 | 2026-09-23 | #2428
- rf:tests | low | scripts/run/run-cut-cli.test.ts:131 | 2026-09-23 | #2428
- rf:tests | low | scripts/lane/lane-relaunch.test.ts:32 | 2026-09-23 | #2428
- rf:bug-risks | low | scripts/run/run-ship-cli.ts:317 | 2026-09-23 | #2428
- rf:bug-risks | low | scripts/run/run-ship-cli.ts:317 | 2026-09-23 | #2428
- rf:bug-risks | medium | scripts/git/main-merge-guard.ts | 2026-09-23 | #2445
- rf:bug-risks | low | scripts/git/main-merge.ts | 2026-09-23 | #2445
- rf:comments | low | scripts/rules/stop-rules.ts | 2026-09-23 | #2445
- rf:bug-risks | medium | scripts/git/main-merge-guard.ts | 2026-09-23 | #2445
- rf:bug-risks | low | scripts/git/main-merge-guard.ts | 2026-09-23 | #2445
- rf:bug-risks | low | scripts/rules/stop-rules.ts | 2026-09-23 | #2445
- rf:bug-risks | low | scripts/issue/defect-rate-cli.ts:115 | 2026-09-23 | #2449
- rf:performance | low | scripts/issue/defect-rate.ts:44 | 2026-09-23 | #2449
- rf:comments | low | scripts/issue/defect-rate.ts:5 | 2026-09-23 | #2449
- rf:bug-risks | low | scripts/test/test-red.ts:81 | 2026-09-23 | #2448
- k:lane-child-ends-turn-with-ship-backgrounded | d1 | 2026-09-23 | pnpm josh ship | The #2449 lane child launched ship without --detach and ended its turn, so ship died mid-gate and run:merge parked it; filed as #2457
- rf:bug-risks | medium | scripts/run/run-ship-cli.ts | 2026-09-23 | #2446
- rf:bug-risks | medium | scripts/review/live-evidence.ts | 2026-09-23 | #2446
- rf:bug-risks | low | scripts/run/run-ship-detach.ts | 2026-09-23 | #2446
- rf:comments | low | .claude/skills/workflow-commands/chain-rule.md | 2026-09-23 | #2446
- rf:comments | low | prompts/collaboration-workflow/report-format.md | 2026-09-23 | #2446
- rf:tests | low | scripts/issue/defect-rate-cli.test.ts | 2026-09-23 | #2449
- rf:tests | low | scripts/run/run-ship-detach.test.ts | 2026-09-23 | #2456
- rf:tests | low | scripts/run/run-ship-detach.test.ts | 2026-09-23 | #2456
- rf:bug-risks | medium | scripts/run/run-ship-cli.ts | 2026-09-23 | #2446
- rf:bug-risks | low | scripts/git/git-pr.ts | 2026-09-23 | #2446
- rf:bug-risks | low | scripts/git/git-pr.ts | 2026-09-23 | #2446
- rf:assumptions | low | scripts/git/git-gh-pr.ts | 2026-09-23 | #2446
- rf:comments | low | scripts/issue/defect-rate.ts | 2026-09-23 | #2455
- rf:comments | low | scripts/backlog/backlog-defect-priority.ts | 2026-09-23 | #2455
- rf:performance | low | vitest.harness.config.ts | 2026-09-23 | #2447
- rf:bug-risks | low | scripts/test/josh-harness-environment.ts | 2026-09-23 | #2447
- rf:performance | low | scripts/test/josh-harness-environment.ts | 2026-09-23 | #2447
- rf:none | none | - | 2026-09-23 | #2457
- rf:tests | low | scripts/run/run-ship-resume.test.ts | 2026-09-23 | #2471
- rf:project-conventions | low | scripts/run/run-ship-resume.test.ts:56 | 2026-09-23 | #2471
- rf:bug-risks | medium | scripts/observations/observations-flush.ts | 2026-09-23 | #2462
- rf:bug-risks | low | scripts/josh/josh-run.ts | 2026-09-23 | #2462
- rf:none | none | - | 2026-09-23 | #2462
- rf:bug-risks | medium | scripts/backlog/backlog-stalled-detect.ts:52 | 2026-09-23 | #2464
- rf:bug-risks | low | scripts/lane/lane-dispatch.ts:333 | 2026-09-23 | #2464
- rf:project-conventions | low | scripts/lane/lane-dispatch.ts:333 | 2026-09-23 | #2464
- rf:tests | low | scripts/backlog/backlog-stalled.test.ts:81 | 2026-09-23 | #2464
- rf:comments | low | scripts/run/run-event-stream.ts:68 | 2026-09-23 | #2464
- rf:tests | low | scripts/run/run-event-stream-emit.test.ts:159 | 2026-09-23 | #2464
- rf:bug-risks | medium | scripts/backlog/backlog-ready.ts | 2026-09-23 | #2472
- rf:performance | medium | scripts/hooks/stop-guard.ts | 2026-09-23 | #2472
- rf:none | none | - | 2026-09-23 | #2472
- rf:bug-risks | medium | scripts/run/run-relay-seat.ts | 2026-09-23 | #2480
- rf:performance | low | scripts/hooks/stop-guard.ts | 2026-09-23 | #2480
- rf:tests | low | scripts/run/run-carry-cli.ts | 2026-09-23 | #2480
- rf:comments | low | scripts/hooks/stop-guard.ts | 2026-09-23 | #2480
- rf:tests | low | scripts/run/run-watcher-guard.test.ts | 2026-09-23 | #2480
- rf:assumptions | low | scripts/run/run-relay-seat.ts | 2026-09-23 | #2480
- rf:assumptions | low | scripts/hooks/stop-guard.ts | 2026-09-23 | #2480
- k:run-report-heartbeat-flood | d1 | 2026-09-24 | pnpm josh run:report | The completion summary rendered 221 heartbeat events (1139 lines, many at the same instant), too long to be the Telegram body
- rf:bug-risks | medium | scripts/rules/reply-language.ts:77 | 2026-09-23 | #2470
- rf:bug-risks | medium | scripts/rules/reply-language.ts:72 | 2026-09-23 | #2470
- rf:bug-risks | medium | scripts/rules/stop-rules.ts:274 | 2026-09-23 | #2470
- rf:tests | medium | scripts/hooks/stop-guard.test.ts:79 | 2026-09-23 | #2470
- rf:project-conventions | low | scripts/rules/stop-rules-fixtures.ts | 2026-09-23 | #2470
- rf:comments | low | scripts/hooks/stop-guard.ts:84 | 2026-09-23 | #2470
- rf:bug-risks | medium | scripts/run/run-entry-cli.ts | 2026-09-23 | #2476
- rf:bug-risks | medium | scripts/run/run-merge-steps.ts | 2026-09-23 | #2476
- rf:bug-risks | medium | scripts/run/run-step-cli.ts | 2026-09-23 | #2476
- rf:project-conventions | low | scripts/run/run-step.ts | 2026-09-23 | #2476
- rf:comments | low | scripts/git/git-stash.ts | 2026-09-23 | #2476
- rf:comments | low | scripts/run/run-merge-steps.ts | 2026-09-23 | #2476
- k:lane-child-ends-turn-with-command-backgrounded | d1 | 2026-09-24 | pnpm josh gate | The #2476 lane child reported waiting on a backgrounded gate and ended its turn, so the gate died with it and nothing was committed
- rf:bug-risks | low | scripts/run/run-merge-steps.ts:185 | 2026-09-23 | #2476
- rf:bug-risks | low | scripts/run/run-merge-steps.ts:175 | 2026-09-23 | #2476
- rf:bug-risks | low | scripts/git/git-stash.ts:17 | 2026-09-23 | #2476
- rf:project-conventions | low | scripts/run/run-next.ts:231 | 2026-09-23 | #2476
- rf:project-conventions | low | scripts/run/run-merge-steps.ts:218 | 2026-09-23 | #2476
- rf:comments | low | .claude/skills/workflow-commands/backlogrun-lanes.md:291 | 2026-09-23 | #2476
- rf:comments | low | docs/josh-commands.md:1625 | 2026-09-23 | #2476
- rf:comments | low | scripts/rules/decision-oracle.ts:103 | 2026-09-23 | #2476
- rf:comments | low | scripts/run/run-merge-steps.ts:209 | 2026-09-23 | #2476
- rf:tests | low | scripts/run/run-merge-steps.test.ts:37 | 2026-09-23 | #2476
- rf:bug-risks | medium | scripts/rules/reply-language.ts:79 | 2026-09-23 | #2470
- rf:bug-risks | low | scripts/rules/reply-language.ts:74 | 2026-09-23 | #2470
- rf:tests | low | scripts/hooks/stop-guard.test.ts:17 | 2026-09-23 | #2470
