# Labels and run states

Issue labels and entry states. Procedures: [`workflow-commands`](../.claude/skills/workflow-commands/SKILL.md).

## Labels you apply

| Label                | What it does                                                                                                                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auto-ok`            | Opts the Issue in to unattended work. On an epic's root it opts in every descendant. See [Run the backlog](./how-to/run-backlog.md).                                                                                       |
| `needs-human-review` | Implement and verify, then stop before the commit — [below](#needs-human-review--the-opposite-label).                                                                                                                      |
| `needs-human-merge`  | PR open: workflow changes require a person to read the diff and merge on GitHub. `backlogrun` treats an OPEN child as human waiting, with no failure or stalled count; after merge closes the Issue, it advances normally. |
| `priority:critical`  | Puts the Issue first in the backlog's order. Applied at filing from the body's `- 優先度:` declaration; only you remove it.                                                                                                |
| `priority:high`      | Puts the Issue next, after `priority:critical`. Applied at filing the same way; only you remove it.                                                                                                                        |
| `deferred`           | Sets the Issue aside for now: it never gets `auto-ok` at filing or from the agent's judgement.                                                                                                                             |
| `run:solo`           | Runs the Issue alone, with nothing else started beside it. The agent applies it to a defect in kit's own verification that answers wrongly on every run.                                                                   |
| `run:lane`           | Lets the Issue run in a parallel lane beside others. The agent applies it to every other opted-in Issue.                                                                                                                   |

## Labels a run applies

| Label            | What it means                                                                                                                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `in-progress`    | A run holds a working tree for this Issue. Remove a stale one only once the tree is clean ([Recover a stopped run](./how-to/recover-a-run.md)).                                                                               |
| `needs-decision` | The run parked the Issue for your answer, including a child ending with a question or confirmation notification. The backlog skips it; the wait does not increase consecutive failures.                                       |
| `run:stalled`    | A mechanical failure parked it (`session unfinished`: no question or confirmation found). Fix the cause, then `pnpm josh run:add N --retry` in a live backlogrun, else `fullrun #N`. An open blocker shows `waiting on #<B>`. |
| `already-done`   | The work is already merged — [below](#already-done--the-exit-for-work-that-is-already-merged).                                                                                                                                |
| `measured`       | A measurement-only Issue a run closed itself with `josh issue:measured`: the result is commented on it, and no pull request was needed.                                                                                       |
| `measured:unmet` | Set with `measured` by `josh issue:measured --unmet`: the measurement fell short of the expected effect it checked. `josh effect:audit` reads it.                                                                             |
| `epic`           | The Issue tracks child Issues and the order they land in.                                                                                                                                                                     |

A live backlogrun retries a `run:stalled` park itself — a `followup` stop once its PR is mergeable and green, `yield cap` after its 15-minute window, `session unfinished`, `cut not relaunched` and `stale hand-off` on the next sweep — 2 times per Issue across driver restarts; then its row shows `auto-retry cap 2 reached — <cause>`. Any other park, or one at the cap, waits for `run:add N --retry`.

### `needs-human-review` — the opposite label

The inverse of `auto-ok`: implemented and taken through the verification gate as usual, then nothing is committed, pushed, opened as a PR or merged — the working tree is left uncommitted, a `confirmation` notification carries the resume command, and the run stops. For work no test can judge. Only a person applies or removes it.

```bash
gh api repos/{owner}/{repo}/labels -f name=needs-human-review -f color=d93f0b -f description="Implement and verify, but stop before committing so a person can look"
```

Single source: [`.claude/skills/workflow-commands/needs-human-review.md`](../.claude/skills/workflow-commands/needs-human-review.md).

### `already-done` — the exit for work that is already merged

The exit for a run that verifies its issue's work is already in `main`. `josh issue:already-done` applies it, then closes the issue as `completed` when a cited pull request reads back as merged; the label stays on the closed issue.

Any other evidence leaves it OPEN with the label and prints why. Not `needs-decision` — it has its answer; a person closes it.

```bash
gh api repos/{owner}/{repo}/labels -f name=already-done -f color=6f42c1 -f description="Verified already merged — a person closes it"
```

Procedure: [`.claude/skills/workflow-commands/issue-comments.md`](../.claude/skills/workflow-commands/issue-comments.md).

## Run states

| Board icon | Meaning                                                                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔏         | An OPEN Issue carrying `needs-human-merge` awaits a human merge. The row ends `→ merge PR #<P>`, `→ find its PR for #<N>` when no open PR pairs, or nothing if unread. |

A run starts from the Issue's state. Keyword entry points: [Run Issues](./how-to/run-issues.md#going-up-the-ladder-a-stage-at-a-time).

| State             | What it means                                                                    |
| ----------------- | -------------------------------------------------------------------------------- |
| `fresh`           | Nothing has run yet.                                                             |
| `planned`         | A `kickoff` posted the plan; the Issue carries the `run:planned` label.          |
| `halfrun-stopped` | A `halfrun` implemented and verified the change and left it uncommitted for you. |
| `prrun-stopped`   | A `prrun` opened a green, mergeable pull request and left the merge to you.      |
| `merged`          | The Issue is closed; the work is in the default branch.                          |

How each state is read is in [`josh run:entry`](./josh-commands-run.md#josh-runentry).

A cut's `handed-off` verdict stops a second resume. After stopping and releasing the adopter to
wait or park, `run:merge` makes the cut resumable again, with the usual tree verification.
A failed stop leaves the adoption protected.
