# Tutorial: your first change with an agent

For anyone who has installed kit and wants to see the Issue-driven loop once, end to end. There are two ways to run it: **Pattern A** takes one Issue at a time from plan to merge, and **Pattern B** files several Issues first and then lets the agent work through them unattended. Each step names the one thing to type and links to the guide or reference that holds the details — this page is the map, not the manual.

`kickoff`, `halfrun`, `prrun`, `fullrun` and `backlogrun` are keywords you type to the agent, not `josh` commands; the agent drives `josh` and `gh` for you. [Run Issues with the workflow keywords](./how-to/run-issues.md) explains each one.

Not using GitHub? Both patterns need it — go to [Without GitHub: one change, checked locally](#without-github-one-change-checked-locally).

## Before you start

- kit is set up with `josh start`, and its setup is on `main` — merge the setup pull request it opened, if it opened one ([init.md → `josh init` or `josh start`](./init.md#josh-init-or-josh-start)). The profile guides walk through it: [Set up the basic profile](./setup/basic.md) for `basic`, [Set up the full profile](./setup/full.md) for `full`.
- Use a **practice repository** on GitHub that you are happy to experiment in, with `gh` installed and signed in (`gh auth login`).
- An agent that reads the repository's `CLAUDE.md`, such as Claude Code, is open in the repository.
- Telegram notifications are set up, so a stopped run reaches you off-screen — or turned off with `JOSH_NOTIFY=off` in `.env`. Without either, `josh notify` exits non-zero ([Set up notifications](./how-to/set-up-notifications.md)).

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

The agent writes the plan on the Issue if it has none (the one `kickoff new` filed already does), implements the change, runs the gate and the self-review, opens the pull request with the `closes #N` line, waits for CI and merges it. The run ends with the Issue closed and a notification; it stops only when something needs you.

To merge the pull request by hand instead, type `prrun #N`: it goes as far as a green, mergeable pull request and stops there ([Run Issues with the workflow keywords](./how-to/run-issues.md)).

If you ran `halfrun` in step 2, its changes are still uncommitted in the working tree. Type `fullrun #N` all the same: it picks the stopped `halfrun` up from the gate, skipping the plan and the implementation, and ships the change you checked. Without an agent, the commit command in the stop notification finishes that run instead of `fullrun #N` or `prrun #N` ([Recover a stopped run](./how-to/recover-a-run.md)).

## Pattern B: many Issues at once

### 1. File the Issues with `kickoff new`

Repeat step 1 of Pattern A for each change: agree the plan with the agent, then type `kickoff new`. A change too large for one Issue is split by the agent into several Issues under an epic, so you may get an epic back instead of a single Issue.

### 2. Opt them in with the `auto-ok` label

Add the `auto-ok` label to each Issue the agent may implement and merge without you — or to the epic, which opts in every Issue under it. The agent never adds it to an Issue you filed; an Issue it files while working on an opted-in one inherits it unless the new Issue needs your judgement. Create the label once per repository as [`josh auto-ok:next`](./josh-commands-backlog.md#josh-auto-oknext) shows.

### 3. Run them all with `backlogrun`

Type:

```text
backlogrun
```

The agent runs every opted-in Issue in dependency order, each one from implementation through the gate, the review and the merge, and notifies you as each finishes. You do not order the Issues or decide which may run side by side: before the first one starts, the agent reads them, records which must land before another as a `blocked-by` relation, and labels `run:solo` any Issue fixing a defect in kit's own verification (the gate, the review, the push hook or the merge checks) that makes unrelated PRs answer wrongly on `main` today, and `run:lane` every other one. The run then starts a `run:solo` Issue alone, and runs the rest in parallel lanes. An Issue you opt in while the run is going is judged the same way before anything else starts. [Run the backlog unattended](./how-to/run-backlog.md) covers naming Issues to run first, running one epic only, and where the run stops.

## Separately: pull in kit's updates with `josh sync`

Not part of the loop above. After upgrading `@joshuafolkken/kit`, run `pnpm josh sync` to refresh the rules and files kit manages; it writes only the file set of the project's profile. [Update kit](./how-to/update-kit.md) has the steps, and [sync.md](./sync.md) lists what it overwrites.

## Without GitHub: one change, checked locally

For a project set up with `josh init` and no GitHub. The workflow keywords above need GitHub, so do not type them — ask in plain words. What `josh init` set up: [TypeScript projects](./setup/full.md#2-install-and-initialize-with-josh-init) · [other projects](./setup/basic.md).

1. Open an agent that reads the project's `CLAUDE.md`, such as Claude Code, in the project directory.
2. Ask for one small change:

   ```text
   Change the page title to "Hello", then tell me what you checked.
   ```

3. The agent reads the file before changing it, makes the change, checks it and reports what it saw. In a `full` profile project it also adds a test where one fits, runs `pnpm josh gate`, and reports which checks passed and which did not.
4. Check it yourself: run `pnpm josh gate` ([what it checks and skips](./setup/basic.md#3-verify)), and open the page in a browser when the change is visible.

   In a `full` profile project with no Git repository, lint stops on a missing `.gitignore` before it reads your code. Create an empty one first, then run the gate again:

   ```bash
   touch .gitignore
   ```

Want Issues, pull requests and merges handled too? Run `pnpm exec josh start` ([init.md → `josh init` or `josh start`](./init.md#josh-init-or-josh-start)), then follow Pattern A.

## Where next

- One guide per task: [how-to.md](./how-to.md).
- A word on this page you did not recognize: [glossary.md](./glossary.md).
- A run stopped and you want to continue or clean up: [Recover a stopped run](./how-to/recover-a-run.md).
- A run fails on the gate or CI: [Fix a failing gate or CI](./how-to/fix-gate-and-ci.md).
- Every command: [josh-commands.md](./josh-commands.md).
