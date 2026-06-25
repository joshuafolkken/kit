# Use the kit as a project package

Add `@joshuafolkken/kit` as a devDependency so a project can consume its ESLint / Prettier / tsconfig configs, prompts, and scripts, and run `josh init` to wire them up.

This is independent of the [global `josh` CLI](./cli.md) — most projects want both, but the package alone is enough to consume configs.

## 1. Authenticate

One-time GitHub Packages setup — see [authentication.md](./authentication.md). For a project dependency, write the `.npmrc` lines to the repo's `./.npmrc` (safe to commit — it holds only a literal placeholder).

## 2. Install

```bash
pnpm add -D @joshuafolkken/kit
```

## 3. Initialize

Run once after installing — auto-detects SvelteKit vs. vanilla and creates or merges all config files:

```bash
pnpm exec josh init
```

See [init.md](./init.md) for the full list of managed files. After upgrading the package, pull in updated AI files, workflow templates, and other managed files with:

```bash
pnpm exec josh sync
```

See [sync.md](./sync.md) for what `sync` overwrites and why. A project-local `josh` is available via `pnpm josh …` after installation, so the CLI works even without the global install.

## 4. Config entry points

The package exposes config presets for direct import:

| Use             | Reference                                                        |
| --------------- | ---------------------------------------------------------------- |
| ESLint config   | `@joshuafolkken/kit/eslint/sveltekit`                            |
| Prettier        | `@joshuafolkken/kit/prettier`                                    |
| tsconfig        | `./node_modules/@joshuafolkken/kit/tsconfig/sveltekit.jsonc`     |
| Scripts         | `tsx node_modules/@joshuafolkken/kit/scripts/fix-gh-packages.ts` |
| Prompts         | `node_modules/@joshuafolkken/kit/prompts/*.md`                   |
| Version library | `@joshuafolkken/kit/version`                                     |

Prefer wiring up individual configs without `josh init`? See [manual-config.md](./manual-config.md).

### Version-command library (`@joshuafolkken/kit/version`)

A package-name-parameterized implementation of the `version` (show) and `version:upgrade`
commands, so a consuming package (e.g. `@joshuafolkken/game-kit`, `@joshuafolkken/app-kit`) drives
both commands through kit instead of copying the scripts. Each consumer's thin CLI wrapper passes
only its own package name + GitHub Packages versions endpoint:

```ts
// scripts/version/version-check.ts (consumer)
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { create_version_command_config, version_commands } from '@joshuafolkken/kit/version'

const config = create_version_command_config({
	package_name: '@joshuafolkken/game-kit',
	versions_endpoint: '/users/joshuafolkken/packages/npm/game-kit/versions?per_page=1',
	self_directory: path.dirname(fileURLToPath(import.meta.url)),
})

version_commands.run_check(config) // version (show)
// process.exit(version_commands.run_upgrade(config)) // version:upgrade
```

`create_version_command_config` derives the lockfile-repair (`fix-gh-packages`) path from the
package name. The optional `self_directory` enables the running-binary line; an optional
`resolve_warning` hook supplies a package-specific PATH-shadowing warning. The export resolves a
`.ts` entry, so
consumers run their wrappers under `tsx` (as the existing per-package version scripts already do).
kit's own `version` / `version:upgrade` consume this same library via
[`scripts/version/kit-version-config.ts`](https://github.com/joshuafolkken/kit/blob/main/scripts/version/kit-version-config.ts).

## Next

- Full command reference: [josh-commands.md](./josh-commands.md).
- Want `josh` available everywhere? Install the [global CLI](./cli.md).
- Hitting an error? See [troubleshooting.md](./troubleshooting.md).
