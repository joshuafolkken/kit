# josh init — Detailed Behavior

`josh init` sets up a new project with all the toolchain config files managed by `@joshuafolkken/kit`. Run it once after installing the package.

```bash
pnpm josh init
```

## Project type detection

`josh init` needs to know whether your project is SvelteKit or vanilla TypeScript.

1. **Auto-detect** — `sveltekit` is used automatically when either `svelte.config.js` / `svelte.config.ts` exists in the current directory **or** `@sveltejs/kit` is listed in the project's `dependencies` / `devDependencies`. The dependency check covers the newer `sv create --template library` scaffold, which ships no `svelte.config.*` and configures the `sveltekit()` plugin in `vite.config.ts` instead.
2. **CLI flag** — pass `--type sveltekit` or `--type vanilla` to skip detection.
3. **Interactive prompt** — if detection fails and no flag is given, you are prompted to choose.

The project type controls which ESLint config, tsconfig preset, and Lefthook config are generated.

## Config files

Each file is either created (if missing) or merged (if it already exists). Files without a merge strategy show a sample you can copy manually.

| File                      | If missing                                                        | If exists                                                                                                         |
| ------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `.npmrc`                  | Created with registry, engine-strict, minimum-release-age         | Missing lines appended                                                                                            |
| `eslint.config.js`        | Created with `create_sveltekit_config` or `create_vanilla_config` | Sample shown — add manually                                                                                       |
| `prettier.config.js`      | Created with shared config                                        | Sample shown — add manually                                                                                       |
| `playwright.config.ts`    | Created with `create_playwright_config`                           | Sample shown — add manually                                                                                       |
| `tsconfig.json`           | Created with `extends` pointing to the preset                     | Preset entry prepended to `extends` array                                                                         |
| `cspell.config.yaml`      | Created with `import` pointing to the shared word list            | Import entry added under `import:` key (skipped when superseded by a transitive import, e.g. the game-kit import) |
| `lefthook.yml`            | Created with `extends` pointing to the preset                     | Preset entry added under `extends:` key                                                                           |
| `.vscode/extensions.json` | Created from package template                                     | Missing recommendations merged in                                                                                 |
| `.vscode/settings.json`   | Created from package template                                     | Missing keys merged in (existing keys untouched)                                                                  |

