# josh init — Detailed Behavior

`josh init` sets up a new project with all the toolchain config files managed by `@joshuafolkken/kit`. Run it once after installing the package.

```bash
pnpm josh init
```

## Config files

Each file is either created (if missing) or merged (if it already exists). Files without a merge strategy show a sample you can copy manually.

| File                      | If missing                                                                                                                            | If exists                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `.gitignore`              | Created from `templates/gitignore`                                                                                                    | Union-merged: missing kit patterns appended, consumer-local entries kept                                                              |
| `.npmrc`                  | Created with registry, engine-strict, minimum-release-age                                                                             | Missing lines appended; existing lines kept verbatim, including a GitHub Packages `_authToken` line                                   |
| `eslint.config.js`        | Created with `create_vanilla_config`                                                                                                  | Sample shown — add manually                                                                                                           |
| `prettier.config.js`      | Created with shared config                                                                                                            | Sample shown — add manually                                                                                                           |
| `playwright.config.ts`    | Created with `create_playwright_config`                                                                                               | Sample shown — add manually                                                                                                           |
| `tsconfig.json`           | Created with `extends` pointing to the preset and `exclude` covering the generated-output directories plus SvelteKit's own exclusions | Preset entry prepended to `extends` array; missing `exclude` entries appended                                                         |
| `cspell.config.yaml`      | Created with `import` pointing to the shared word list                                                                                | Import entry added under `import:` key (skipped when superseded by a transitive import, e.g. the game-kit import)                     |
| `lefthook.yml`            | Created with `extends` pointing to the preset                                                                                         | Preset entry added under `extends:` key                                                                                               |
| `.secretlintrc.json`      | Created enabling the recommend rule preset                                                                                            | Left untouched — the rule list is project-owned once it exists                                                                        |
| `.vscode/extensions.json` | Created from package template                                                                                                         | Missing recommendations merged in                                                                                                     |
| `.vscode/settings.json`   | Created from package template                                                                                                         | Missing keys merged in; a key the project already owns gains kit's missing entries when both values are objects (project entries win) |

