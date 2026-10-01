# Tutorial: your first change with an agent

For anyone who has installed kit and wants to see the Issue-driven loop once, end to end. There are two ways to run it: **Pattern A** takes one Issue at a time from plan to merge, and **Pattern B** files several Issues first and then lets the agent work through them unattended. Each step names the one thing to type and links to the guide or reference that holds the details — this page is the map, not the manual.

`kickoff`, `halfrun`, `fullrun` and `backlogrun` are keywords you type to the agent, not `josh` commands; the agent drives `josh` and `gh` for you. [Run Issues with the workflow keywords](./how-to/run-issues.md) explains each one.

## Before you start

- kit is installed and `josh init` has run: [Set up the basic profile](./setup/basic.md) for `basic`, [Set up the full profile](./setup/full.md) for `full`.
- Use a **practice repository** on GitHub that you are happy to experiment in, with `gh` installed and signed in (`gh auth login`).
- An agent that reads the repository's `CLAUDE.md`, such as Claude Code, is open in the repository.
- Optional: Telegram notifications, so a stopped run reaches you off-screen — [Set up notifications](./how-to/set-up-notifications.md).

## Pattern A: one Issue at a time

### 1. Agree the plan with the agent, then `kickoff new`

Do not file the Issue yourself. Talk the change through with the agent first — what should be true when it is done, what is out of scope, how to check it. When the plan is settled, type:

```text
kickoff new
```

The agent files the Issue from the conversation, posts the agreed plan on it and stops without touching the code. Note the Issue number `#N`. If the plan on the Issue is wrong, comment with the correction — a later comment wins over the body.

### 2. (Optional) See the code first with `halfrun`

When you want to look at the change before it is committed — UI work, or anything you would rather check by eye — type:

```text
halfrun #N
```

The agent implements the change, runs the verification gate and a self-review, then **stops before committing**. Look at the working tree yourself — `git diff`, and open the changed page or run the changed code — and ask the agent for changes until you are happy. Skip this step when you do not need to see the code.

### 3. Merge with `fullrun`

Type:

```text
fullrun #N
```

The agent implements the change, runs the gate and the self-review, opens the pull request with the `closes #N` line, waits for CI and merges it. The run ends with the Issue closed and a notification; it stops only when something needs you.

If you ran `halfrun` in step 2, its changes are still uncommitted in the working tree, and `fullrun` will not start on a tree with uncommitted changes. Finish that run with the commit command its stop notification gives instead — it opens the pull request and merges it the same way ([Recover a stopped run](./how-to/recover-a-run.md)).

## Pattern B: many Issues at once

### 1. File the Issues with `kickoff new`

Repeat step 1 of Pattern A for each change: agree the plan with the agent, then type `kickoff new`. A change too large for one Issue is split by the agent into several Issues under an epic, so you may get an epic back instead of a single Issue.

### 2. Opt them in with the `auto-ok` label

Add the `auto-ok` label to each Issue the agent may implement and merge without you — or to the epic, which opts in every Issue under it. Only a person applies this label; the agent never adds it. Create the label once per repository as [`josh auto-ok:next`](./josh-commands.md#josh-auto-oknext) shows.

### 3. Run them all with `backlogrun`

Type:

```text
backlogrun
```

The agent runs every opted-in Issue in dependency order, each one from implementation through the gate, the review and the merge, and notifies you as each finishes. You do not order the Issues or decide which may run side by side: before the first one starts, the agent reads them, records which must land before another as a `blocked-by` relation, and labels `run:solo` any Issue that changes the verification path itself (the gate, the review, the push hook or the merge checks) and `run:lane` every other one. The run then starts a `run:solo` Issue alone, and runs the rest in parallel lanes. An Issue you opt in while the run is going is judged the same way before anything else starts. [Run the backlog unattended](./how-to/run-backlog.md) covers naming Issues to run first, running one epic only, and where the run stops.

## Separately: pull in kit's updates with `josh sync`

Not part of the loop above. After upgrading `@joshuafolkken/kit` in a `full` project, run `pnpm josh sync` to refresh the rules and files kit manages; a `basic` project needs only the upgrade. [Update kit](./how-to/update-kit.md) has the steps, and [sync.md](./sync.md) lists what it overwrites.

## Where next

- One guide per task: [how-to.md](./how-to.md).
- A run stopped and you want to continue or clean up: [Recover a stopped run](./how-to/recover-a-run.md).
- A run fails on the gate or CI: [Fix a failing gate or CI](./how-to/fix-gate-and-ci.md).
- Every command: [josh-commands.md](./josh-commands.md).

## Verifying this guide

The Issue that added this page ([#2714](https://github.com/joshuafolkken/kit/issues/2714)) was run with `fullrun` on this repository, which exercised Pattern A's step 3: the gate went green and the pull request opened with `closes #2714`.

| Environment                                                                   | Status                                                   |
| ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| macOS (Darwin 25.6.0), Node.js 25.3.0, pnpm 12.6.0, kit 1.947.0, Claude Code  | Pattern A step 3 (`fullrun`) verified on this repository |
| Pattern A steps 1–2 (`kickoff new`, `halfrun`) in a fresh practice repository | Not verified end to end                                  |
| Pattern B (`auto-ok` + `backlogrun`) in a fresh practice repository           | Not verified end to end                                  |
| Linux and Windows                                                             | Not verified end to end                                  |
