# @joshuafolkken/kit

Shared toolchain config for TypeScript / SvelteKit projects.

Covers: ESLint · Prettier · TypeScript · Lefthook · cspell · VS Code · AI files (CLAUDE.md, AGENTS.md, GEMINI.md)

See [docs/overview.md](./docs/overview.md) for a full description of what this package provides and how it works.

## Prerequisites

- [Node.js](https://nodejs.org/) with [pnpm](https://pnpm.io/)
- [gh CLI](https://cli.github.com/) — required for GitHub Packages authentication. Install via `brew install gh` (macOS), `winget install GitHub.cli` (Windows), or see the [gh installation docs](https://github.com/cli/cli#installation).

## Quick start

**1. Authenticate** — GitHub Packages requires auth even for public packages:

**bash / zsh (macOS, Linux):**

```bash
export NODE_AUTH_TOKEN=$(gh auth token)
```

**PowerShell (Windows):**

```powershell
$env:NODE_AUTH_TOKEN = (gh auth token)
```

If `gh auth token` fails or you get a 401, re-authenticate: `gh auth login --scopes read:packages`

**2. Install** — add both lines to `.npmrc`, then install (after `josh init` these are managed automatically):

```ini
@joshuafolkken:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

```bash
pnpm add -D @joshuafolkken/kit
```

**3. Initialize** — run once after installing:

```bash
pnpm exec josh init
```

Auto-detects SvelteKit vs vanilla and creates or merges all config files. See [docs/init.md](./docs/init.md) for the full list of managed files.

To sync AI files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) with the latest version from the package:

```bash
pnpm exec josh sync
```

## Key commands

A `josh` binary is available in `node_modules/.bin/` after installation. See [docs/josh-commands.md](./docs/josh-commands.md) for the full reference.

| Subcommand      | Description                                       |
| --------------- | ------------------------------------------------- |
| `josh init`     | Initialize config files in a new project          |
| `josh sync`     | Sync managed files from the package               |
| `josh lint`     | Check code with prettier and eslint               |
| `josh git`      | AI-assisted git workflow                          |
| `josh followup` | AI-assisted PR follow-up workflow                 |
| `josh latest`   | Update pnpm, dependencies, and run security audit |

## Telegram notifications

`josh followup`, `josh notify`, and `josh git` support optional Telegram notifications. See [docs/scripts-ai.md](./docs/scripts-ai.md) for setup instructions.

## Manual config

Prefer wiring up individual configs without `josh init`? See [docs/manual-config.md](./docs/manual-config.md).
