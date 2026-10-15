# Run the backlog unattended

## When to use it

You have several Issues, or an epic, that an agent may implement and merge without you watching each one. `backlogrun` is the keyword for that; [Run Issues with the workflow keywords](./run-issues.md) covers the single-Issue keywords.

## Steps

1. Opt Issues in by adding the `auto-ok` label yourself ([what each label does](../labels-and-run-states.md)). Add it when the acceptance criteria are concrete, tests and the gate can judge them, and the work needs no open policy decision, external account or human visual check. Leave it off a `release`, `deferred` or `breaking-change` Issue, one that needs `needs-human-review`, and the root of an epic whose children wait on a decision. Every Issue filed through `josh issue:file` is checked against these criteria, including one you asked for with `kickoff new`. Its body declares whether it needs your judgement (`- 人の判断: 不要` or `- 人の判断: 要`). It gets `auto-ok` when it needs none and carries none of the labels above, unless it is filed to another repository ([`josh issue:file`](../josh-commands-backlog.md#josh-issuefile)). Adding it to an epic's root opts in every descendant ([`josh backlog:next`](../josh-commands-backlog.md#josh-backlognext)). `josh start` creates the label, and `josh sync` adds it to a repository that lacks it.
2. For an epic, check it before running: [`josh epic:audit`](../josh-commands-backlog.md#josh-epicaudit) reports contradictions between its children, and [`josh epic:next`](../josh-commands-backlog.md#josh-epicnext) shows which are runnable.
3. Type `backlogrun` to drain the opted-in backlog in dependency order, `backlogrun #N1 #N2` to run named Issues first (they need no label), or `backlogrun #E --only` to run one epic's children and stop. Order and isolation are decided for you: before the first Issue starts, the agent records `blocked-by` between Issues that must land in order and labels `run:solo` each Issue fixing a defect in kit's own verification (the gate, the review, the push hook or the merge checks) that makes unrelated PRs answer wrongly on `main` today, and `run:lane` every other one — improvements, refactors and consumer-side CI fixes included. [`josh backlog:plan`](../josh-commands-backlog.md#josh-backlogplan) shows the result, with `[run:solo]` beside such Issues and `[untriaged]` beside any Issue with neither label, and `josh backlog:plan --waves` shows the order the run will take, wave by wave. A `run:solo` Issue starts only when nothing else is running and nothing starts beside it; the rest run in parallel lanes. The run takes Issues in rank order: `priority:high` first, then a verification-path defect (`bug` with `run:solo`, or `route:interrupt`), then Issues other Issues wait on, then the newest. `run:solo` alone does not move an Issue up. Apply `priority:high` to put an Issue first; the agent applies it only when the Issue or your written policy gives a reason, and only you remove it. You may apply `run:solo` or `run:lane` yourself too. While any candidate has neither label, nothing new starts (`josh backlog:next` answers `triage`) until the agent has judged it — this covers an Issue you opt in mid-run.
   From a terminal, [`pnpm josh backlogrun`](../josh-commands.md#josh-backlogrun) starts the same run in the background and shows its progress board; it takes the same arguments (`pnpm josh backlogrun 3437 --only`) and `--agent codex` to run it in Codex. Write Issue numbers without `#` there: the shell reads an unquoted `#` as the start of a comment and drops the rest of the line. With a run already going it starts nothing and only shows the board — except that an idle run is stopped and replaced when the typed invocation differs from its own. Closing the board leaves the run going; `pnpm josh backlogrun` shows it again.
   To add an Issue to a run that is already going, run [`pnpm josh run:add <N>`](../josh-commands-run.md#josh-runadd): it is taken at the next free lane, ahead of the queue, without stopping a running child. Add `--no-priority` to put it at the end instead.
4. Put `needs-human-review` on any Issue that must not be committed without you: the run implements and verifies it, then stops before the commit ([the label](../labels-and-run-states.md#needs-human-review--the-opposite-label)).

The run's budgets — the 8-hour idle watch and the child limit — are described in [the two budgets](../maintainers/backlogrun-driver.md#the-two-budgets).

## Check it worked

- `josh backlog:next` answers `none` once nothing opted in is left.
- Each finished Issue is closed with a merged pull request and a notification.

## Common failures

- An Issue is never picked up: it lacks `auto-ok` and is not under an opted-in epic, or it waits on an open dependency or a `run:solo` Issue (`josh backlog:next` answers `wait` and says which).
- The run stops early: it stops at 30 children, 10 filed Issues or 3 consecutive child failures, and on a `needs-human-review` Issue ([where the run stops](../maintainers/backlogrun-driver.md#where-the-run-stops)).
- The session was cut part-way: see [Recover a stopped run](./recover-a-run.md).
