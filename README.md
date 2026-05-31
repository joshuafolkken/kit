# @joshuafolkken/kit

Shared toolchain config for TypeScript / SvelteKit projects.

Covers: ESLint · Prettier · TypeScript · Lefthook · cspell · VS Code · AI files (CLAUDE.md, AGENTS.md, GEMINI.md)

See [docs/overview.md](./docs/overview.md) for a full description of what this package provides and how it works.

`@joshuafolkken/kit` is **dual-purpose**:

- **A — Global CLI** — install once and run `josh` from any directory, independent of any project's `node_modules`.
- **B — Project package** — add as a devDependency to consume ESLint / Prettier / tsconfig configs, prompts, and scripts.

The two are independent. Most projects want both: the global `josh` CLI for day-to-day commands, and the local devDependency so config imports (`@joshuafolkken/kit/eslint/sveltekit`, etc.) resolve.

## Prerequisites

- [Node.js](https://nodejs.org/) with [pnpm](https://pnpm.io/)
- [gh CLI](https://cli.github.com/) — required for GitHub Packages authentication. Install via `brew install gh` (macOS), `winget install GitHub.cli` (Windows), or see the [gh installation docs](https://github.com/cli/cli#installation).

## Authentication (required for both install modes)

GitHub Packages requires auth even for public packages.

**bash / zsh (macOS, Linux):**

```bash
export NODE_AUTH_TOKEN=$(gh auth token)
```

**PowerShell (Windows):**

```powershell
$env:NODE_AUTH_TOKEN = (gh auth token)
```

If `gh auth token` fails or you get a 401, re-authenticate: `gh auth login --scopes read:packages`

Point the `@joshuafolkken` scope at GitHub Packages. For a **global** install add these to your user-level `~/.npmrc`; for a **project** install add them to the repo's `.npmrc` (after `josh init` the project copy is managed automatically):

```ini
@joshuafolkken:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

## A — Install as a global CLI

Install the package globally to get a project-independent `josh` command:

```bash
pnpm add -g @joshuafolkken/kit
```

`josh` now works from any directory:

```bash
josh help
josh lint
josh git
```

The global bin is a compiled, self-contained executable (`dist/josh.js`) — it is **not** tied to any project's `node_modules`, so reinstalling or removing a project's dependencies never breaks it.

If your shell can't find `josh` after installing, add pnpm's global bin directory to your `PATH` (run `pnpm bin -g` to print it), e.g.:

```bash
export PATH="$(pnpm bin -g):$PATH"
```

### Migrating from older versions

Versions prior to `0.200.0` installed a project-pinned shim at `~/.local/bin/josh` via `postinstall`. That shim is no longer created and can break when its origin project's `node_modules` is removed. If you have a stale shim, delete it and use the global install instead:

```bash
rm -f ~/.local/bin/josh
pnpm add -g @joshuafolkken/kit
```

## B — Use as a project package

Add the kit as a devDependency so the project can consume its configs, prompts, and scripts:

```bash
pnpm add -D @joshuafolkken/kit
```

**Initialize** — run once after installing (auto-detects SvelteKit vs vanilla and creates or merges all config files):

```bash
pnpm exec josh init
```

See [docs/init.md](./docs/init.md) for the full list of managed files.

To sync AI files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) with the latest version from the package:

```bash
pnpm exec josh sync
```

A project-local `josh` is also available in `node_modules/.bin/` after installation (`pnpm exec josh …` or `pnpm josh …`), so the CLI works even without the global install. The package additionally exposes config entry points for direct import:

| Use           | Reference                                                        |
| ------------- | ---------------------------------------------------------------- |
| ESLint config | `@joshuafolkken/kit/eslint/sveltekit`                            |
| Prettier      | `@joshuafolkken/kit/prettier`                                    |
| tsconfig      | `./node_modules/@joshuafolkken/kit/tsconfig/sveltekit.jsonc`     |
| Scripts       | `tsx node_modules/@joshuafolkken/kit/scripts/fix-gh-packages.ts` |
| Prompts       | `node_modules/@joshuafolkken/kit/prompts/*.md`                   |

## Key commands

See [docs/josh-commands.md](./docs/josh-commands.md) for the full reference.

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
