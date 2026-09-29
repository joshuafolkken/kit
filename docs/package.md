# Use the kit as a project package

For adding kit to a project and wiring it up with `josh init`. The install steps differ by [project profile](./init.md#project-profiles):

| Profile  | Your project                                                      | Start here                                                               |
| -------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `static` | An `index.html` site, or Python, Rust or another non-Node project | [getting-started.md](./getting-started.md) — also installs Node and pnpm |
| `node`   | A JavaScript / TypeScript project with npm dependencies           | the steps below                                                          |

The package is independent of the [global `josh` CLI](./cli.md) — most projects want both, but the package alone is enough to consume configs.

## 1. Install

The public npm registry serves `@joshuafolkken/kit` without a GitHub token or project `.npmrc` mapping. Existing projects with a `@joshuafolkken` mapping to GitHub Packages keep using it; see [authentication.md](./authentication.md) until those projects migrate.

```bash
pnpm add -D --allow-build=esbuild @joshuafolkken/kit
```

kit's CLI runs on tsx, which depends on esbuild, and pnpm fails an install whose dependencies carry an unapproved build script. `--allow-build=esbuild` records that one approval in `pnpm-workspace.yaml`. Added without it, the command reports esbuild as an ignored build; `josh init` then answers pnpm's placeholder, and the next `pnpm install` succeeds.

The package-only installation provides the shared CLI and common configuration without installing ESLint or Svelte. ESLint is an optional feature: its published preset stays at `@joshuafolkken/kit/eslint/vanilla`, but the project using that preset must also install ESLint and its plugins. `josh init` adds those development dependencies for the config it generates. For a package-only project, skip initialization and import only the common entry points you need.

Existing projects that already import the kit ESLint preset must add its peer packages when upgrading from a version that bundled them:

```bash
pnpm add -D eslint@^10.11.0 typescript@^6.0.3 typescript-eslint@^8.70.1 @eslint/compat@^2.1.1 @eslint/js@^10.0.1 @stylistic/eslint-plugin@^5.10.0 eslint-config-prettier@^10.1.8 eslint-import-resolver-typescript@^4.4.5 eslint-plugin-import-x@^4.17.1 eslint-plugin-promise@^7.3.0 eslint-plugin-sonarjs@^4.2.1 eslint-plugin-unicorn@^76.0.0 globals@^17.12.0
```

Keep the existing `@joshuafolkken/kit/eslint/vanilla` import. The ESLint version moves to 10 because the current `@eslint/js` preset requires it. `eslint_d` is no longer installed by kit; the edit hook falls back to the project's ESLint executable when the daemon is absent. Projects that want the daemon can add `eslint_d` directly.

Kit no longer declares a Svelte peer. Projects using `@joshuafolkken/kit/prettier` for `.svelte` files must install `prettier-plugin-svelte` and its Svelte peer in the project, alongside the other plugins listed in [init.md](./init.md#dependencies). A project that only installs kit does not need either package.

## 2. Initialize

Run once after installing — creates or merges all config files:

```bash
pnpm exec josh init
```

See [init.md](./init.md) for the full list of managed files. After upgrading the package, pull in updated AI files, workflow templates, and other managed files with:

```bash
pnpm exec josh sync
```

See [sync.md](./sync.md) for what `sync` overwrites and why. A project-local `josh` is available via `pnpm josh …` after installation, so the CLI works even without the global install.

## 3. Config entry points

The config presets (ESLint, Prettier, tsconfig) and the libraries kit exports — version commands, config-merge, env flags and the webServer command — are documented in [package-api.md](./package-api.md). Prefer wiring up individual configs without `josh init`? See [manual-config.md](./manual-config.md).

## Next

- Task guides: [how-to.md](./how-to.md).
- Full command reference: [josh-commands.md](./josh-commands.md).
- Want `josh` available everywhere? Install the [global CLI](./cli.md).
- Hitting an error? See [troubleshooting.md](./troubleshooting.md).
