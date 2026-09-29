# josh init — Detailed Behavior

`josh init` selects a project profile, then creates or merges the settings that apply to that project. It can initialize a directory without Git or an existing `package.json`.

```bash
pnpm josh init

# Override the automatic decision for this run
pnpm josh init --profile static
```

## Project profiles

`josh profile` prints the selected profile and its reason, for example `profile: static (no package.json)`. The profiles are `static` (minimal settings for a project without a Node development toolchain) and `node` (the existing Node toolchain). An `index.html` file does not decide the profile: Vite projects normally have one.

| Priority | Condition                                                 | Profile             |
| -------- | --------------------------------------------------------- | ------------------- |
| 1        | `--profile static` or `--profile node`                    | The requested value |
| 2        | `package.json` contains `josh.profile`                    | The recorded value  |
| 3        | No `package.json`                                         | `static`            |
| 4        | Dependencies other than kit, or a `build` or `dev` script | `node`              |
| 5        | Metadata-only `package.json`                              | `static`            |

kit itself does not count as a dependency, so `pnpm add -D @joshuafolkken/kit` before `josh init` still selects `static` for an `index.html` site. `josh init` records the first decision in `package.json` as `josh.profile`. Re-running it keeps that profile even after dependencies are added. Pass `--profile` to change the recorded value deliberately. Web files and Git are separate conditions: HTML, CSS, or JavaScript files (including `.mjs` and `.cjs`) enable Web formatting; TypeScript files enable a TypeScript config; a Git repository enables Git settings; a GitHub origin enables GitHub files.

| Setting or tool                                                                     | `static`                                                                                                   | `node`                                    |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `package.json`, `josh` script, kit dependency                                       | Always                                                                                                     | Existing package scripts and dependencies |
| Prettier config, Prettier dependency, `.prettierignore`                             | When HTML, CSS, or JavaScript exists                                                                       | Always                                    |
| `tsconfig.json`                                                                     | When TypeScript exists, without SvelteKit exclusions                                                       | Always                                    |
| VS Code extensions                                                                  | Code Spell Checker, Material Icon Theme, Error Lens, Claude Code, GitHub Theme; add Prettier for Web files | Existing recommendations                  |
| VS Code save formatting                                                             | HTML, CSS, and JavaScript only when Web files exist                                                        | Existing settings                         |
| Short AI instructions and pointers                                                  | Always                                                                                                     | Existing full instructions                |
| `.gitignore`, `.gitattributes`                                                      | When Git exists                                                                                            | When Git exists                           |
| GitHub files                                                                        | When a GitHub origin exists                                                                                | When a GitHub origin exists               |
| ESLint, cspell CLI config, Playwright, Lefthook, secretlint, external MCP and hooks | Not installed by default                                                                                   | Existing behavior                         |

VS Code extensions are recommendations, not automatic installs. Code Spell Checker is not part of the initial CLI verification gate. Existing VS Code settings and added extension recommendations are preserved when initialization runs again. The `static` Prettier preset needs no Svelte or Tailwind plugins.

The static Web profile writes `prettier.config.mjs`, which loads under either CommonJS or ESM package settings. Its `.prettierignore` keeps generated files out of formatting without excluding a site's `static/` source directory. A Git-free node project does not receive kit's Git and GitHub `prepare` commands.

To add Git later, run `git init`, then run `josh init` again to add Git files without changing the recorded profile. After adding a GitHub origin, run `josh init` again for GitHub files. `josh start` is an optional entry for the GitHub Issue workflow; `josh init` is the entry for a local project without Git.

## Refused inside the package's own repository

`josh init` writes nothing and exits non-zero when the project it is aimed at **is**
`@joshuafolkken/kit` itself — the case a globally installed kit reaches when it is run from inside
the kit checkout:

```text
Refusing to sync: this is @joshuafolkken/kit's own repository.
Syncing here would overwrite the distribution source with its own derived templates.
Run this command from a consumer project instead.
```

