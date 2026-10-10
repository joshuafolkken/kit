# josh init — Detailed Behavior

`josh init` selects a project profile, then creates or merges the settings that apply to that project. It can initialize a directory without Git or an existing `package.json`. The reasons behind its choices are in [init-rationale.md](./maintainers/init-rationale.md); the issues each section came from are in `docs/maintainers/init-rationale.md` → "Where each section came from".

```bash
pnpm josh init

# Override the automatic decision for this run
pnpm josh init --profile basic

# Write the files only — skip the install and format it ends with
pnpm josh init --no-install
```

## Project profiles

`josh profile` prints the selected profile and its reason, for example `profile: basic (no package.json)`; a `basic` project also gets a `compat: profile: static (…)` line for workflows synced before the rename below. The profiles are `basic` (AI rules, formatting and editor / Git settings for a project of any language) and `full` (kit also runs the JavaScript / TypeScript toolchain: ESLint, type check, tests, Git hooks and CI). An `index.html` file does not decide the profile: Vite projects normally have one.

| Priority | Condition                                                 | Profile             |
| -------- | --------------------------------------------------------- | ------------------- |
| 1        | `--profile basic` or `--profile full`                     | The requested value |
| 2        | `package.json` contains `josh.profile`                    | The recorded value  |
| 3        | No `package.json`                                         | `basic`             |
| 4        | Dependencies other than kit, or a `build` or `dev` script | `full`              |
| 5        | Metadata-only `package.json`                              | `basic`             |

kit itself does not count as a dependency, so `pnpm add -D @joshuafolkken/kit` before `josh init` still selects `basic` for an `index.html` site. `josh init` records the first decision in `package.json` as `josh.profile`. Re-running it keeps that profile even after dependencies are added. Pass `--profile` to change the recorded value deliberately.

**`basic` and `full` were formerly called `static` and `node`** (`docs/maintainers/init-rationale.md` → "Renamed profiles"). The old names still work everywhere a profile is read: a recorded `josh.profile: static` or `node`, and `--profile static` or `--profile node`, mean `basic` and `full`. A project keeps its recorded old name until `josh init` runs again, which records the new one. The paths a `basic` project initialized earlier imports — `@joshuafolkken/kit/prettier/static` and `dist/CLAUDE.static.md` — keep resolving to the same preset and rules, and re-running `josh init` moves those two kit-written imports in `prettier.config.mjs` and `CLAUDE.md` onto `prettier/basic` and `dist/CLAUDE.basic.md`, leaving the rest of each file alone.

Web files and Git are separate conditions: HTML, CSS, or JavaScript files (including `.mjs` and `.cjs`) enable Web formatting; TypeScript files enable a TypeScript config; a Git repository enables Git settings; a GitHub origin enables GitHub files.

| Setting or tool                                                                     | `basic`                                                                                                    | `full`                                    |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `package.json`, `josh` script, kit dependency                                       | Always                                                                                                     | Existing package scripts and dependencies |
| Prettier config, Prettier dependency, `.prettierignore`                             | When HTML, CSS, or JavaScript exists                                                                       | Always                                    |
| `tsconfig.json`                                                                     | When TypeScript exists, without SvelteKit exclusions                                                       | Always                                    |
| VS Code extensions                                                                  | Code Spell Checker, Material Icon Theme, Error Lens, Claude Code, GitHub Theme; add Prettier for Web files | Existing recommendations                  |
| VS Code save formatting                                                             | HTML, CSS, and JavaScript only when Web files exist                                                        | Existing settings                         |
| Short AI instructions and pointers                                                  | Always                                                                                                     | Existing full instructions                |
| `.gitignore`, `.gitattributes`                                                      | When Git exists                                                                                            | When Git exists                           |
| GitHub files                                                                        | When a GitHub origin exists                                                                                | When a GitHub origin exists               |
| `JOSH_SESSION_LANG` in `.env`                                                       | Not written — the profile installs no hook that reads it                                                   | On first adoption, when `.env` lacks it   |
| ESLint, cspell CLI config, Playwright, Lefthook, secretlint, external MCP and hooks | Not installed by default                                                                                   | Existing behavior                         |

VS Code extensions are recommendations, not automatic installs. Code Spell Checker is not part of the initial CLI verification gate. Existing VS Code settings and added extension recommendations are preserved when initialization runs again. The `basic` Prettier preset needs no Svelte or Tailwind plugins.

