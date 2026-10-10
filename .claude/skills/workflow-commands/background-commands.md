# A command that can take minutes is issued in the background

## Background the gate and push

- **The clean path folds the region into one backgrounded `pnpm josh ship`** (preflight → gate → `git -y` →
  foreground `followup` → `run:tail`). The calls below serve a due second round.
- Background `pnpm josh gate` beside the review; join it before commit.
- Issue `pnpm josh git -y` in the background; its completion resumes the run, so the turn never ends
  at the push.
- Keep `pnpm josh followup` in the foreground — nearly every following step reads its result.
- **Record before the CI wait ends, never after the merge**: the commit
  carries the observation ledger lines recorded so far, and while CI runs the run makes the records
  that need no CI result — observation Issues, the completion report draft.
- Overlap only tree-readers, and compose merge-independent tail data before `followup` (the table
  below is the full mapping); keep `josh ms`, state checks, next-child selection, lane closing and the
  session-cost check after the merge.
- A lane child's hand-off or pre-gate cut is the sole turn boundary before the push (`chain-rule.md`).

Use harness detachment so completion returns to the run. Foreground timeouts stay within the cap.
Where each rule came from: `docs/maintainers/background-commands-rationale.md` → "Where each rule came from".

## How the wait ends — the task's exit, never a regex over its output

**Background it from the first, then end the turn.** A command issued with `run_in_background` set
re-invokes the run when it exits, and that completion notification is what ends the wait — on the
task's *exit*, not on a regex match and not on the harness block limit. So the moment you background
a long command there is nothing to wait *on*: end the turn, and the wake-up brings you back with the
command finished.

**Never hand-write a `while`/`until` … `sleep` loop over the output file.** The loop does not know
when the command finished: a regex that never matches waits to the block limit, and one that matches
a mid-run line exits too early. `pnpm josh rule:guard` refuses the poll loop and hands back this route
(`prompts/collaboration-workflow/rule-delivery.md`). Rationale:
`docs/maintainers/background-commands-rationale.md` → "Why a poll loop is refused".

**To glance at interim output, `Read` the output file once** — the notification names its path — and
never in a sleep loop. If what you are waiting on is CI, `pnpm josh followup` waits on it for you in
the foreground; a bare `sleep` that arms a progress heartbeat is `run:progress --wait`'s job, refused
in front of a hand-armed timer by `early-heartbeat`.

## The tail and what overlaps each wait

**Never give a foreground call a timeout above the harness cap** — the cap decides how long a
foreground call waits, so a larger number detaches the call without the completion notification.
Rationale: `docs/maintainers/background-commands-rationale.md` → "Why the tail collects idle time".

**The tail is emptied before `followup` is issued, rather than worked through after it returns.**
One question decides each step, and it is asked of the step rather than judged: **does it read the
merge result?**

- **It does — the step stays after `followup`.** `pnpm josh ms`, `pnpm josh issue:state <N>`,
  `pnpm josh epic:next`, `pnpm josh backlog:next --exclude <N>`, and `pnpm josh lane:close` /
  `pnpm josh lane:list`. **De-duplicating a step is not removing it**: none of these may be dropped or
  answered from memory.
- **It does not — the step is composed in the turn that issues `followup`.** The epic progress
  comment's counter *values* and the completion report body (placed beside `pnpm josh git -y` in the
  table below). **Only the write follows the merge.**
- **`pnpm josh cost --cut` stays after the merge, and reads nothing from it** — its answer grows with
  the session, so it keeps its documented seam (`backlogrun-progress.md` → "The check is asked at
  every merge").

**What runs beside a backgrounded command is the work that writes nothing to the working tree** — a
step that edits makes the background command's result stale. Applied to the three waits a run
actually has:

| While this runs | Do this beside it |
| --------------- | ----------------- |
| `pnpm josh gate` | a subagent running `/code-review` with the brief `pnpm josh review:brief` prints |
| `pnpm josh git -y` | Write the completion notification body to a file for `--notify-message-file`, and settle the three-way disposition of any remaining non-High finding |
| CI, after the push | The second review round where one is due, the branch-2 filing through `pnpm josh issue:file`, which runs `epic:bundle` itself (`prompts/review.md` → "Review round cap") |
| `pnpm josh followup` | Nothing — it is foreground and holds the session. **The post-merge tail is what overlaps here, and it is taken before the call rather than beside it**: compose the epic progress counters first, and leave after the merge only the steps that read its result, plus `pnpm josh cost --cut` |

**The turn never ends at the push.** The completion notification for `pnpm josh git -y` is what
resumes the run, and the turn that reads it goes straight through any branch-2 filing and
`pnpm josh epic:bundle` to `pnpm josh followup`. `pnpm josh rule:guard` refuses the foreground push
step and states both halves at that call (`prompts/collaboration-workflow/rule-delivery.md`); the push
reissued detached is not refused again. Rationale: `docs/maintainers/background-commands-rationale.md`
→ "Why the push is guarded".

**One turn does end before the push, and only one: a dispatched lane child's pre-gate cut.** It ends
the turn before the gate and relaunches a fresh process in the same act — `pre-gate-cut.md` → "Taking
the cut" is its single source.

**A headless lane child (`claude -p`) is where "a background command re-invokes the run" does not
hold: its background Bash tasks are killed when its turn ends.** It hands the gate-to-merge region to
a foreground `pnpm josh ship --detach` instead (`chain-rule.md` step 0); `pnpm josh rule:guard` refuses a
backgrounded `josh gate` / `git` / `followup` / `ship` there, and the `Stop` hook sends a child with a
task still running back to wait.

The operational section above is the single source of the rule. `followup.md`, `chain-rule.md` and
`progress-watcher.md` → "Progress while the run is quiet" route here for it rather than restating it.
