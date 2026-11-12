# Observation flush and recovery

For kit maintainers.

Run `pnpm josh observations:flush` from the primary checkout on the default branch.
The command refuses unrelated changes or staged changes without modifying them.

It carries, migrates, archives, stages, commits and lands the PR in a dedicated worktree,
without using the source index. Only index.lock conflicts are retried, up to five attempts
at 250ms intervals. Another writer's lock is never deleted.

## After failure or interruption

1. Save the `observations recovery: <path>` from the error.
   It points to `josh/observation-flush/state.json` under the source checkout's Git directory.
   `tree` names the dedicated worktree; `files` holds the initial records and their base contents.
2. Rerun the same command from the source checkout. An interrupted archive is rebuilt from the
   saved initial state. The previous attempt's ledger remains in the same directory under `attempt-*`.
   A prepared payload resumes staging; a committed payload resumes publication of the same commit.
3. If index.lock persists, wait for its owner to finish. Do not delete the lock or pop/drop a stash.
   Rerun the command after a cleanup failure too.

The source ledger remains untouched until landing is confirmed. After landing, only the saved
portion returns to its base contents; later appends and new files remain. An independent edit
stops recovery. Reconciliation is saved before source cleanup so an interruption can be retried.

Completed snapshots remain at `state.json.completed-<branch suffix>`.
If the subsequent `main:sync` conflicts with a new append, compare the published PR and completed
snapshot before resolving it. Do not reset away the writer's additions.

## The observations archive recovery stash

Identify the stash by its message and object ID rather than its current number.

```sh
git stash list --format='%H %s'
git rev-parse origin/main
git ls-tree -r --name-only '<stash>^3' -- .josh/observations
git diff --no-ext-diff --unified=0 '<stash>^1' '<stash>' -- .josh/observations
```

Compare read-only and preserve the occurrence count of repeated lines.

1. Collect deleted lines from the diff between the stash's first parent and the stash itself.
   Exclude diff headers.
2. Subtract those lines, with their occurrence counts, from all monthly archives in the third parent.
   Confirm that no original record is missing; the remainder is the additional records.
3. Add those additional records to all ledger `.md` lines in the first parent and compare the result
   with all ledger lines on current main, preserving occurrence counts. File moves are not missing
   records. Do not use `sort -u`.
4. If records are missing, extract only the missing occurrences of additional records, preserving
   their original archive month and order. Do not reapply whole archives. Inspect the required patch
   before saving it through the safe flush path.
5. Compare `archived-comment-rounds.txt` with existing `<issue>-comment-rounds.md` files.
   Do not restore all markers: a marker for an issue whose source file remains would incorrectly
   suppress the next carry. Recover only markers whose records are saved and source files are absent.
6. After recovery, confirm zero missing original records, zero missing additional records and zero
   increases beyond the required occurrences. Confirm the same object ID remains with
   `git stash list --format='%H %s'`.

Read-only comparison on 2026-11-12:
stash `1a8584ee872a7ef7cbb204b238e466907c1896d2`,
main `448bb28e674838b18157605d9dc4b07690d84bf7`.

There were 12,177 deleted source lines, 12,213 stash archive lines, no missing original records
and 36 additional lines. Main held every original and additional record, so no recovery patch
was needed. The stash object ID remained present; no pop/drop was performed.
