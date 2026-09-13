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
