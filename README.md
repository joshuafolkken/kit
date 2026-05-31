# @joshuafolkken/kit

Shared toolchain config and CLI for TypeScript / SvelteKit projects — ESLint, Prettier, TypeScript, Lefthook, cspell, VS Code, and AI assistant files (CLAUDE.md, AGENTS.md, GEMINI.md), wired together.

- **`josh` CLI** — lint, format, type-check, git workflow, versioning, and security auditing from any directory.
- **Project config package** — ESLint / Prettier / tsconfig presets, prompts, and scripts consumed as a devDependency.

## Prerequisites

- [Node.js](https://nodejs.org/) with [pnpm](https://pnpm.io/)
- [gh CLI](https://cli.github.com/) — required for GitHub Packages authentication. Install via `brew install gh` (macOS), `winget install GitHub.cli` (Windows), or see the [gh installation docs](https://github.com/cli/cli#installation).

## Quick start

```bash
gh auth login --scopes read:packages   # see docs/authentication.md for the full setup
pnpm add -g @joshuafolkken/kit          # install the josh CLI globally
josh help
```

Using the kit inside a project? See [docs/package.md](./docs/package.md).

## Documentation

| Guide                                           | What it covers                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------- |
| [authentication.md](./docs/authentication.md)   | One-time GitHub Packages auth — `gh` token, `NODE_AUTH_TOKEN`, `.npmrc`          |
| [cli.md](./docs/cli.md)                         | Install and use the global `josh` CLI                                            |
| [package.md](./docs/package.md)                 | Use the kit as a project devDependency — configs, prompts, scripts, `josh init`  |
| [josh-commands.md](./docs/josh-commands.md)     | Full `josh` CLI command reference                                                |
| [overview.md](./docs/overview.md)               | What the kit provides and how it works                                           |
| [troubleshooting.md](./docs/troubleshooting.md) | `401`/`404` auth errors, `josh: command not found`, stale shim, version mismatch |

## Contributing

Community standards live in [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md); security reports go through [SECURITY.md](./SECURITY.md). Development conventions are documented in `CLAUDE.md`, `AGENTS.md`, and `GEMINI.md`.

## License

MIT