> Kit-only `.vscode/settings.json` keys (currently `sonarlint.connectedMode.project`, which points at the kit's own SonarQube project) are stripped from the template before distribution, so they are never written into consumer projects.

### tsconfig merge strategy

The preset is **prepended** to the `extends` array so it does not override project-specific entries:

```jsonc
// before
{ "extends": ["./tsconfig.options.json"] }

// after
{ "extends": ["./node_modules/@joshuafolkken/kit/tsconfig/base.json", "./tsconfig.options.json"] }
```

### tsconfig exclude

The generated `tsconfig.json` also carries an `exclude` list covering the directories the kit-distributed configs generate, plus the exclusions SvelteKit's own generated config contributes:

```json
{
	"exclude": [
		"node_modules",
		"build",
		"dist",
		"playwright-report",
		"test-results",
		"src/service-worker.js",
		"src/service-worker/**/*.js",
		"src/service-worker.ts",
		"src/service-worker/**/*.ts",
		"src/service-worker.d.ts",
		"src/service-worker/**/*.d.ts"
	]
}
```

`playwright.config.ts` points the `html` reporter at `playwright-report/`, which holds Playwright's own minified trace-viewer bundle. Without the exclusion, a project whose `include` is broad (`"./**/*.ts"`, `"./**/*.js"` — the natural SvelteKit shape) type-checks that bundle and `tsc --noEmit` reports thousands of errors from third-party output, but only on a machine that has run the E2E suite. The two directories stay separate because Playwright refuses an HTML output folder nested inside the tests output folder (and vice versa), so both are listed.

These entries have to live in the **consumer** file: a `tsconfig.json` `exclude` **overrides** the extended preset's rather than merging with it, so shipping them in `base.json` — or in app-kit's `tsconfig/sveltekit.json` — would have no effect on any project that declares its own. On an existing file the list is union-merged, so an entry you added is kept and re-running is a no-op. Note that declaring `exclude` also turns off TypeScript's implicit exclusion of `outDir`; a project with a custom `outDir` outside `build` / `dist` should add it to the list.

The `src/service-worker*` globs are there because that same override rule cuts the other way. A SvelteKit project extends `./.svelte-kit/tsconfig.json`, which excludes those paths itself — SvelteKit keeps the service worker out of the app program deliberately, since it runs in a worker context with its own `lib` (`WebWorker`, not `DOM`) and its own generated `$service-worker` ambient types, so type-checking it under the app config produces errors with no correct fix from inside that config. The moment kit writes any `exclude` key, the generated config's array is replaced outright and all six are discarded. Repeating them makes kit's list additive rather than replacing. SvelteKit's remaining entry, `../node_modules/**`, is already covered by `node_modules`. See [kit#796](https://github.com/joshuafolkken/kit/issues/796).

They are written unconditionally — kit does not detect SvelteKit, and at `josh init` time the generated config does not exist yet to be read. In a non-SvelteKit project the paths usually match nothing. If yours does keep its own `src/service-worker.ts`, note that it is a program root nothing imports, so excluding it drops it from `tsc --noEmit`, and a re-sync re-adds the globs if you delete them. Give that file its own `tsconfig` — worker code wants `lib: ["WebWorker"]` rather than the app's `DOM` in any case.

They are also the **default** paths only. If you moved the worker with `kit.files.serviceWorker` in `svelte.config.js`, these globs match nothing and SvelteKit's real exclusion is still replaced — add your own path to `exclude` yourself. The merge only appends, so a hand-added entry survives every later sync.

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

When a `prepare` already exists, `josh init` appends the lifecycle to it rather than replacing it. If a script already runs `fix-gh-packages`, `josh init` skips re-adding the hook so re-running it never duplicates. A kit-managed `postinstall` from an earlier version (one that runs `fix-gh-packages`) is migrated to `prepare`; a custom `postinstall` of your own is left untouched.

All other toolchain tasks are available as `pnpm josh <command>` subcommands — they are **not** added as separate package scripts. Existing scripts are never overwritten.

## Dependencies

`josh init` adds the packages the generated config needs to `devDependencies`. An entry is only added when it is missing — an existing version is never overwritten, so re-running `josh init` is idempotent.

| Package                               | Version                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `@joshuafolkken/kit`                  | pinned to the running kit version (the generated configs import from this package, so it must be present) |
| `@ianvs/prettier-plugin-sort-imports` | `^4.7.1`                                                                                                  |
| `prettier-plugin-svelte`              | `^4.1.1`                                                                                                  |
| `prettier-plugin-tailwindcss`         | `^0.8.0`                                                                                                  |

The three `prettier-plugin-*` / `@ianvs/prettier-plugin-sort-imports` entries back the kit prettier preset (`@joshuafolkken/kit/prettier`), whose `plugins[]` references all three by name. prettier resolves plugins from the **consumer** project rather than transitively through the kit, so every project that uses the preset must declare them locally — otherwise `prettier`/`josh lint` fails with `Cannot find package`.

### Available `pnpm josh` subcommands

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

SvelteKit type-checking is no longer part of kit's framework-agnostic `josh` CLI. SvelteKit projects get `josh-app check` / `josh-app check:ci` from [`@joshuafolkken/app-kit`](https://github.com/joshuafolkken/app-kit) instead.

Retired scripts (previously managed, now removed): `git`, `git:followup`, `telegram:test`, `audit:security`, `prep`, `issue:prep`, `prevent-main-commit`, `check-commit-message`, `version:*`, `overrides:check`, `check:ci`, `check:svelte`, `check:svelte:ci`.

## AI files

The following files are **copied from the package** on first run. If a file already exists, it is skipped with a message suggesting `josh sync` to update it.

```text
CLAUDE.md           AGENTS.md           GEMINI.md
CODE_OF_CONDUCT.md
.cursorrules        .coderabbit.yaml    .gitattributes
.mcp.json           .ncurc.json         .prettierignore
SECURITY.md         pnpm-workspace.yaml tsconfig.sonar.json
.github/workflows/ci.yml
.github/workflows/auto-tag.yml
.github/workflows/production.yml
.github/workflows/sonar-qube.yml
.github/pull_request_template.md
.github/release.yml
.github/dependabot.yml
.claude/settings.json
sonar-project.properties  (generated from GitHub repo name)
```

`CLAUDE.md`, `AGENTS.md`, and `GEMINI.md` have their `prompts/` paths rewritten to point to `node_modules/@joshuafolkken/kit/prompts/` so they work correctly in the consuming project.

`sonar-project.properties` is generated from the GitHub repo name fetched via `gh repo view`. If `gh` is not available or the repo cannot be identified, the file is skipped with a warning.

## Tool installs

After all files are processed, `josh init` runs:

1. **`lefthook install`** — installs git hooks defined in `lefthook.yml` (pre-commit, commit-msg, pre-push).

### Secret scanning (pre-commit)

The kit pre-commit hook runs [secretlint](https://github.com/secretlint/secretlint) over the staged files, so a credential is caught before it enters git history. This sits ahead of GitHub push protection and PR-time scanners, which only fire once a commit exists — and push protection alone covers just the known provider patterns, not generic tokens.

`josh init` provisions everything needed: `.secretlintrc.json` (recommend preset) plus the `secretlint` and `@secretlint/secretlint-rule-preset-recommend` devDependencies. The devDependencies live in the **consumer** project rather than in kit, because pnpm's isolated `node_modules` never exposes a kit dependency's bin to the consumer's `pnpm exec`.

The hook runs through [`josh secretlint-scan`](./josh-commands.md#josh-secretlint-scan), which skips with a notice when the binary is absent instead of failing the commit.

> **Upgrading an existing project:** `josh sync` adds the same config and devDependencies, but the packages are not present until you run `pnpm install`. Until then every commit prints the skip notice and the secret scan does **not** run — run `pnpm install` immediately after syncing to restore it.

To scan the whole tree rather than just staged files:

```bash
pnpm exec secretlint "**/*"
```

To make `josh` available system-wide, install the kit globally with `pnpm add -g @joshuafolkken/kit` (see [cli.md](./cli.md)). `josh init` no longer writes a `~/.local/bin/josh` shim.
