# @joshuafolkken/kit

Shared toolchain config for TypeScript / SvelteKit projects.

Covers: ESLint · Prettier · TypeScript · Lefthook · cspell · VS Code · AI files (CLAUDE.md, AGENTS.md, GEMINI.md)

See [docs/overview.md](./docs/overview.md) for a full description of what this package provides and how it works.

## Quick start

**1. Authenticate** — GitHub Packages requires auth even for public packages:

```bash
# Add to .npmrc
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}

# Export your token (uses your existing gh CLI session)
export NODE_AUTH_TOKEN=$(gh auth token)
```

If `gh auth token` fails or you get a 401, re-authenticate with the `read:packages` scope:

```bash
gh auth login --scopes read:packages
```

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

## CLI commands

A single `josh` command is available in `node_modules/.bin/` after installation. Run `pnpm exec josh help` to list all subcommands. See [docs/josh-commands.md](./docs/josh-commands.md) for the full reference.

| Subcommand                  | Description                                       |
| --------------------------- | ------------------------------------------------- |
| `josh lint`                 | Check code with prettier and eslint               |
| `josh format`               | Format code with prettier and eslint              |
| `josh cspell`               | Run spell check                                   |
| `josh test:unit`            | Run unit tests                                    |
| `josh check`                | Type-check SvelteKit project                      |
| `josh check:ci`             | Type-check SvelteKit project (CI strict mode)     |
| `josh init`                 | Initialize config files in a new project          |
| `josh sync`                 | Sync managed files from the package               |
| `josh install`              | Install josh to ~/.local/bin                      |
| `josh git`                  | AI-assisted git workflow                          |
| `josh followup`             | AI-assisted PR follow-up workflow                 |
| `josh notify`               | Send a Telegram notification                      |
| `josh main:sync`            | Checkout main and pull latest                     |
| `josh main:merge`           | Pull latest from origin main                      |
| `josh bump`                 | Bump package version                              |
| `josh version`              | Show current and latest package version           |
| `josh overrides`            | Check pnpm overrides for drift                    |
| `josh audit`                | Run security audit                                |
| `josh latest`               | Update pnpm, dependencies, and run security audit |
| `josh prep`                 | Pre-implementation preparation                    |
| `josh issue`                | Fetch GitHub issue details                        |
| `josh prevent-main-commit`  | Git hook: block direct commits to main            |
| `josh check-commit-message` | Git hook: validate commit message format          |
| `josh hook:install`         | Install git hooks                                 |
| `josh hook:uninstall`       | Uninstall git hooks                               |
| `josh help`                 | Show all available commands                       |

## Manual config

Use individual configs directly if you prefer not to use `josh init`:

```js
// eslint.config.js
import { create_sveltekit_config } from '@joshuafolkken/kit/eslint/sveltekit'
// or
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
