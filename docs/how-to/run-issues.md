# Run Issues with the workflow keywords

## When to use it

You want an agent to take a GitHub Issue from plan to merge. You type a keyword to the agent — `kickoff`, `halfrun`, `prrun`, `fullrun` or `backlogrun` — followed by `#N` for an existing Issue or `new` for one it should file. These are not `josh` commands; the agent drives `josh` for you.

## Which keyword

| Keyword      | What the agent does                                                                                                        | Use it when                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `kickoff`    | Writes the plan on the Issue — with `new`, files the Issue from the conversation first — and stops                         | You want to review the approach before any code           |
| `halfrun`    | Implements, runs the gate and a self-review, then stops before committing                                                  | A person has to look at the result first, such as UI work |
| `prrun`      | Runs `fullrun` up to a green, mergeable pull request and stops before merging                                              | A person merges by hand                                   |
| `fullrun`    | Writes the plan when the Issue has none, implements, runs the gate and a self-review, opens the pull request and merges it | The change can ship once the gate and review pass         |
| `backlogrun` | Runs the Issues you name, in order (an epic runs its children), then the opted-in backlog                                  | You want several Issues or an epic done without watching  |

This table is the single description of the keywords; the README and the [tutorial](../tutorial.md) summarize it. The agent starts one only when you type the keyword yourself; asking it to "implement X" does not start a run. The procedures are in the [`workflow-commands` skill](../../.claude/skills/workflow-commands/SKILL.md).

## Steps

1. Make sure `gh` is installed and signed in, and set up notifications as [Set up notifications](./set-up-notifications.md) describes.
2. Type the keyword with the Issue number, for example `fullrun #123`.
3. After a `kickoff` or `halfrun` stop, review the plan or the working tree, then type the next keyword or the commit command the notification gives you. After a `prrun` stop, merge the pull request by hand (or not), then type `fullrun #N` — or run the `josh followup` command the notification gives you — to finish the post-merge tail.

## Going up the ladder a stage at a time

`kickoff` → `halfrun` → `prrun` → `fullrun` is a ladder: the keyword you type decides only how far the run goes, and where it starts is read off the Issue, so nothing already done is redone. A keyword whose stopping point the Issue has already reached reports that and stops.

| Issue state       | `kickoff`                 | `halfrun`                            | `prrun`                         | `fullrun`                 |
| ----------------- | ------------------------- | ------------------------------------ | ------------------------------- | ------------------------- |
| `fresh`           | plan → plan posted        | plan → gated, before the commit      | plan → green, mergeable PR      | plan → merged             |
| `planned`         | reached — report and stop | implement → gated, before the commit | implement → green, mergeable PR | implement → merged        |
| `halfrun-stopped` | reached — report and stop | reached — report and stop            | gate → green, mergeable PR      | gate → merged             |
| `prrun-stopped`   | reached — report and stop | reached — report and stop            | reached — report and stop       | followup → merged         |
| `merged`          | reached — report and stop | reached — report and stop            | reached — report and stop       | reached — report and stop |

Each stop's notification lists the keywords further up, nearest first. How each state is read is in [`josh run:entry`](../josh-commands-run.md#josh-runentry).

## Check it worked

- A merged run ends with the Issue closed and a notification. [`josh followup`](../josh-commands-automation.md#josh-followup) exits non-zero and names the failing check when it cannot merge.

## Common failures

- A run stops on an Issue labelled `needs-human-review`: that is intended — see [the label](../josh-commands-automation.md#needs-human-review--the-opposite-label).
- A run exits early because the work is already merged: see [`already-done`](../josh-commands-automation.md#already-done--the-exit-for-work-that-is-already-merged).
- The gate or CI fails: [Fix a failing gate or CI](./fix-gate-and-ci.md).