`init` writes everything `josh sync` does plus the project's `package.json` scripts and
devDependencies, so the damage there is strictly larger than the 14 files reproduced in
[#868](https://github.com/joshuafolkken/kit/issues/868). It shares the sync guard's detection rather
than repeating it ([#879](https://github.com/joshuafolkken/kit/issues/879)); the rule, its fallbacks
and why a downstream distributor is unaffected are described in
[sync.md](./sync.md#refused-inside-the-distribution-packages-own-repository).

A project with no `package.json` yet — the scaffolding case `init` exists for — never matches on the
name, because an unreadable manifest says nothing about who the project is. What still applies there
are the two location fallbacks: a directory that **is** the package directory, or one nested inside
it. So an empty directory created under the kit checkout (`kit/tmp/foo`) is refused, and `josh init`
in an empty directory anywhere else scaffolds exactly as before.

## Config files

The following table describes the `node` profile. The profile table above lists the smaller `static` set. Each selected file is either created (if missing) or merged (if it already exists). Files without a merge strategy show a sample you can copy manually.

| File                      | If missing                                                                                                                                                  | If exists                                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `.gitignore`              | Created from `templates/gitignore`                                                                                                                          | Union-merged: missing kit patterns appended, consumer-local entries kept                                                              |
| `.npmrc`                  | Created with pnpm settings and the public npm default (no scoped registry or GitHub token)                                                                  | Missing lines appended; existing lines kept verbatim, including a GitHub Packages `_authToken` line                                   |
| `eslint.config.js`        | Created with `create_vanilla_config`                                                                                                                        | Sample shown — add manually                                                                                                           |
| `prettier.config.js`      | Created with shared config                                                                                                                                  | Sample shown — add manually                                                                                                           |
| `playwright.config.ts`    | Created with `create_playwright_config`                                                                                                                     | Sample shown — add manually                                                                                                           |
| `tsconfig.json`           | Created with `extends` pointing to the preset, `"types": ["node"]`, and `exclude` covering the generated-output directories plus SvelteKit's own exclusions | Preset entry prepended to `extends` array; missing `exclude` entries appended                                                         |
| `cspell.config.yaml`      | Created with `import` pointing to the shared word list                                                                                                      | Import entry added under `import:` key (skipped when superseded by a transitive import, e.g. the game-kit import)                     |
| `lefthook.yml`            | Created with `extends` pointing to the preset                                                                                                               | Preset entry added under `extends:` key                                                                                               |
| `.secretlintrc.json`      | Created enabling the recommend rule preset                                                                                                                  | Left untouched — the rule list is project-owned once it exists                                                                        |
| `.vscode/extensions.json` | Created from package template                                                                                                                               | Missing recommendations merged in                                                                                                     |
| `.vscode/settings.json`   | Created from package template                                                                                                                               | Missing keys merged in; a key the project already owns gains kit's missing entries when both values are objects (project entries win) |

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

The `node` profile adds these scripts to your `package.json`; the `static` profile adds `preinstall` and `josh` — the same safe-chain `preinstall` as `node`:

| Script       | Command                                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preinstall` | `pnpm dlx @aikidosec/safe-chain setup-ci && node -e "…"` (the local shell-integration check below)                                                  |
| `prepare`    | `(command -v lefthook >/dev/null 2>&1 && { lefthook install \|\| echo '…' >&2; } \|\| true) && (command -v tsx >/dev/null 2>&1 && tsx … \|\| true)` |
| `josh`       | `josh`                                                                                                                                              |

**What `preinstall` protects, and what it does not** ([#2707](https://github.com/joshuafolkken/kit/issues/2707)). safe-chain's `setup-ci` only creates shims under `~/.safe-chain` and adds them to `PATH` on a CI runner (`GITHUB_PATH` / `TF_BUILD`); it changes neither your shell nor the running install, so **a `pnpm install` on your machine is not scanned** by it. Local installs are scanned only once you enable safe-chain's own shell integration — install safe-chain per its [README](https://github.com/AikidoSec/safe-chain#installation) (or run `safe-chain setup` if it is already installed) and restart your terminal. kit does not run that for you, because it rewrites your shell configuration. Instead, the `node -e` step after `setup-ci` prints a warning with those steps whenever the install is not running behind safe-chain's proxy (safe-chain hands `GLOBAL_AGENT_HTTP_PROXY` to the package manager it wraps); it always exits zero and stays silent when `CI` is set. Re-running `josh init` upgrades a `preinstall` kit wrote earlier — `pnpm dlx @aikidosec/safe-chain[@<version>] setup-ci` — to this form and leaves any other value alone. On CI, the shims `pnpm dlx` leaves behind cannot find the `safe-chain` binary, so the distributed `ci.yml` does not rely on them: its "Setup safe-chain" steps install the binary with safe-chain's hash-verified release installer in `--ci` mode, pinned by the workflow's `SAFE_CHAIN_INSTALLER_VERSION` / `SAFE_CHAIN_INSTALLER_SHA256` env ([#2711](https://github.com/joshuafolkken/kit/issues/2711)).

The lifecycle hooks (`lefthook install` + `fix-gh-packages`) live in **`prepare`**, not `postinstall`. `prepare` runs on a local `pnpm install` and during `pack`/`publish`, but **not** when your package is installed as a dependency by a consumer — which is the correct scope for these developer-only hooks. The command is **guarded**: each step runs only when its binary is on `PATH`, and each optional hook is individually tolerated with `|| true`, chained with `&&`. This prevents a missing `lefthook`/`tsx` (or a failing optional hook) from aborting `pnpm install` in production or CI installs that omit dev dependencies — **without** masking the core steps it is appended to.

**A `lefthook install` that runs and fails now says so on standard error** ([#1503](https://github.com/joshuafolkken/kit/issues/1503)). It still exits zero — a consumer's install must not die over a developer-only hook, which is what the `|| true` is for — but silence was never part of that bargain: a missing binary and a binary that failed were indistinguishable, so an install leaving **zero** hooks in place reported success and the developer went on committing for weeks with no pre-commit or pre-push check running at all. The warning sits **inside** the branch the binary check already gates, so the ordinary production install — where `lefthook` is simply absent — stays exactly as quiet as it was. When `josh init` appends the lifecycle to an existing `prepare` (e.g. `pnpm gen && svelte-kit sync`), those core steps stay fail-fast: if they fail, `prepare` still exits non-zero.

**A project that was already initialized gets the same rewrite from `josh sync`** ([#1507](https://github.com/joshuafolkken/kit/issues/1507)). Re-running `josh init` is not how consumers upgrade, so the warning would otherwise have reached new projects only — leaving exactly the population the fix was written for on the silent install. `josh sync` matches the clause kit itself wrote and nothing else, and the change takes effect on the next `pnpm install`. See [sync.md](./sync.md#what-does-not-get-synced).

When a `prepare` already exists, `josh init` appends the lifecycle to it rather than replacing it. If a script already runs `fix-gh-packages`, `josh init` skips re-adding the hook so re-running it never duplicates. A kit-managed `postinstall` from an earlier version (one that runs `fix-gh-packages`) is migrated to `prepare`; a custom `postinstall` of your own is left untouched.

All other toolchain tasks are available as `pnpm josh <command>` subcommands — they are **not** added as separate package scripts. Existing scripts are never overwritten.

## Dependencies

The `node` profile adds the packages below to `devDependencies`. The `static` profile adds kit and, when Web files exist, Prettier. An entry is only added when it is missing — an existing version is never overwritten, so re-running `josh init` is idempotent.

| Package                                                      | Version                                                                                                         |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `@joshuafolkken/kit`                                         | pinned to the running kit version (the generated configs import from this package, so it must be present)       |
| `@ianvs/prettier-plugin-sort-imports`                        | `^4.7.1`                                                                                                        |
| `prettier-plugin-svelte`                                     | `^4.1.1`                                                                                                        |
| `prettier-plugin-tailwindcss`                                | `^0.8.0`                                                                                                        |
| ESLint, TypeScript and `@playwright/test` (kit's peers)      | versions from kit's own development dependencies; see [package.md](./package.md#1-install)                      |
| `prettier`, `cspell`, `@types/node`                          | versions from kit's own development dependencies                                                                |
| `lefthook`                                                   | version from kit's own development dependencies; only when Git exists (the only case `lefthook.yml` is written) |
| `secretlint`, `@secretlint/secretlint-rule-preset-recommend` | `^13.0.2`; see [Secret scanning](#secret-scanning-pre-commit)                                                   |

Every generated config has its tool in this list, so `josh init` → `pnpm install` → `josh gate` passes in a new project with no manual install ([#2710](https://github.com/joshuafolkken/kit/issues/2710)): `prettier.config.js` needs `prettier`, `cspell.config.yaml` needs `cspell`, `playwright.config.ts` needs `@playwright/test` and `@types/node`, and `lefthook.yml` needs `lefthook`. The generated `tsconfig.json` names `"types": ["node"]`, because TypeScript 6 no longer loads installed `@types/*` packages by default. `josh init` runs before the first `pnpm install`, so it reports that lefthook is not installed yet and leaves the hook installation to the `prepare` script.

`packageManager` and `devEngines.packageManager.version` are written with kit's exact pnpm pin. pnpm removes `packageManager` from a published manifest, so the pin is read from the installed kit's `devEngines` when the field is absent. An older pnpm then reads that exact version instead of rejecting a `>=` range as an invalid `packageManager` specification. The `allowBuilds` entries kit's `pnpm-workspace.yaml` approves are added to an existing `allowBuilds` map. `pnpm add -D @joshuafolkken/kit` always leaves such a map before `josh init` runs. Entries you already answered keep their values.

`prettier.config.js` sets `tailwindStylesheet` only when the stylesheet exists: a name already in the file is kept while its file exists, and otherwise `src/routes/layout.css` is used when present. prettier-plugin-tailwindcss stops formatting when the named file is missing, so `josh init` and `josh sync` remove a stylesheet name whose file does not exist, including the default that earlier kit versions wrote into every node project.

The three `prettier-plugin-*` / `@ianvs/prettier-plugin-sort-imports` entries back the kit prettier preset (`@joshuafolkken/kit/prettier`), whose `plugins[]` references all three by name. prettier resolves plugins from the **consumer** project rather than transitively through the kit, so every project that uses the preset must declare them locally — otherwise `prettier`/`josh lint` fails with `Cannot find package`.

The ESLint preset likewise resolves ESLint and its plugins from the consumer project. `josh init` now adds them alongside the generated ESLint config; existing projects upgrading kit without rerunning init can use the migration command in [package.md](./package.md#1-install). The minimal `static` profile and conditional Web tooling are tracked in [#2195](https://github.com/joshuafolkken/kit/issues/2195).

### Available `pnpm josh` subcommands

| Command              | Runs                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lint`               | `prettier --check .` then `eslint . --cache --cache-strategy content`                                                                                                    |
| `format`             | `prettier --write .` then `eslint . --fix --cache --cache-strategy content`; a `static` project without Prettier or ESLint skips that tool with a reason, as `lint` does |
| `cspell:dot`         | `cspell . --dot --cache --cache-strategy content --cache-location .cspellcache`                                                                                          |
| `test:unit`          | `vitest run` (skips when vitest is absent; fails when it is present with no test file)                                                                                   |
| `lefthook:install`   | `lefthook install`                                                                                                                                                       |
| `lefthook:uninstall` | `lefthook uninstall`                                                                                                                                                     |
| `lefthook:commit`    | `lefthook run pre-commit`                                                                                                                                                |
| `lefthook:push`      | `lefthook run pre-push`                                                                                                                                                  |
| `main:sync`          | `git checkout <default> && git pull --ff-only`, then prunes merged branches with a `[gone]` remote-tracking upstream (refuses inside a linked work tree)                 |
| `main:merge`         | `git fetch origin <default>` then `git merge origin/<default>`                                                                                                           |
| `check`              | `tsc --noEmit --incremental --tsBuildInfoFile .tsbuildinfo` (a `static` project with nothing to type-check skips it with the reason)                                     |

SvelteKit type-checking is no longer part of kit's framework-agnostic `josh` CLI. SvelteKit projects get `josh-app check` / `josh-app check:ci` from [`@joshuafolkken/app-kit`](https://github.com/joshuafolkken/app-kit) instead.

Retired scripts (previously managed, now removed): `git`, `git:followup`, `telegram:test`, `audit:security`, `prep`, `issue:prep`, `prevent-main-commit`, `check-commit-message`, `version:*`, `overrides:check`, `check:ci`, `check:svelte`, `check:svelte:ci`.

## AI files

The following is the `node` profile's candidate list. Git and GitHub files are included only when their respective conditions hold. The `static` profile copies short AI pointers, a `pnpm-workspace.yaml` that approves only esbuild's build script (kit's CLI runs on tsx, which depends on esbuild, and pnpm fails an install with an unapproved build), adds `.prettierignore` for Web files, and adds Git or GitHub files only when present. If a file already exists, it is skipped with a message suggesting `josh sync` to update it.

```text
CLAUDE.md           AGENTS.md           GEMINI.md
CODE_OF_CONDUCT.md
.cursorrules        .coderabbit.yaml    .gitattributes
.mcp.json           .ncurc.json         .prettierignore
SECURITY.md         pnpm-workspace.yaml tsconfig.sonar.json
.github/workflows/ci.yml
.github/workflows/auto-tag.yml
.github/workflows/dependabot-auto-merge.yml
.github/workflows/production.yml
.github/workflows/sonar-qube.yml
.github/pull_request_template.md
.github/release.yml
.github/dependabot.yml
.claude/settings.json
.codex/config.toml
.codex/hooks.json
sonar-project.properties  (generated from GitHub repo name)
```

`CLAUDE.md` carries every agent rule, but it is **not byte-copied** — since [#1878](https://github.com/joshuafolkken/kit/issues/1878) it is distributed by import. The package ships an already-path-transformed copy at `node_modules/@joshuafolkken/kit/dist/CLAUDE.md` (generated at publish time by `scripts/build/build-claude-md.ts`). The consumer's tracked `CLAUDE.md` starts with a bootstrap instruction: when kit is absent, run `pnpm install` and reread the file before other work. It then imports `@node_modules/@joshuafolkken/kit/dist/CLAUDE.md`, followed by any project additions. A package update alone keeps the rules current — no `josh sync` needed. `josh init` writes this file when the consumer has none, and leaves an existing one untouched. `AGENTS.md`, `GEMINI.md` and `.cursorrules` **remain byte-copies**, because the other tools that read them (Codex, Gemini CLI, Cursor) do not follow CLAUDE.md's `@import`; `AGENTS.md` and `GEMINI.md` are short pointers to `CLAUDE.md` and hold no rules of their own ([#963](https://github.com/joshuafolkken/kit/issues/963)). The copied files have their `prompts/` and `eslint/` paths rewritten to `node_modules/@joshuafolkken/kit/…` so they resolve in the consuming project — the pointers included, since each one tells the reader to open `prompts/*.md` when `CLAUDE.md` names one. The five skills are no longer copied: they ship as the `kit` Claude Code plugin and load from the package (joshuafolkken/kit#1879). `.claude/settings.json` still carries the `permissions.deny` rules a plugin cannot provide, and now also declares the `kit` marketplace and enables the `kit` plugin; the CLI needs a one-time `claude plugin install kit@kit` (settings alone do not auto-install it). `josh sync` removes any stale copied skill directory whose content still matches the shipment.

`sonar-project.properties` is generated from the GitHub repo name fetched via `gh api repos/{owner}/{repo}`. If `gh` is not available or the repo cannot be identified, the file is skipped with a warning.

The Codex files are managed copies of kit's project configuration. An existing file is left alone by `josh init`; run `josh sync` after installing an updated kit to receive changes. The copied `.codex/hooks.json` invokes the installed kit bundles from the consumer project.

## Tool installs

After all files are processed, `josh init` runs:

1. **`lefthook install`** — installs git hooks defined in `lefthook.yml` (pre-commit, commit-msg, pre-push).

### `core.hooksPath` stops lefthook installing anything

**lefthook refuses to install while git has a custom hooks path set**, and it refuses whatever that path points at — including the repository's own `.git/hooks`, which is where git would have put the hooks anyway. The message names the path and offers three ways out.

**The symptom is not an error you will see.** `prepare` tolerates the failure so your install still exits zero, so what you get is a project with **no** pre-commit, pre-push or commit-msg hook and no sign of it beyond the one warning line above — secret scanning, the type check and the unit suite all silently stop guarding your commits. Two situations make it certain rather than likely: a **fresh clone**, and a **linked work tree** (`git worktree add`, which is what `josh lane:open` creates). An existing checkout hides it, because a `pnpm install` with nothing to do never runs `prepare` at all.

**This is not something kit can fix for you, and the reason is worth stating.** `core.hooksPath` lives in `.git/config`, which is per-clone; git deliberately provides no way to commit repository configuration, since a clone would then be able to activate arbitrary hooks on the machine that cloned it. Putting the hooks themselves in a tracked directory does not change that — the `git config` pointing at it still has to run once per clone.

Check and clear it:

```bash
git config --get core.hooksPath                 # prints the path when one is set
git config --unset-all --local core.hooksPath   # restores git's default — the same directory
```

The value is almost always redundant: it names `<repo>/.git/hooks`, which is git's default, so unsetting it changes nothing except that lefthook will install again. Re-run `pnpm install` (or `pnpm lefthook:install`) afterwards.

`lefthook install --reset-hooks-path` does the same unset for you, and `lefthook install --force` installs into the path without touching the setting. **Neither is wired into `prepare` on purpose**: rewriting a developer's git configuration as a side effect of `pnpm install` would break the setup of anyone who set that path deliberately.

### Dependency barrier (pre-push)

The pre-push hook runs its commands in parallel, and every one of them goes through pnpm. Before running anything, pnpm re-checks that `node_modules` matches `package.json` and installs when the two have drifted — which `josh bump` causes on nearly every push, because it rewrites `package.json` immediately before the commit. Left alone, each parallel command detects that drift at the same moment and starts its own install, so `node_modules/.bin` is rebuilt while the tests are already executing binaries from it. The symptom is a push that fails for an unrelated reason and passes when the same specs are re-run alone (kit#813).

The hook therefore declares a `setup` step that runs `pnpm install` once, before the parallel commands start. With the tree already synced none of the commands has anything to install.

You will see one `pnpm install` in the push output. When the tree is already in sync pnpm short-circuits without running any lifecycle script — measured at 0.25s — and when it is not, this install replaces the concurrent ones that previously ran inside each command.

This step is an optimization, not a gate: lefthook treats a failing `setup` as a warning and runs the commands anyway. That is intended — if the barrier fails, the dependencies are still out of sync and each command falls back to installing on its own, exactly as before, and a genuinely broken tree still fails the push from inside a command.

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
