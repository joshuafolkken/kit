# Labels and run states

The labels you put on an Issue to steer the agent, the labels a run puts on it for you, and the states a run reads off an Issue to decide where it starts. The procedures behind them are in the [`workflow-commands` skill](../.claude/skills/workflow-commands/SKILL.md); this page is for the person running the agent.

## Labels you apply

| Label                | What it does                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `auto-ok`            | Opts the Issue in to unattended work. On an epic's root it opts in every descendant. See [Run the backlog](./how-to/run-backlog.md). |
| `needs-human-review` | Implement and verify, then stop before the commit — [below](#needs-human-review--the-opposite-label).                                |
| `priority:high`      | Puts the Issue first in the backlog's order. Only you remove it.                                                                     |
| `run:solo`           | Runs the Issue alone, with nothing else started beside it. The agent applies it to a defect in kit's own verification.               |
| `run:lane`           | Lets the Issue run in a parallel lane beside others. The agent applies it to every other opted-in Issue.                             |

## Labels a run applies

| Label            | What it means                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `in-progress`    | A run holds a working tree for this Issue. Remove a stale one only once the tree is clean ([Recover a stopped run](./how-to/recover-a-run.md)). |
| `needs-decision` | The run parked the Issue: it waits for your answer and the backlog skips it until you give one.                                                 |
| `already-done`   | The work is already merged — [below](#already-done--the-exit-for-work-that-is-already-merged).                                                  |
| `epic`           | The Issue tracks child Issues and the order they land in.                                                                                       |

### `needs-human-review` — the opposite label

The inverse of `auto-ok`: implemented and taken through the verification gate as usual, then nothing is committed, pushed, opened as a PR or merged — the working tree is left uncommitted, a `confirmation` notification carries the resume command, and the run stops. For work no test can judge. Only a person applies or removes it.

```bash
gh api repos/{owner}/{repo}/labels -f name=needs-human-review -f color=d93f0b -f description="Implement and verify, but stop before committing so a person can look"
```

Single source: [`.claude/skills/workflow-commands/needs-human-review.md`](../.claude/skills/workflow-commands/needs-human-review.md).

### `already-done` — the exit for work that is already merged

The exit for a run that verifies its issue's work is already in `main`: nothing to implement, and it cannot close the issue (Tier C). Not `needs-decision` — that waits for an answer; this one has its answer and only the close is outstanding. A run applies it; only a person removes it, by closing the issue.

```bash
gh api repos/{owner}/{repo}/labels -f name=already-done -f color=6f42c1 -f description="Verified already merged — a person closes it"
```

Procedure: [`.claude/skills/workflow-commands/issue-comments.md`](../.claude/skills/workflow-commands/issue-comments.md).

## Run states

A run reads one of these states off the Issue to decide where it starts, so nothing already done is redone. Which keyword starts where from each state is the table in [Run Issues with the workflow keywords](./how-to/run-issues.md#going-up-the-ladder-a-stage-at-a-time).

| State             | What it means                                                                    |
| ----------------- | -------------------------------------------------------------------------------- |
| `fresh`           | Nothing has run yet.                                                             |
| `planned`         | A `kickoff` posted the plan; the Issue carries the `run:planned` label.          |
| `halfrun-stopped` | A `halfrun` implemented and verified the change and left it uncommitted for you. |
| `prrun-stopped`   | A `prrun` opened a green, mergeable pull request and left the merge to you.      |
| `merged`          | The Issue is closed; the work is in the default branch.                          |

How each state is read is in [`josh run:entry`](./josh-commands-run.md#josh-runentry).
