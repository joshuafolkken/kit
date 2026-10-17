# @joshuafolkken/kit

**Hand it off. Walk away. Come back to done.**

Not "almost done" — tested, checked, finished.

kit gives Claude Code or Codex your project's rules and checks.

## The workflow

`backlogrun` takes your Issues to merged PRs — in parallel, unattended:

![The backlogrun board: ten Issues in one run, three already merged and the rest moving through their stages or waiting for a free lane, with recent findings and decisions below](./docs/images/backlogrun-board.png)

[Every keyword, including the ones that stop for you earlier](./docs/how-to/run-issues.md)

## Sound familiar?

[The whole story](./docs/why.md)

- [I keep repeating the same instructions](./docs/why.md#i-keep-repeating-the-same-instructions)
- [The agent does things I never asked for](./docs/why.md#the-agent-does-things-i-never-asked-for)
- [Wiring AI up to GitHub is a chore](./docs/why.md#wiring-ai-up-to-github-is-a-chore)
- [Done doesn't mean done](./docs/why.md#done-doesnt-mean-done)

## Quick start

Pick one setup ([A or B: what differs](./docs/setup/choose.md)):

### A. With GitHub — Issues, PRs and unattended runs

Requires [Node.js, pnpm and the gh CLI](./docs/setup/prerequisites.md).

```bash
gh auth login # once
pnpm add -D --allow-build=esbuild --allow-build=unrs-resolver @joshuafolkken/kit
pnpm exec josh start
```

Next: [tutorial](./docs/tutorial.md)

#### Your first backlogrun

File Issues with `kickoff new`, then run:

```bash
pnpm josh backlogrun
```

Details: [Run the backlog unattended](./docs/how-to/run-backlog.md)

### B. Without GitHub — AI assistant only

Requires [Node.js and pnpm](./docs/setup/prerequisites.md).

```bash
pnpm --allow-build=esbuild dlx @joshuafolkken/kit init
```

Next: [tutorial](./docs/tutorial.md#without-github-one-change-checked-locally)

### Adding kit to an existing project

Check first: [what kit changes in your project](./docs/how-to/add-kit.md#what-kit-changes-in-your-project)

## Docs

[How-to](./docs/how-to.md) · [All docs](./docs/overview.md)

[app-kit](https://github.com/joshuafolkken/app-kit) · [game-kit](https://github.com/joshuafolkken/game-kit) · [Releases](https://github.com/joshuafolkken/kit/releases) · [Contributing](./docs/maintainers/README.md)
