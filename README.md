# @joshuafolkken/kit

A development toolkit that sets up a repository for AI-assisted work with one command. `josh init` gives an AI assistant (Claude Code, Codex, Gemini, Cursor) the project's rules, and the `josh` CLI runs the checks and the Git / GitHub Issue workflow the same way in every project. You stop copying config between repositories and re-explaining conventions to the assistant.

## What your project gets

kit does not branch by language. It asks one question — does the project use Node tooling? — and picks a [profile](./docs/init.md#project-profiles):

| Your project                             | Profile  | What you get                                                      |
| ---------------------------------------- | -------- | ----------------------------------------------------------------- |
| Node project (JavaScript / TypeScript)   | `node`   | The full set: ESLint, type check, unit and E2E tests, Git hooks   |
| HTML / CSS (browser JavaScript included) | `static` | Formatting (Prettier), AI assistant files, Git / VS Code settings |
| Another language (Python, Rust, Go, …)   | `static` | AI assistant files and Git / VS Code settings only                |

kit adds no linter or test runner for languages other than JavaScript and TypeScript; in a `static` project, `josh` skips each check that has nothing to run and says why.

## Quick start

In your project directory:

```bash
pnpm add -D --allow-build=esbuild @joshuafolkken/kit
pnpm exec josh init
pnpm install
pnpm josh format
pnpm josh gate
```

It needs [Node.js](https://nodejs.org/) 22.19.0 or later with [pnpm](https://pnpm.io/), even for a `static` project; [getting-started.md](./docs/getting-started.md) installs both. The global `josh` command ([cli.md](./docs/cli.md)) and the [gh CLI](https://cli.github.com/) for `josh version` and the GitHub Issue workflow are optional.

## Documentation

**Get started**

- [getting-started.md](./docs/getting-started.md) — first install for an `index.html` site or a non-Node project (`static`)
- [package.md](./docs/package.md) — add kit to a Node project (`node`)
- [tutorial.md](./docs/tutorial.md) — your first change with an agent, from Issue to merge
- [how-to.md](./docs/how-to.md) — step-by-step guides by task: update, release, run Issues, fix a failing gate

**Understand kit**

- [why.md](./docs/why.md) — the problems kit exists to solve
- [overview.md](./docs/overview.md) — what kit sets up and how it works

**Commands and configuration**

- [cli.md](./docs/cli.md) — install the global `josh` command
- [josh-commands.md](./docs/josh-commands.md) — every `josh` command ([catalog](./docs/josh-command-catalog.md))
- [init.md](./docs/init.md) — what `josh init` creates, per profile
- [sync.md](./docs/sync.md) — what `josh sync` updates after an upgrade
- [manual-config.md](./docs/manual-config.md) — use the presets without `josh init`
- [package-api.md](./docs/package-api.md) — the config presets and libraries the package exports

**AI workflow and operations**

- [scripts-ai.md](./docs/scripts-ai.md) — Telegram notifications and the Issue workflow commands
- [cloud-session.md](./docs/cloud-session.md) — running in an agent container
- [eval.md](./docs/eval.md) — measuring whether the agent rules are followed
- [troubleshooting.md](./docs/troubleshooting.md) — install and auth errors
- [authentication.md](./docs/authentication.md) — existing GitHub Packages installs only

## Contributing

Community standards live in [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md); security reports go through [SECURITY.md](./SECURITY.md). Development conventions are in [CLAUDE.md](./CLAUDE.md); releases are in [publishing.md](./docs/publishing.md), and maintainer records in [docs/maintainers/](./docs/maintainers/).

## License

[MIT](./LICENSE)
