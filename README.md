# @joshuafolkken/kit

**AI assistant setup, plus an optional GitHub workflow.**

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

Tell the agent the change you want, then type `kickoff new` to it. The Issue gets the `auto-ok` label when it needs no judgement from you (or add the label to an existing Issue).

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

- **Files written:** settings per profile, including Prettier — always on `full`, and on `basic` only when the project has web files and no formatter of its own ([per profile](./docs/init.md#project-profiles)); `--dry-run` previews them.
- **Overwritten by `josh sync`:** the managed files, such as `.github/workflows/ci.yml` and `AGENTS.md` ([the list](./docs/sync.md#ai-files-overwritten)).
- **Permissions:** the Claude Code settings kit writes (with `josh start`, or on `full`) set `bypassPermissions` with `Bash(*)`, guarded by a deny list and a hook ([how to opt out](./docs/init.md#claude-code-permission-mode)).
- **On GitHub:** `josh start` adds labels, and on an existing `main` an Issue and a setup PR that you merge yourself ([the steps](./docs/init.md#josh-init-or-josh-start)).

## Claude Code in a fresh-machine run

A `josh fresh:run` scenario that runs Claude Code needs a sign-in saved once with `pnpm josh auth:setup` ([steps](./docs/maintainers/fresh-machine.md#claude-code)).

## Docs

[How-to](./docs/how-to.md) · [All docs](./docs/overview.md)

[app-kit](https://github.com/joshuafolkken/app-kit) · [game-kit](https://github.com/joshuafolkken/game-kit) · [Releases](https://github.com/joshuafolkken/kit/releases) · [Contributing](./docs/maintainers/README.md)