On the `full` profile, `josh init` writes `JOSH_SESSION_LANG` into `.env` from the OS locale — the first non-empty of `LC_ALL`, `LC_MESSAGES` and `LANG` — so a new user's session starts in their language: `ja` for a locale starting with `ja`, `en` otherwise; a `JOSH_SESSION_LANG` already exported in the shell wins over the locale. A project already using kit keeps its language: nothing is written when `.claude/settings.json` already wires the `session:lang` hook or `.env` already sets the value, and the default when it is unset stays `ja`.

The basic profile writes `prettier.config.mjs`, which loads under either CommonJS or ESM package settings. Its `.prettierignore` keeps generated files out of formatting without excluding a site's `static/` source directory. A Git-free `full` project does not receive kit's Git and GitHub `prepare` commands.

The distributed `ci.yml` is the same file for both profiles. Its Checks job first runs `josh profile`: a `basic` project then runs `josh gate`, which skips each check the project has no tool or files for, while a `full` project runs the ordered steps — `prepare`, the SvelteKit type check, Prettier, the build, ESLint, the unit tests and the size check.

To add Git later, run `git init`, then run `josh init` again to add Git files without changing the recorded profile. After adding a GitHub origin, run `josh init` again for GitHub files.

## `josh init` or `josh start`

This section is the single source for choosing between `josh init` and `josh start`; the setup guides, the tutorial and the command reference link here. One question decides which to run: **will this project use the GitHub Issue workflow** (`kickoff`, `fullrun`, `backlogrun`)? If it will, run `josh start` — whether or not the project already has Git or a GitHub repository. If it will not, run `josh init`. The [profile](#project-profiles) is a separate question: both commands choose it the same way.

| Situation                                                                                       | Run                                                                  |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| New or existing project that will use the GitHub Issue workflow                                 | `josh start`                                                         |
| Project that will not use it — no Git, another Git host, or only kit's rules, format and checks | `josh init`                                                          |
| Any re-run, or an unattended setup from CI or a script                                          | `josh init`                                                          |
| Set up with `josh init`, now moving to the GitHub Issue workflow                                | `josh start` — its setup step leaves what `josh init` wrote as it is |

- **`josh init`** never asks anything. It selects the profile (or takes `--profile`), creates and merges the settings files, and adds Git and GitHub files only when Git or a GitHub origin already exists. It never runs `git init`, creates a GitHub repository, commits or pushes, so it is safe to re-run and to automate. Run in a Git repository whose checked-out commit does not record kit yet, it ends by pointing at `josh start`.
- **`josh start`** asks, then runs the same setup as `josh init` and carries it to GitHub. What it does depends on what is already there:

| Before `josh start`                       | Steps                                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| No Git                                    | `git init` on `main` → setup → initial commit → `gh repo create` and push → labels  |
| Git without commits                       | setup → initial commit → `gh repo create` and push → labels                         |
| Commits on `main`, no origin              | setup → `gh repo create` and push the existing `main` → labels → setup pull request |
| GitHub origin, `main` does not record kit | setup → labels → setup pull request                                                 |
| GitHub origin, `main` already records kit | setup → labels                                                                      |

"Records kit" means the `package.json` committed on the checked-out `main` lists `@joshuafolkken/kit`. "Labels" adds the workflow and release-classification labels the repository is missing. `gh repo create` makes a private repository unless `--public` is given.

**The setup pull request** brings the setup to a `main` that already has history the way every later change arrives, so nothing is committed to `main` directly. It files an Issue titled `Set up @joshuafolkken/kit` with the `ignore-for-release` label, creates the Issue's `<N>-<slug>` branch, stages **only the files kit's setup wrote** — the managed files `josh sync` keeps current, plus `CLAUDE.md`, `prettier.config.mjs`, `.aikido`, `package.json` and `pnpm-lock.yaml` — then commits only those files, pushes and opens the pull request that closes the Issue. Anything else in the working tree, such as a personal note or an editor's own directory — or a file you had already staged — stays out of the commit. The project's own Git hooks run on the commit and the push as on any other. Merging is left to you; once it is merged, `kickoff new` works. On a branch other than `main` there is no pull request to base on `main`, so the step is skipped. If a hook stops the commit, fix the cause and run `josh start` again on the setup branch it left checked out: it reuses that branch's Issue, so no second Issue is filed. If the push or the pull request fails after the commit, finish on the setup branch with `git push` and `pnpm josh pr`.

The steps, options and safety rules are in [josh-commands.md → `josh start`](./josh-commands.md#josh-start).

## Run from outside the project

```bash
pnpm --allow-build=esbuild dlx @joshuafolkken/kit init
```

**Only the kit the project itself installed sets the project up.** A `josh init` run from anywhere else — `pnpm dlx`, a global install — first compares its own directory with `node_modules/@joshuafolkken/kit` in the project, by real path. When they differ, it writes nothing itself beyond a bare `package.json`:

1. **It installs the project's kit.** A directory with no `package.json` first gets one containing only `{ "private": true }` — without it, pnpm walks up to the nearest ancestor's `package.json` and installs kit into that project instead, rewriting its files. A project whose `package.json` does not list `@joshuafolkken/kit` gets `pnpm add -D` with the build approvals kit's dependencies need (esbuild and unrs-resolver, read from the `basic` workspace template); one that lists it gets `pnpm install`, so the version it chose is kept.
2. **It hands the run to that kit** — `pnpm exec josh init` with the same arguments, in the project root.

`pnpm dlx` caches the package it fetched and reuses it for about a day, so the kit it runs can be older than the registry's. Before this hand-off, that kit wrote its own version into `package.json` and its own templates into the project. Now the version is whatever pnpm resolves for the project, under the project's `minimumReleaseAge`, and the kit of that version does the setup. A cached copy released before the hand-off existed still sets the project up on its own, until the cache expires.

`--no-install` installs nothing, so there is no project kit to hand off to: the kit that is running does the setup, as before.

## Refused inside the package's own repository

`josh init` writes nothing and exits non-zero when the project it is aimed at **is**
`@joshuafolkken/kit` itself. The message, the detection and why a downstream distributor is
unaffected are in [sync.md → Refused inside the distribution package's own repository](./sync.md#refused-inside-the-distribution-packages-own-repository).

A project with no `package.json` yet — the scaffolding case `init` exists for — never matches on the
name, because an unreadable manifest says nothing about who the project is. What still applies there
are the two location fallbacks: a directory that **is** the package directory, or one nested inside
it. So an empty directory created under the kit checkout (`kit/tmp/foo`) is refused, and `josh init`
in an empty directory anywhere else scaffolds exactly as before.

## Config files

The following table describes the `full` profile. The profile table above lists the smaller `basic` set. Each selected file is either created (if missing) or merged (if it already exists). Files without a merge strategy show a sample you can copy manually.

| File                      | If missing                                                                                                                                                  | If exists                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `.gitignore`              | Created from `templates/gitignore`                                                                                                                          | Union-merged: missing kit patterns appended, consumer-local entries kept                                                                    |
| `eslint.config.js`        | Created with `create_vanilla_config`                                                                                                                        | Regenerated from the vanilla template, keeping your `rules` blocks; a config not built on `create_vanilla_config` is left untouched         |
| `prettier.config.js`      | Created with shared config                                                                                                                                  | Regenerated from the shared preset; only `tailwindStylesheet` is kept                                                                       |
| `playwright.config.ts`    | Created with `create_playwright_config`                                                                                                                     | Sample shown — add manually                                                                                                                 |
| `tsconfig.json`           | Created with `extends` pointing to the preset, `"types": ["node"]`, and `exclude` covering the generated-output directories plus SvelteKit's own exclusions | Preset entry prepended to `extends` array; missing `exclude` entries appended                                                               |
| `cspell.config.yaml`      | Created with `import` pointing to the shared word list                                                                                                      | Import entry added under `import:` key (skipped when superseded by a transitive import, e.g. the game-kit import)                           |
| `lefthook.yml`            | Created with `extends` pointing to the preset                                                                                                               | Preset entry added under `extends:` key                                                                                                     |
| `.secretlintrc.json`      | Created enabling the recommend rule preset                                                                                                                  | Left untouched — the rule list is project-owned once it exists                                                                              |
| `.vscode/extensions.json` | Created from package template                                                                                                                               | Missing recommendations merged in                                                                                                           |
| `.vscode/settings.json`   | Created from package template                                                                                                                               | Missing keys merged in; a key the project already owns gains kit's missing entries when both values are objects (project entries win)       |
| `.vscode/tasks.json`      | Created from package template                                                                                                                               | Merged per task `label`: a task with a kit label is replaced in place, a missing kit task is appended, every other task is kept as authored |

> Kit-only `.vscode/settings.json` keys (currently `sonarlint.connectedMode.project`, which points at the kit's own SonarQube project) are stripped from the template before distribution, so they are never written into consumer projects.

### Claude Code permission mode

The template's `.vscode/settings.json` sets `claudeCode.initialPermissionMode` to `bypassPermissions` and `claudeCode.allowDangerouslySkipPermissions` to `true`, and the distributed `.claude/settings.json` sets `permissions.defaultMode` to `bypassPermissions` with `Bash(*)` allowed. The issue-driven commands (`fullrun`, `backlogrun`, …) run unattended and stall on a permission prompt, so this is the default kit ships: where the mode applies, Claude Code runs tools without asking, and the `permissions.deny` list plus the `pretool-guard` hook are what stand between a session and a destructive command or a secret file. Both refuse a read of `.env`, `.env.*` and `.dev.vars` — the deny list for the Read tool and the shell readers Claude Code recognizes, the hook for the rest (`source .env.local`) — and both leave the tracked `.env.example` and `.env.test` readable. A script or subprocess that opens the file itself is outside both.

**Where the mode applies depends on the Claude Code version.** Since Claude Code v2.1.257 a `permissions.defaultMode` of `bypassPermissions` is ignored in project and local settings (`.claude/settings.json`, `.claude/settings.local.json`), so on a current CLI the distributed value does nothing and a session still prompts: for an unattended run, set it in your user settings (`~/.claude/settings.json`) or pass `--permission-mode bypassPermissions`. Before v2.1.257 the distributed value takes effect as written.

**This is opt-out, not opt-in — decide before the first session.** Both `.vscode/settings.json` keys are scalars, so the merge never touches a value the project already owns:

- To keep the prompts in the VS Code extension, set `"claudeCode.initialPermissionMode": "default"` and `"claudeCode.allowDangerouslySkipPermissions": false` in your `.vscode/settings.json`. Set the values rather than deleting the keys — `josh sync` adds a missing key back.
- `josh sync` overwrites `.claude/settings.json`, so on a Claude Code older than v2.1.257 override `permissions.defaultMode` in `.claude/settings.local.json` instead of editing the distributed file; user settings rank below the project file and do not override it. To rule the mode out on any version, set `"permissions": { "disableBypassPermissionsMode": "disable" }` there.

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

The `src/service-worker*` globs are there because that same override rule cuts the other way. A SvelteKit project extends `./.svelte-kit/tsconfig.json`, which excludes those paths itself — SvelteKit keeps the service worker out of the app program deliberately, since it runs in a worker context with its own `lib` (`WebWorker`, not `DOM`) and its own generated `$service-worker` ambient types, so type-checking it under the app config produces errors with no correct fix from inside that config. The moment kit writes any `exclude` key, the generated config's array is replaced outright and all six are discarded. Repeating them makes kit's list additive rather than replacing. SvelteKit's remaining entry, `../node_modules/**`, is already covered by `node_modules`.

They are written unconditionally — kit does not detect SvelteKit, and at `josh init` time the generated config does not exist yet to be read. In a non-SvelteKit project the paths usually match nothing. If yours does keep its own `src/service-worker.ts`, note that it is a program root nothing imports, so excluding it drops it from `tsc --noEmit`, and a re-sync re-adds the globs if you delete them. Give that file its own `tsconfig` — worker code wants `lib: ["WebWorker"]` rather than the app's `DOM` in any case.

They are also the **default** paths only. If you moved the worker with `kit.files.serviceWorker` in `svelte.config.js`, these globs match nothing and SvelteKit's real exclusion is still replaced — add your own path to `exclude` yourself. The merge only appends, so a hand-added entry survives every later sync.

### playwright.config.ts

This file has no merge strategy. If it already exists, `josh init` prints the generated content so you can copy the relevant parts manually.

## Package scripts

The `full` profile adds these scripts to your `package.json`; the `basic` profile adds `preinstall` and `josh` — the same safe-chain `preinstall` as `full`:

| Script       | Command                                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preinstall` | `node -e "…"` (the local shell-integration check below)                                                                                             |
| `prepare`    | `(command -v lefthook >/dev/null 2>&1 && { lefthook install \|\| echo '…' >&2; } \|\| true) && (command -v tsx >/dev/null 2>&1 && tsx … \|\| true)` |
| `josh`       | `josh`                                                                                                                                              |

**A package you publish does not ship it.** When `package.json` is not `private: true`, `josh init` (both profiles) also writes kit's `.pnpmfile.mjs`, whose `beforePacking` hook drops the safe-chain `preinstall` from the manifest `pnpm pack` and `pnpm publish` write; your repository keeps it, and any other lifecycle script ships as before. Without it, every project that installs your package would have to approve the script as a build script — pnpm fails `pnpm add` on it otherwise ([#3110](https://github.com/joshuafolkken/kit/issues/3110)). A pnpmfile of your own — a `.pnpmfile.mjs` without kit's `// josh-managed-pnpmfile: @joshuafolkken/kit` first line, a `.pnpmfile.cjs`, or a `pnpmfile` setting — is kept, with a warning. See [sync.md](./sync.md) for the lockfile refresh it needs.

**What `preinstall` protects, and what it does not.** It fetches nothing and scans nothing: **a `pnpm install` on your machine is scanned only once you enable safe-chain's own shell integration.** Install safe-chain with the hash-verified steps in kit's [SECURITY.md](https://github.com/joshuafolkken/kit/blob/main/SECURITY.md#installing-safe-chain) and restart your terminal. kit does not run that for you, because it rewrites your shell configuration. Instead, the `node -e` check prints a warning pointing there whenever the install is not running behind safe-chain's proxy (safe-chain hands `GLOBAL_AGENT_HTTP_PROXY` to the package manager it wraps); it always exits zero and stays silent when `CI` is set. Both `josh init` and `josh sync` replace a `preinstall` kit wrote earlier — `pnpm dlx @aikidosec/safe-chain[@<version>] setup-ci`, alone or followed by an earlier `node -e` check — with this form, and leave any other value alone; that earlier form downloaded safe-chain without a hash check on every install, and its `setup-ci` acts only on a CI runner. On CI, kit does not rely on `preinstall` at all — installs run with `--ignore-scripts` — so the distributed `ci.yml` and `pr-classification.yml` install through the distributed `.github/actions/setup-pnpm` action, whose "Setup safe-chain" step installs the binary with safe-chain's hash-verified release installer in `--ci` mode, pinned by that step's `SAFE_CHAIN_INSTALLER_VERSION` / `SAFE_CHAIN_INSTALLER_SHA256` env.

The lifecycle hooks (`lefthook install` + `fix-gh-packages`) live in **`prepare`**, not `postinstall`. `prepare` runs on a local `pnpm install` and during `pack`/`publish`, but **not** when your package is installed as a dependency by a consumer — which is the correct scope for these developer-only hooks. The command is **guarded**: each step runs only when its binary is on `PATH`, and each optional hook is individually tolerated with `|| true`, chained with `&&`. This prevents a missing `lefthook`/`tsx` (or a failing optional hook) from aborting `pnpm install` in production or CI installs that omit dev dependencies — **without** masking the core steps it is appended to.

**A `lefthook install` that runs and fails says so on standard error.** It still exits zero — a consumer's install must not die over a developer-only hook, which is what the `|| true` is for — but silence was never part of that bargain: a missing binary and a binary that failed were indistinguishable, so an install leaving **zero** hooks in place reported success and the developer went on committing for weeks with no pre-commit or pre-push check running at all. The warning sits **inside** the branch the binary check already gates, so the ordinary production install — where `lefthook` is simply absent — stays exactly as quiet as it was. When `josh init` appends the lifecycle to an existing `prepare` (e.g. `pnpm gen && svelte-kit sync`), those core steps stay fail-fast: if they fail, `prepare` still exits non-zero.

**A project that was already initialized gets the same rewrite from `josh sync`.** Re-running `josh init` is not how consumers upgrade, so the warning would otherwise have reached new projects only — leaving exactly the population the fix was written for on the silent install. `josh sync` matches the clause kit itself wrote and nothing else, and the change takes effect on the next `pnpm install`. See [sync.md](./sync.md#what-does-not-get-synced).

When a `prepare` already exists, `josh init` appends the lifecycle to it rather than replacing it. If a script already runs `fix-gh-packages`, `josh init` skips re-adding the hook so re-running it never duplicates. A kit-managed `postinstall` from an earlier version (one that runs `fix-gh-packages`) is migrated to `prepare`; a custom `postinstall` of your own is left untouched.

All other toolchain tasks are available as `pnpm josh <command>` subcommands — they are **not** added as separate package scripts. Existing scripts are never overwritten.

## Dependencies

The `full` profile adds the packages below to `devDependencies`. The `basic` profile adds kit and, when Web files exist, Prettier. An entry is only added when it is missing — an existing version is never overwritten, so re-running `josh init` is idempotent.

| Package                                                                                     | Version                                                                                                         |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `@joshuafolkken/kit`                                                                        | pinned to the running kit version (the generated configs import from this package, so it must be present)       |
| ESLint, TypeScript, `@playwright/test`, Prettier and its three preset plugins (kit's peers) | versions from kit's own development dependencies                                                                |
| `cspell`, `@types/node`                                                                     | versions from kit's own development dependencies                                                                |
| `lefthook`                                                                                  | version from kit's own development dependencies; only when Git exists (the only case `lefthook.yml` is written) |
| `secretlint`, `@secretlint/secretlint-rule-preset-recommend`                                | versions from kit's own development dependencies; see [Secret scanning](#secret-scanning-pre-commit)            |

Every generated config has its tool in this list, so `josh init` (which installs them) → `josh gate` passes in a new project with no manual install: `prettier.config.js` needs `prettier`, `cspell.config.yaml` needs `cspell`, `playwright.config.ts` needs `@playwright/test` and `@types/node`, and `lefthook.yml` needs `lefthook`. The generated `tsconfig.json` names `"types": ["node"]`, because TypeScript 6 no longer loads installed `@types/*` packages by default. The `pnpm install` that `josh init` ends with runs the `prepare` script, which installs the hooks; under `--no-install` a new project has no lefthook yet, so `josh init` reports that and leaves the hooks to the `prepare` script of your own install.

`packageManager` and `devEngines.packageManager.version` are written with kit's exact pnpm pin. pnpm removes `packageManager` from a published manifest, so the pin is read from the installed kit's `devEngines` when the field is absent. An older pnpm then reads that exact version instead of rejecting a `>=` range as an invalid `packageManager` specification. When `josh init` runs under a pnpm newer than kit's pin, it writes that running version instead, so the project is never pinned below the pnpm that installed it and wrote its lockfile. The `allowBuilds` entries kit's `pnpm-workspace.yaml` approves are added to an existing `allowBuilds` map. `pnpm add -D @joshuafolkken/kit` always leaves such a map before `josh init` runs. Entries you already answered keep their values.

`prettier.config.js` sets `tailwindStylesheet` only when the stylesheet exists: a name already in the file is kept while its file exists, and otherwise `src/routes/layout.css` is used when present. prettier-plugin-tailwindcss stops formatting when the named file is missing, so `josh init` and `josh sync` remove a stylesheet name whose file does not exist, including the default that earlier kit versions wrote into every node project.

The three `prettier-plugin-*` / `@ianvs/prettier-plugin-sort-imports` entries back the kit prettier preset (`@joshuafolkken/kit/prettier`), whose `plugins[]` references all three by name. prettier resolves plugins from the **consumer** project rather than transitively through the kit, so every project that uses the preset must declare them locally — otherwise `prettier`/`josh lint` fails with `Cannot find package`.

The ESLint preset likewise resolves ESLint and its plugins from the consumer project. `josh init` adds them alongside the generated ESLint config, and re-running it adds any that an upgraded project is missing ([Update kit](./how-to/update-kit.md)).

### Available `pnpm josh` subcommands

The `josh` script runs every subcommand indexed in the [Command Catalog](./josh-command-catalog.md). The ones you type by hand are described in [josh-commands.md](./josh-commands.md) — for example [`josh lint`](./josh-commands.md#josh-lint), [`josh check`](./josh-commands.md#josh-check) and [`josh main:sync`](./josh-commands.md#josh-mainsync). The package scripts kit retired are listed in [init-rationale.md](./maintainers/init-rationale.md#retired-package-scripts) — `docs/maintainers/init-rationale.md` → "Retired package scripts".

## AI files

The following is the `full` profile's candidate list. Git and GitHub files are included only when their respective conditions hold. The `basic` profile copies short AI pointers, a `pnpm-workspace.yaml` that approves the esbuild and unrs-resolver build scripts (kit's CLI runs on tsx, which depends on esbuild; kit's optional ESLint import plugins bring in unrs-resolver; and pnpm fails an install with an unapproved build), adds `.prettierignore` for Web files, and adds Git or GitHub files only when present. If a file already exists, it is skipped; in a `full` project the run ends with a hint to run `josh sync` to update it.

```text
CLAUDE.md           AGENTS.md           GEMINI.md
CODE_OF_CONDUCT.md
.cursorrules        .coderabbit.yaml    .gitattributes
.mcp.json           .ncurc.json         .prettierignore
SECURITY.md         pnpm-workspace.yaml tsconfig.sonar.json
.github/workflows/ci.yml
.github/workflows/auto-tag.yml
.github/workflows/dependabot-auto-merge.yml
.github/workflows/github-release.yml
.github/workflows/pr-classification.yml
.github/workflows/production.yml
.github/workflows/sonar-qube.yml
.github/actions/setup-pnpm/action.yml
.github/actions/setup-node/action.yml
.github/pull_request_template.md
.github/release.yml
.github/dependabot.yml
.claude/settings.json
.codex/config.toml
.codex/hooks.json
sonar-project.properties  (generated from GitHub repo name)
```

`CLAUDE.md` carries every agent rule, but it is **not byte-copied** — it is distributed by import. The package ships an already-path-transformed copy at `node_modules/@joshuafolkken/kit/dist/CLAUDE.md` (generated at publish time by `scripts/build/build-claude-md.ts`). The consumer's tracked `CLAUDE.md` starts with a bootstrap instruction: when kit is absent, run `pnpm install` and reread the file before other work. It then imports `@node_modules/@joshuafolkken/kit/dist/CLAUDE.md`, followed by any project additions. A package update alone keeps the rules current — no `josh sync` needed. `josh init` writes this file when the consumer has none, and leaves an existing one untouched. `AGENTS.md`, `GEMINI.md` and `.cursorrules` **remain byte-copies**, because the other tools that read them (Codex, Gemini CLI, Cursor) do not follow CLAUDE.md's `@import`; `AGENTS.md` and `GEMINI.md` are short pointers to `CLAUDE.md` and hold no rules of their own. The copied files have their `prompts/` and `eslint/` paths rewritten to `node_modules/@joshuafolkken/kit/…` so they resolve in the consuming project — the pointers included, since each one tells the reader to open `prompts/*.md` when `CLAUDE.md` names one. The four skills (`workflow-commands`, `epic-commands`, `dependency-update`, `verify-ui`) are no longer copied: they ship as the `kit` Claude Code plugin and load from the package. `.claude/settings.json` still carries the `permissions.deny` rules a plugin cannot provide, and now also declares the `kit` marketplace and enables the `kit` plugin; nothing needs installing — in a trusted workspace an interactive session loads the skills from its first session, a headless one (`claude -p`) from its second. `josh sync` removes any stale copied skill directory whose content still matches the shipment.

`sonar-project.properties` is generated from the GitHub repo name fetched via `gh api repos/{owner}/{repo}`. If `gh` is not available or the repo cannot be identified, the file is skipped with a warning.

The Codex files are managed copies of kit's project configuration. An existing file is left alone by `josh init`; run `josh sync` after installing an updated kit to receive changes. The copied `.codex/hooks.json` invokes the installed kit bundles from the consumer project.

## Tool installs

After all files are processed, `josh init` runs:

1. **`pnpm install`** — installs the development dependencies it added. The `prepare` script it runs installs the git hooks defined in `lefthook.yml` (pre-commit, commit-msg, pre-push).
2. **`josh format`** — formats every file, including the ones `josh init` just wrote.

A failed install skips the format, and `josh init` exits non-zero with the commands to re-run by hand; `josh start` then stops before its initial commit or setup pull request. A failed format is only a warning: in a `full` project `josh format` also runs `eslint --fix`, which fails on the project's own unfixable errors. `josh gate` is deliberately not run: in an existing project it can fail on the project's own code, which is not a failed setup.

`--no-install` skips both, for CI or an offline machine. `josh init` then prints the `pnpm install` hint and, in a `full` project with Git, runs `lefthook install` only when lefthook is already installed.

### `core.hooksPath` stops lefthook installing anything

**lefthook refuses to install while git has a custom hooks path set**, and it refuses whatever that path points at — including the repository's own `.git/hooks`, which is where git would have put the hooks anyway. The message names the path and offers three ways out.

**The symptom is not an error you will see.** `prepare` tolerates the failure so your install still exits zero, so what you get is a project with **no** pre-commit, pre-push or commit-msg hook and no sign of it beyond the one warning line above — secret scanning, the type check and the unit suite all silently stop guarding your commits. Two situations make it certain rather than likely: a **fresh clone**, and a **linked work tree** (`git worktree add`, which is what `josh lane:open` creates). An existing checkout hides it, because a `pnpm install` with nothing to do never runs `prepare` at all.

**This is not something kit can fix for you, and the reason is worth stating.** `core.hooksPath` lives in `.git/config`, which is per-clone; git deliberately provides no way to commit repository configuration, since a clone would then be able to activate arbitrary hooks on the machine that cloned it. Putting the hooks themselves in a tracked directory does not change that — the `git config` pointing at it still has to run once per clone.

Check and clear it:

```bash
git config --get core.hooksPath                 # prints the path when one is set
git config --unset-all --local core.hooksPath   # restores git's default — the same directory
```

The value is almost always redundant: it names `<repo>/.git/hooks`, which is git's default, so unsetting it changes nothing except that lefthook will install again. Re-run `pnpm install` (or `pnpm exec lefthook install`) afterwards.

`lefthook install --reset-hooks-path` does the same unset for you, and `lefthook install --force` installs into the path without touching the setting. **Neither is wired into `prepare` on purpose**: rewriting a developer's git configuration as a side effect of `pnpm install` would break the setup of anyone who set that path deliberately.

### Dependency barrier (pre-push)

The pre-push hook runs its commands in parallel, and every one of them goes through pnpm. Before running anything, pnpm re-checks that `node_modules` matches `package.json` and installs when the two have drifted — which `josh bump` causes on nearly every push, because it rewrites `package.json` immediately before the commit. Left alone, each parallel command detects that drift at the same moment and starts its own install, so `node_modules/.bin` is rebuilt while the tests are already executing binaries from it. The symptom is a push that fails for an unrelated reason and passes when the same specs are re-run alone.

The hook therefore declares a `setup` step that runs `pnpm install` once, before the parallel commands start. With the tree already synced none of the commands has anything to install.

You will see one `pnpm install` in the push output. When the tree is already in sync pnpm short-circuits without running any lifecycle script — measured at 0.25s — and when it is not, this install replaces the concurrent ones that previously ran inside each command.

This step is an optimization, not a gate: lefthook treats a failing `setup` as a warning and runs the commands anyway. That is intended — if the barrier fails, the dependencies are still out of sync and each command falls back to installing on its own, exactly as before, and a genuinely broken tree still fails the push from inside a command.

### Secret scanning (pre-commit)

The kit pre-commit hook runs [secretlint](https://github.com/secretlint/secretlint) over the staged files, so a credential is caught before it enters git history. This sits ahead of GitHub push protection and PR-time scanners, which only fire once a commit exists — and push protection alone covers just the known provider patterns, not generic tokens.

`josh init` provisions everything needed: `.secretlintrc.json` (recommend preset) plus the `secretlint` and `@secretlint/secretlint-rule-preset-recommend` devDependencies. The devDependencies live in the **consumer** project rather than in kit, because pnpm's isolated `node_modules` never exposes a kit dependency's bin to the consumer's `pnpm exec`.

The hook runs through [`josh secretlint-scan`](./josh-commands-automation.md#josh-secretlint-scan), which skips with a notice when the binary is absent instead of failing the commit.

> **Upgrading an existing project:** `josh sync` adds the same config and devDependencies, but the packages are not present until you run `pnpm install`. Until then every commit prints the skip notice and the secret scan does **not** run — run `pnpm install` immediately after syncing to restore it.

To scan the whole tree rather than just staged files:

```bash
pnpm exec secretlint "**/*"
```

To make `josh` available system-wide, install the kit globally with `pnpm add -g @joshuafolkken/kit` (see [cli.md](./cli.md)). `josh init` no longer writes a `~/.local/bin/josh` shim.
