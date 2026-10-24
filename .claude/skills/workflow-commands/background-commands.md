# A command that can take minutes is issued in the background

## Background the gate and push

- **The clean path folds the region into one backgrounded `pnpm josh ship`** (preflight → gate → `git -y` →
  foreground `followup` → `run:tail`). The calls below serve a due second round.
- Background `pnpm josh gate` beside the review; join it before commit.
- Issue `pnpm josh git -y` in the background; its completion resumes the run, so the turn never ends
  at the push.
- `pnpm josh followup` stays in the foreground (`followup.md`).
- **Record before the CI wait ends, never after the merge**: the commit
  carries the observation ledger lines recorded so far, and while CI runs the run makes the records
  that need no CI result — observation Issues, the completion report draft.
- Overlap only tree-readers, and compose merge-independent tail data before `followup` (the table
  below is the full mapping); keep `josh ms`, state checks, next-child selection, lane closing and the
  session-cost check after the merge.
- A lane child's hand-off or pre-gate cut is the sole turn boundary before the push (`chain-rule.md`).

Use harness detachment so completion returns to the run. Foreground timeouts stay within the cap.

## How the wait ends — the task's exit, never a regex over its output

**Background it from the first, then end the turn.** A `run_in_background` command re-invokes the run
when it *exits* — that completion notification is what ends the wait, not a regex match or the block
limit. A backgrounded `Agent` → the same; in a lane child → the `lane-background` row of `pnpm josh rule:list`.

**Never hand-write a `while`/`until` … `sleep` loop over the output file, or a counted `for` that sleeps** — a regex that never matches
waits to the block limit, one that matches a mid-run line exits early. the `poll-loop` row of `pnpm josh rule:list` refuses it
(`prompts/collaboration-workflow/rule-delivery.md`).

**To glance at interim output, `Read` the output file once**, never in a sleep loop. CI is waited on by
`pnpm josh followup`; a progress heartbeat is `run:progress --wait`'s job (`early-heartbeat` refuses a
hand-armed timer).

## The tail and what overlaps each wait

**Never give a foreground call a timeout above the harness cap** — a larger number detaches it without
the completion notification.

**The tail is emptied before `followup` is issued.** Each step is asked one question: **does it read the
merge result?**

- **It does — it stays after `followup`**: `pnpm josh ms`, `pnpm josh issue:state <N>`,
  `pnpm josh epic:next`, `pnpm josh backlog:next --exclude <N>`, `pnpm josh lane:close` /
  `pnpm josh lane:list`. **De-duplicating a step is not removing it** — none is dropped or answered
  from memory.
- **It does not — it is composed in the turn that issues `followup`**: the epic progress counter
  *values* and the completion report body. **Only the write follows the merge.**
- **`pnpm josh cost --cut` stays after the merge**, though it reads nothing from it (`backlogrun-progress.md`
  → "The check is asked at every merge").

**Beside a backgrounded command runs only work that writes nothing to the working tree**:

| While this runs | Do this beside it |
| --------------- | ----------------- |
| `pnpm josh gate` | a subagent running `/code-review` with the brief `pnpm josh review:brief` prints |
| `pnpm josh git -y` | Write the completion notification body to a file for `--notify-message-file`, and settle the three-way disposition of any remaining non-High finding |
| CI, after the push | The second review round where one is due, the branch-2 filing through `pnpm josh issue:file`, which runs `epic:bundle` itself (`prompts/review.md` → "Review round cap") |
| `pnpm josh followup` | Nothing — it is foreground. **The post-merge tail is taken before the call**: compose the epic progress counters first, and leave after the merge only the steps that read its result, plus `pnpm josh cost --cut` |

**The turn never ends at the push.** The `pnpm josh git -y` completion resumes the run, and that turn
goes straight through any branch-2 filing and `pnpm josh epic:bundle` to `pnpm josh followup`. the
`run-tail` row of `pnpm josh rule:list` refuses the foreground push (`prompts/collaboration-workflow/rule-delivery.md`); the
push reissued detached is not refused again.

**One turn does end before the push: a dispatched lane child's pre-gate cut** — `pre-gate-cut.md` →
"Taking the cut".

**A headless lane child (`claude -p`) is where "a background command re-invokes the run" does not
hold: its background Bash tasks are killed when its turn ends.** It hands the gate-to-merge region to a
foreground `pnpm josh ship --detach` (`chain-rule.md` step 0); the `lane-background` row of `pnpm josh rule:list` refuses a
backgrounded `josh gate` / `git` / `followup` / `ship` there, and the `Stop` hook sends a child with a
task still running back to wait.

The operational section above is the single source of the rule. `followup.md`, `chain-rule.md` and
`progress-watcher.md` → "Progress while the run is quiet" route here for it rather than restating it.