> Kit-only `.vscode/settings.json` keys (currently `sonarlint.connectedMode.project`, which points at the kit's own SonarQube project) are stripped from the template before distribution, so they are never written into consumer projects.

### tsconfig merge strategy

The preset is **prepended** to the `extends` array so it does not override project-specific entries:

```jsonc
// before
{ "extends": ["./.svelte-kit/tsconfig.json"] }

// after
{ "extends": ["@joshuafolkken/kit/tsconfig/sveltekit.jsonc", "./.svelte-kit/tsconfig.json"] }
```

### eslint.config.js / prettier.config.js / playwright.config.ts

These files have no merge strategy. If they already exist, `josh init` prints the generated content so you can copy the relevant parts manually.

## Package scripts

`josh init` adds these scripts to your `package.json`:

| Script       | Command                                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `preinstall` | `pnpm dlx @aikidosec/safe-chain setup-ci`                                                                                    |
| `prepare`    | `(command -v lefthook >/dev/null 2>&1 && lefthook install \|\| true) && (command -v tsx >/dev/null 2>&1 && tsx … \|\| true)` |
| `josh`       | `josh`                                                                                                                       |

The lifecycle hooks (`lefthook install` + `fix-gh-packages`) live in **`prepare`**, not `postinstall`. `prepare` runs on a local `pnpm install` and during `pack`/`publish`, but **not** when your package is installed as a dependency by a consumer — which is the correct scope for these developer-only hooks. The command is **guarded**: each step runs only when its binary is on `PATH`, and each optional hook is individually tolerated with `|| true`, chained with `&&`. This prevents a missing `lefthook`/`tsx` (or a failing optional hook) from aborting `pnpm install` in production or CI installs that omit dev dependencies — **without** masking the core steps it is appended to. When `josh init` appends the lifecycle to an existing `prepare` (e.g. `pnpm gen && svelte-kit sync`), those core steps stay fail-fast: if they fail, `prepare` still exits non-zero.

When a `prepare` already exists (for example a SvelteKit `svelte-kit sync`), `josh init` appends the lifecycle to it rather than replacing it. If a script already runs `fix-gh-packages`, `josh init` skips re-adding the hook so re-running it never duplicates. A kit-managed `postinstall` from an earlier version (one that runs `fix-gh-packages`) is migrated to `prepare`; a custom `postinstall` of your own is left untouched.

All other toolchain tasks are available as `pnpm josh <command>` subcommands — they are **not** added as separate package scripts. Existing scripts are never overwritten.

## Dependencies

`josh init` adds the packages the generated config needs to `devDependencies`. An entry is only added when it is missing — an existing version is never overwritten, so re-running `josh init` is idempotent.

| Package                    | Added for          | Version                                                                                                   |
| -------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------- |
| `@joshuafolkken/kit`       | all project types  | pinned to the running kit version (the generated configs import from this package, so it must be present) |
| `cspell`                   | SvelteKit projects | `^10.0.0`                                                                                                 |
| `size-limit`               | SvelteKit projects | `^12.1.0`                                                                                                 |
| `@size-limit/file`         | SvelteKit projects | `^12.1.0`                                                                                                 |
| `rollup-plugin-visualizer` | SvelteKit projects | `^7.0.1`                                                                                                  |

### Available `pnpm josh` subcommands (all project types)

| Command              | Runs                                                  |
| -------------------- | ----------------------------------------------------- |
| `lint`               | `pnpm lint:prettier && pnpm lint:eslint`              |
| `lint:prettier`      | `prettier --check .`                                  |
| `lint:eslint`        | `eslint . --cache --cache-strategy content`           |
| `format`             | `pnpm format:prettier && pnpm format:eslint`          |
| `format:prettier`    | `prettier --write .`                                  |
| `format:eslint`      | `eslint . --fix --cache --cache-strategy content`     |
| `cspell`             | `cspell lint ...`                                     |
| `cspell:dot`         | `pnpm cspell . --dot`                                 |
| `test:unit`          | `vitest run` (skips when vitest or test files absent) |
| `lefthook:install`   | `lefthook install`                                    |
| `lefthook:uninstall` | `lefthook uninstall`                                  |
| `lefthook:commit`    | `lefthook run pre-commit`                             |
| `lefthook:push`      | `lefthook run pre-push`                               |
| `main:sync`          | `git checkout main && git pull`                       |
| `main:merge`         | `git pull origin main`                                |
| `check`              | `pnpm exec tsc --noEmit`                              |

### Additional subcommands for SvelteKit projects

These require `svelte-check` and `svelte-fast-check` to be installed in the project.

| Command           | Runs                                                         |
| ----------------- | ------------------------------------------------------------ |
| `check:svelte`    | `svelte-kit sync && svelte-fast-check --incremental`         |
| `check:svelte:ci` | `svelte-kit sync && svelte-check --tsconfig ./tsconfig.json` |

Retired scripts (previously managed, now removed): `git`, `git:followup`, `telegram:test`, `audit:security`, `prep`, `issue:prep`, `prevent-main-commit`, `check-commit-message`, `version:*`, `overrides:check`, `check:ci`.

## AI files

The following files are **copied from the package** on first run. If a file already exists, it is skipped with a message suggesting `josh sync` to update it.

```text
CLAUDE.md           AGENTS.md           GEMINI.md
CODE_OF_CONDUCT.md
.cursorrules        .coderabbit.yaml    .gitattributes
.mcp.json           .ncurc.json         .prettierignore
SECURITY.md         pnpm-workspace.yaml tsconfig.sonar.json
wrangler.jsonc
.github/workflows/ci.yml
.github/workflows/auto-tag.yml
.github/workflows/production.yml
.github/workflows/sonar-qube.yml
.github/pull_request_template.md
.github/release.yml
.github/dependabot.yml
.gitignore          (from templates/gitignore)
sonar-project.properties  (generated from GitHub repo name)
```

`CLAUDE.md`, `AGENTS.md`, and `GEMINI.md` have their `prompts/` paths rewritten to point to `node_modules/@joshuafolkken/kit/prompts/` so they work correctly in the consuming project.

`sonar-project.properties` is generated from the GitHub repo name fetched via `gh repo view`. If `gh` is not available or the repo cannot be identified, the file is skipped with a warning.

## Tool installs

After all files are processed, `josh init` runs:

1. **`lefthook install`** — installs git hooks defined in `lefthook.yml` (pre-commit, commit-msg, pre-push).

To make `josh` available system-wide, install the kit globally with `pnpm add -g @joshuafolkken/kit` (see [cli.md](./cli.md)). `josh init` no longer writes a `~/.local/bin/josh` shim.
