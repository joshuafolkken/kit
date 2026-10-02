# @joshuafolkken/kit

A development toolkit for AI-assisted work. One command gives an AI assistant (Claude Code, Codex, Gemini, Cursor) the project's rules, formatting and checks. With `kickoff`, `fullrun` and `backlogrun`, the agent then takes a GitHub Issue through plan → implement → verify → PR → merge, the same way in every project. Why kit exists: [why.md](./docs/why.md) (Japanese).

## What your project gets

kit picks a [profile](./docs/init.md#project-profiles) from one question — does the project use Node tooling?

| Your project                             | Profile | What you get                                                      |
| ---------------------------------------- | ------- | ----------------------------------------------------------------- |
| Node project (JavaScript / TypeScript)   | `full`  | The full set: ESLint, type check, unit and E2E tests, Git hooks   |
| HTML / CSS (browser JavaScript included) | `basic` | Formatting (Prettier), AI assistant files, Git / VS Code settings |
| Another language (Python, Rust, Go, …)   | `basic` | AI assistant files and Git / VS Code settings only                |

In a `basic` project, `josh` skips each check that has nothing to run and says why.

## Quick start

Requires [Node.js](https://nodejs.org/) 22.19.0+ and [pnpm](https://pnpm.io/) 12+ ([how to install them](./docs/setup/basic.md#1-check-the-prerequisites)). `josh start` also requires the [gh CLI](https://cli.github.com/). Run in your project directory.

Pick by one question: will the project use the GitHub Issue workflow (`kickoff`, `fullrun`, `backlogrun`)?

### With the GitHub Issue workflow

```bash
pnpm add -D --allow-build=esbuild --allow-build=unrs-resolver @joshuafolkken/kit
pnpm exec josh start
```

`josh start` creates the Git and GitHub repositories if missing. If `main` already has commits, it opens a pull request with only kit's files for you to merge.

### Without the GitHub Issue workflow

```bash
pnpm --allow-build=esbuild dlx @joshuafolkken/kit init
pnpm josh gate
```

Details: [what each command does in each starting state](./docs/init.md#josh-init-or-josh-start) · step by step: [basic profile](./docs/setup/basic.md) · [full profile](./docs/setup/full.md).

## Documentation

**Set up**

- [setup/basic.md](./docs/setup/basic.md) — a `basic` project, from an empty machine
- [setup/full.md](./docs/setup/full.md) — a Node project, with `josh init` or `josh start`
- [cli.md](./docs/cli.md) — the global `josh` command
- [troubleshooting.md](./docs/troubleshooting.md) — install and auth errors

**Use**

- [overview.md](./docs/overview.md) — what kit sets up and how it works
- [tutorial.md](./docs/tutorial.md) — your first change with an agent, from Issue to merge
- [how-to.md](./docs/how-to.md) — guides by task

**Commands and configuration**

- [josh-commands.md](./docs/josh-commands.md) — every `josh` command ([catalog](./docs/josh-command-catalog.md))
- [init.md](./docs/init.md) — what `josh init` creates
- [sync.md](./docs/sync.md) — what `josh sync` updates
- [manual-config.md](./docs/manual-config.md) — the presets without `josh init`
- [package-api.md](./docs/package-api.md) — the package's exports

**AI workflow and operations**

- [scripts-ai.md](./docs/scripts-ai.md) — Issue workflow commands and Telegram notifications
- [cloud-session.md](./docs/cloud-session.md) — running in an agent container
- [eval.md](./docs/eval.md) — measuring rule adherence
- [authentication.md](./docs/authentication.md) — existing GitHub Packages installs only

## Contributing

Conventions are in [CLAUDE.md](./CLAUDE.md), releases in [publishing.md](./docs/publishing.md). See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) and [SECURITY.md](./SECURITY.md); maintainer records are in [docs/maintainers/](./docs/maintainers/).

## License

[MIT](./LICENSE)
