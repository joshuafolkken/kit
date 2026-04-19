# @joshuafolkken/kit

Shared toolchain config for TypeScript / SvelteKit projects.

Covers: ESLint · Prettier · TypeScript · Lefthook · cspell · VS Code · AI files (CLAUDE.md, AGENTS.md, GEMINI.md)

## Documentation

- [Overview](./docs/overview.md) — what this package provides and how it works
- [josh commands](./docs/josh-commands.md) — full CLI reference
- [josh init](./docs/init.md) — detailed init behavior
- [josh sync](./docs/sync.md) — detailed sync behavior

## Authentication

GitHub Packages requires authentication even for public packages. Set up auth before installing:

1. Add the auth token to `.npmrc`:

   ```
   //npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
   ```

2. Export the token in your shell (uses your existing `gh` CLI session):

   ```bash
   export NODE_AUTH_TOKEN=$(gh auth token)
   ```

   If `gh auth token` fails or installation returns a 401, your token may be missing the `read:packages` scope. Re-authenticate with:

   ```bash
   gh auth login --scopes read:packages
   ```

## Install

Add the registry to `.npmrc` first (or let `josh init` do it):

```
@joshuafolkken:registry=https://npm.pkg.github.com
```

Then install:

```bash
pnpm add -D @joshuafolkken/kit
```

## Setup

Run once after installing:

```bash
pnpm exec josh init
```

Auto-detects SvelteKit vs vanilla. Creates or merges:

| File                                  | Behavior                   |
| ------------------------------------- | -------------------------- |
| `.npmrc`                              | Adds registry line         |
| `eslint.config.js`                    | Created (shown if exists)  |
| `prettier.config.js`                  | Created (shown if exists)  |
| `playwright.config.ts`                | Created (shown if exists)  |
| `tsconfig.json`                       | Merges `extends`           |
| `cspell.config.yaml`                  | Merges `import`            |
| `lefthook.yml`                        | Merges `extends`           |
| `.vscode/extensions.json`             | Merges `recommendations`   |
| `.vscode/settings.json`               | Merges missing keys        |
| `package.json`                        | Merges missing scripts     |
| `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` | Copied (skipped if exists) |

Runs `lefthook install` at the end.

## Update AI files

To overwrite AI files with the latest version from the package:

```bash
pnpm exec josh sync
```

## CLI commands

A single `josh` command is available in `node_modules/.bin/` after installation. Run `pnpm exec josh help` to list all subcommands. See [docs/josh-commands.md](./docs/josh-commands.md) for the full reference.

| Subcommand                  | Description                              |
| --------------------------- | ---------------------------------------- |
| `josh init`                 | Initialize config files in a new project |
| `josh sync`                 | Sync managed files from the package      |
| `josh install`              | Install josh to ~/.local/bin             |
| `josh git`                  | AI-assisted git workflow                 |
| `josh followup`             | AI-assisted PR follow-up workflow        |
| `josh notify`               | Send a Telegram notification             |
| `josh bump`                 | Bump package version                     |
| `josh version`              | Show current and latest package version  |
| `josh overrides`            | Check pnpm overrides for drift           |
| `josh audit`                | Run security audit                       |
| `josh prep`                 | Pre-implementation preparation           |
| `josh issue`                | Fetch GitHub issue details               |
| `josh prevent-main-commit`  | Git hook: block direct commits to main   |
| `josh check-commit-message` | Git hook: validate commit message format |
| `josh help`                 | Show all available commands              |

## Package exports

Use individual configs directly if you prefer manual setup:

```js
// eslint.config.js

// or
import { create_sveltekit_config } from '@joshuafolkken/kit/eslint/sveltekit'
import { create_vanilla_config } from '@joshuafolkken/kit/eslint/vanilla'
```

```js
// prettier.config.js
import { config } from '@joshuafolkken/kit/prettier'
```

```jsonc
// tsconfig.json
{ "extends": ["@joshuafolkken/kit/tsconfig/base"] }
// or sveltekit:
{ "extends": [".svelte-kit/tsconfig.json", "@joshuafolkken/kit/tsconfig/sveltekit"] }
```

```yaml
# cspell.config.yaml
import:
  - node_modules/@joshuafolkken/kit/cspell/index.yaml
```

```yaml
# lefthook.yml
extends:
  - node_modules/@joshuafolkken/kit/lefthook/vanilla.yml
  # or sveltekit.yml
```
