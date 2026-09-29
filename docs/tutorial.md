# Tutorial: your first change with an agent

For anyone who has installed kit and wants to see the whole Issue-driven loop once, end to end. You file a small Issue, have an agent plan it, let it implement and verify the change, check the result yourself, and merge it. Each step names the one thing to do and links to the guide or reference that holds the details — this page is the map, not the manual.

## Before you start

- kit is installed and `josh init` has run: [getting-started.md](./getting-started.md) for `static`, [package.md](./package.md) for `node`.
- Use a **practice repository** on GitHub that you are happy to experiment in, with `gh` installed and signed in (`gh auth login`).
- An agent that reads the repository's `CLAUDE.md`, such as Claude Code, is open in the repository.
- Optional: Telegram notifications, so a stopped run reaches you off-screen — [Set up notifications](./how-to/set-up-notifications.md).

## 1. File a small Issue

Pick a change small enough to check by eye — adding one line to the README, or rewording a sentence in it. File it on GitHub, in the web UI or with `gh`:

```bash
gh issue create --title "Add a contact line to the README" --body "The README should end with a line saying where to ask questions."
```

Note the Issue number `#N` it prints. The agent reads the body and its comments, so write what you want to be true when it is done.

## 2. Review the plan with `kickoff`

Type to the agent:

```text
kickoff #N
```

The agent posts a plan on the Issue and stops without touching the code. Read the plan on the Issue; if it is wrong, comment with the correction — a later comment wins over the body. `kickoff`, `halfrun` and `fullrun` are keywords you type to the agent, not `josh` commands: [Run Issues with the workflow keywords](./how-to/run-issues.md) explains each one.

## 3. Implement with `halfrun`, then check it yourself

Type:

```text
halfrun #N
```

The agent implements the change on a branch named after the Issue, runs the verification gate and a self-review, then **stops before committing**. Look at the working tree yourself — `git diff`, and open the changed page or run the changed code. Nothing is committed yet, so you can ask the agent for changes or edit the files yourself.

## 4. Verify with `pnpm josh gate`

```bash
pnpm josh gate
```

It runs the project's checks — lint, type check, spell check and unit tests on `node`; Prettier on `static` — and skips, with a reason, each check the project does not have. A red gate names the failing check; fix it (or ask the agent to) and run the gate again until it is green. On `node`, after you edit a file the gate first asks for the scoped checks on what changed — run `pnpm josh lint:related && pnpm josh test:related`, then the gate. [Fix a failing gate or CI](./how-to/fix-gate-and-ci.md) covers the usual failures, and [`josh gate`](./josh-commands.md#josh-gate) is the reference.

## 5. Commit, open the PR and merge

```bash
pnpm josh git
```

[`josh git`](./josh-commands.md#josh-git) stages the change, writes the commit message, pushes the branch and opens the pull request with the `closes #N` line, so merging closes the Issue. Then either merge the pull request on GitHub once CI is green, or let [`josh followup`](./josh-commands.md#josh-followup) wait for CI and merge it:

```bash
pnpm josh followup "Add a contact line to the README #N"
```

When the loop feels familiar, `fullrun #N` does steps 2–5 in one go, stopping only if something needs you.

## 6. (Optional) Pull in kit's updates with `josh sync`

After upgrading `@joshuafolkken/kit`, run `pnpm josh sync` to refresh the rules and files kit manages. [Update kit](./how-to/update-kit.md) has the steps, and [sync.md](./sync.md) lists what it overwrites.

## Where next

- One guide per task: [how-to.md](./how-to.md).
- A run stopped and you want to continue or clean up: [Recover a stopped run](./how-to/recover-a-run.md).
- Every command: [josh-commands.md](./josh-commands.md).

## Verifying this guide

The loop was checked on this repository with the Issue that added this page ([#2714](https://github.com/joshuafolkken/kit/issues/2714)): the Issue was filed (step 1), and `pnpm josh gate` and `pnpm josh git` ran on its change (steps 4 and 5), driven by `fullrun`, which folds steps 2–5 into one run.

| Environment                                                                      | Status                                                                                   |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| macOS (Darwin 25.6.0), Node.js 25.3.0, pnpm 12.6.0, kit 1.947.0, Claude Code     | Steps 1, 4 and 5 verified — gate green, PR opened by `pnpm josh git` with `closes #2714` |
| The `kickoff` and `halfrun` stops (steps 2 and 3) in a fresh practice repository | Not verified end to end                                                                  |
| Linux and Windows                                                                | Not verified end to end                                                                  |
