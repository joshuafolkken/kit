# josh init — Detailed Behavior

`josh init` selects a project profile, then creates or merges the settings that apply to that project. It works in a directory without Git or a `package.json`.

In a repository with at least one commit, commit or stash your changes first (`git stash push -u -- .`): `josh init` lists any modified, staged or untracked file and stops before writing anything. The reasons and history are in [init-rationale.md](./maintainers/init-rationale.md); the issues each section came from are in `docs/maintainers/init-rationale.md` → "Where each section came from".

```bash
pnpm josh init

# Override the automatic decision for this run
pnpm josh init --profile basic

# Write the files only — skip the install and format it ends with
pnpm josh init --no-install

# Print what the setup would change, and change nothing
pnpm josh init --dry-run
```

## Preview with `--dry-run`

`josh init --dry-run` runs the real setup on a temporary copy of the project, prints what it changed there, and writes nothing to the project. The plan lists:

- **Files** — each path with what the setup would do to it: `create` (new), `merge` (every line, or for a JSON file every value, the project had is kept), `overwrite` (something the project had is replaced or removed) or `delete`.
- **`package.json`** — under its `merge` / `overwrite` line, each field and each script or dependency entry it would add (`+`), change (`~`) or remove (`-`).
- **Dependencies** — whether it would run `pnpm install` and `josh format`, and whether it would first install kit into the project and hand the setup to that copy's `josh init`. `--no-install --dry-run` reports that both are skipped.

`--dry-run` combines with `--profile` and `--no-install`, and is refused on uncommitted changes like a real run. `josh start --dry-run` prints the same plan for its setup step (see [josh-commands.md → `josh start`](./josh-commands.md#josh-start)).

## Project profiles

`josh profile` prints the selected profile and its reason, for example `profile: basic (no package.json)`.

- **`basic`** — AI rules, Prettier where the project has no formatter of its own, and editor / Git settings, for a project in any language.
- **`full`** — kit also runs the JavaScript / TypeScript toolchain: ESLint, type check, tests, Git hooks and CI.

| Priority | Condition                                                 | Profile             |
| -------- | --------------------------------------------------------- | ------------------- |
| 1        | `--profile basic` or `--profile full`                     | The requested value |
| 2        | `package.json` contains `josh.profile`                    | The recorded value  |
| 3        | No `package.json`                                         | `basic`             |
| 4        | Dependencies other than kit, or a `build` or `dev` script | `full`              |
| 5        | Metadata-only `package.json`                              | `basic`             |

kit itself does not count as a dependency, and an `index.html` file does not decide the profile. `josh init` records the first decision in `package.json` as `josh.profile` and keeps it on every re-run; pass `--profile` to change it.

The former names `static` and `node` still work as `basic` and `full`, recorded or passed to `--profile`. Re-running `josh init` records the new name. Why: `docs/maintainers/init-rationale.md` → "Renamed profiles".

Web files and Git are separate conditions: HTML, CSS, or JavaScript files (including `.mjs` and `.cjs`) enable Web formatting unless the project already has a formatter of its own (a `biome.json`, `biome.jsonc` or `dprint.json` — `.dprint.json` and the `.jsonc` forms too); TypeScript files enable a TypeScript config; a Git repository enables Git settings; a GitHub origin enables GitHub files.

| Setting or tool                                                                     | `basic`                                                                                                                 | `full`                                    |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `package.json`, `josh` script, kit dependency                                       | Always                                                                                                                  | Existing package scripts and dependencies |
| Prettier config, Prettier dependency, `.prettierignore`                             | When HTML, CSS, or JavaScript exists and the project has no formatter of its own                                        | Always                                    |
| `tsconfig.json`                                                                     | When TypeScript exists, without SvelteKit exclusions                                                                    | Always                                    |
| VS Code extensions                                                                  | Code Spell Checker, Material Icon Theme, Error Lens, Claude Code, GitHub Theme; add Prettier's with the Prettier config | Existing recommendations                  |
| VS Code save formatting                                                             | HTML, CSS, and JavaScript only with the Prettier config                                                                 | Existing settings                         |
| Short AI instructions and pointers                                                  | Always                                                                                                                  | Existing full instructions                |
| `.gitignore`, `.gitattributes`                                                      | When Git exists                                                                                                         | When Git exists                           |
| GitHub files                                                                        | When a GitHub origin exists                                                                                             | When a GitHub origin exists               |
| `.claude/settings.json` (permissions, hooks, the `kit@kit` plugin)                  | When `josh start` set the project up, in a Git repository                                                               | When Git exists                           |
| `JOSH_SESSION_LANG` in `.env`                                                       | When `josh start` set the project up, on first adoption — otherwise no hook reads it                                    | On first adoption, when `.env` lacks it   |
| ESLint, cspell CLI config, Playwright, Lefthook, secretlint, external MCP and hooks | Not installed by default                                                                                                | Existing behavior                         |

A `basic` project `josh start` set up gets `.claude/settings.json`, because the Issue workflow's unattended agents need its permissions. The setup records `josh.workflow: "github"` in `package.json`, so a later `josh init` or `josh sync` keeps writing the file. Why: `docs/maintainers/init-rationale.md` → "Claude settings for a `josh start` basic project".

VS Code extensions are recommendations, not automatic installs. Existing VS Code settings and added recommendations are kept when initialization runs again.

On the `full` profile, `josh init` writes `JOSH_SESSION_LANG` into `.env` from the OS locale (`LC_ALL`, `LC_MESSAGES`, then `LANG`): `ja` for a `ja` locale, `en` otherwise. A value exported in the shell wins. Nothing is written when `.env` already sets it or `.claude/settings.json` already wires the `session:lang` hook.

The basic profile writes `prettier.config.mjs`, which loads under either CommonJS or ESM. A Git-free `full` project does not receive kit's Git and GitHub `prepare` commands.

The distributed `ci.yml` is the same file for both profiles. Its Checks job runs `josh profile` first: a `basic` project then runs `josh gate`, which skips each check the project has no tool or files for; a `full` project runs `prepare`, the SvelteKit type check, Prettier, the build, ESLint, the unit tests and the size check.

To add Git later, run `git init`, then `josh init` again; the recorded profile is kept. After adding a GitHub origin, run `josh init` again for GitHub files.

## `josh init` or `josh start`

This section is the single source for choosing between them. One question decides which to run: **will this project use the GitHub Issue workflow** (`kickoff`, `fullrun`, `backlogrun`)? If it will, run `josh start`, whether or not the project already has Git or a GitHub repository. Otherwise run `josh init`. Both choose the [profile](#project-profiles) the same way.

| Situation                                                                                       | Run                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New or existing project that will use the GitHub Issue workflow                                 | `josh start`                                                                                                                                                            |
| Project that will not use it — no Git, another Git host, or only kit's rules, format and checks | `josh init`                                                                                                                                                             |
| Any re-run, or an unattended setup from CI or a script                                          | `josh init`                                                                                                                                                             |
| Set up with `josh init`, now moving to the GitHub Issue workflow                                | Commit what `josh init` wrote, then `josh start` — its setup pull request adds what the workflow needs on top: `josh.workflow` and, on `basic`, `.claude/settings.json` |

- **`josh init`** never asks anything. It creates and merges the settings files, and adds Git and GitHub files only when Git or a GitHub origin already exists. It never runs `git init`, creates a repository, commits or pushes, so it is safe to re-run and to automate.
- **`josh start`** asks, then runs the same setup as `josh init` and carries it to GitHub. What it does depends on what is already there:

| Before `josh start`                       | Steps                                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| No Git                                    | `git init` on `main` → setup → initial commit → `gh repo create` and push → labels  |
| Git without commits                       | setup → initial commit → `gh repo create` and push → labels                         |
| Commits on `main`, no origin              | setup → `gh repo create` and push the existing `main` → labels → setup pull request |
| GitHub origin, `main` does not record kit | setup → labels → setup pull request                                                 |
| GitHub origin, `main` already records kit | setup → labels                                                                      |

"Records kit" means the `package.json` committed on `main` lists `@joshuafolkken/kit` and records `josh.workflow: "github"`. "Labels" adds the workflow and release-classification labels the repository is missing. `gh repo create` makes a private repository unless `--public` is given.

**The setup pull request** files an Issue titled `Set up @joshuafolkken/kit` (label `ignore-for-release`), commits only the files kit's setup wrote on the Issue's `<N>-<slug>` branch, pushes and opens the pull request that closes the Issue. Merge it yourself; after that, `kickoff new` works. On a branch other than `main` the step is skipped.

- Commit or stash your changes first (`git stash push -u -- .`): with uncommitted changes `josh start` lists them and stops before changing anything.
- If a Git hook stops the commit, fix the cause and run `josh start` again on the setup branch; it reuses that branch's Issue.
- If the push or the pull request fails after the commit, finish on the setup branch with `git push` and `pnpm josh pr`.

The steps, options and safety rules are in [josh-commands.md → `josh start`](./josh-commands.md#josh-start).

## Run from outside the project

```bash
pnpm --allow-build=esbuild dlx @joshuafolkken/kit init
```

**Only the kit the project itself installed sets the project up.** A `josh init` run from anywhere else — `pnpm dlx`, a global install — compares its own directory with the project's `node_modules/@joshuafolkken/kit`. When they differ:

1. **It installs the project's kit.** A directory with no `package.json` first gets `{ "private": true }`, so pnpm does not install into an ancestor project. A project that does not list `@joshuafolkken/kit` gets `pnpm add -D` with the esbuild and unrs-resolver build approvals; one that lists it gets `pnpm install`, keeping its version.
2. **It hands the run to that kit** — `pnpm exec josh init` with the same arguments, in the project root.

`--no-install` installs nothing, so the kit that is running does the setup itself. Why: `docs/maintainers/init-rationale.md` → "Running from outside the project".

## Refused inside the package's own repository

`josh init` writes nothing and exits non-zero when the project it is aimed at **is**
`@joshuafolkken/kit` itself — see
[sync.md → Refused inside the distribution package's own repository](./sync.md#refused-inside-the-distribution-packages-own-repository).
An empty directory under the kit checkout (`kit/tmp/foo`) is refused too; one anywhere else is
scaffolded.

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

> Kit-only `.vscode/settings.json` keys (currently `sonarlint.connectedMode.project`) are never written into consumer projects.

### Claude Code permission mode

kit ships with permission prompts off, so the unattended commands (`fullrun`, `backlogrun`, …) do not stall:

- `.vscode/settings.json` sets `claudeCode.initialPermissionMode` to `bypassPermissions` and `claudeCode.allowDangerouslySkipPermissions` to `true`.
- `.claude/settings.json` sets `permissions.defaultMode` to `bypassPermissions` with `Bash(*)` allowed.

The `permissions.deny` list and the `pretool-guard` hook are a guardrail, not a sandbox. They match the start of a command to refuse destructive commands and reads of `.env`, `.env.*` and `.dev.vars` (`.env.example` and `.env.test` stay readable).

Another spelling of the same action gets through — `bash -c '…'`, `command git …`, `git -C . …`, or a script that opens the file itself. A command they let through is not thereby permitted.

With the prompts off, text the agent reads can run with your permissions. An instruction planted in an Issue, a pull request, a comment or a dependency's README may be followed, and the guardrail does not stop it. Two measures keep the exposure small:

- `pnpm josh issue:read` withholds a comment from an author without write access and marks such an author's Issue body as a report, not an instruction; the workflows read Issues through it.
- Give `gh` only the scopes the work needs — for example `gh auth refresh --remove-scopes delete_repo,admin:public_key`.

kit does not turn on Claude Code's sandbox by default ([#4022](https://github.com/joshuafolkken/kit/issues/4022)). The `gh` token stays reachable through github.com, which an allowlist has to keep, so the sandbox would not stop a leak through GitHub; and on macOS it breaks the `gh` and SSH `git push` calls `pnpm josh` makes.

**Since Claude Code v2.1.257, a `permissions.defaultMode` of `bypassPermissions` is ignored in `.claude/settings.json` and `.claude/settings.local.json`.** For an unattended run on a current CLI, set it in `~/.claude/settings.json` or pass `--permission-mode bypassPermissions`. `backlogrun` passes that flag to the sessions it starts.

**To opt out, decide before the first session:**

- To keep the prompts in the VS Code extension, set `"claudeCode.initialPermissionMode": "default"` and `"claudeCode.allowDangerouslySkipPermissions": false` in your `.vscode/settings.json`. Set the values rather than deleting the keys — `josh sync` adds a missing key back.
- On a Claude Code older than v2.1.257, override `permissions.defaultMode` in `.claude/settings.local.json`, not the project file — `josh sync` resets kit's keys there ([sync.md](./sync.md)).
- To rule the mode out on any version, set `"permissions": { "disableBypassPermissionsMode": "disable" }` in either file; kit does not ship that key, so it survives a sync.

### tsconfig merge strategy

The preset is **prepended** to the `extends` array so it does not override project-specific entries:

```jsonc
// before
{ "extends": ["./tsconfig.options.json"] }

// after
{ "extends": ["./node_modules/@joshuafolkken/kit/tsconfig/base.json", "./tsconfig.options.json"] }
```

### tsconfig exclude

This section is the one description of the `exclude` list; `josh sync` merges the same list ([sync.md](./sync.md#tsconfig-exclude--generated-output-and-sveltekit-exclusions)). `tsconfig.json` gets an `exclude` list covering the generated output plus SvelteKit's own service-worker exclusions:

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

On an existing file the list is union-merged: entries you added are kept, and re-running is a no-op. Why each entry is there is in `docs/maintainers/init-rationale.md` → "The tsconfig exclude list".

- **A custom `outDir`** outside `build` / `dist`: add it to the list — declaring `exclude` turns off TypeScript's implicit `outDir` exclusion.
- **A service worker moved with `kit.files.serviceWorker`**: add its path to the list yourself.
- **Your own `src/service-worker.ts` outside SvelteKit**: give it its own `tsconfig` with `lib: ["WebWorker"]`. The globs drop it from `tsc --noEmit`, and a sync adds them back if you delete them.

### playwright.config.ts

This file has no merge strategy. If it already exists, `josh init` prints the generated content so you can copy the relevant parts manually.

## Package scripts

The `full` profile adds these scripts to your `package.json`; the `basic` profile adds `preinstall` and `josh` — the same safe-chain `preinstall` as `full`:

| Script       | Command                                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preinstall` | `node -e "…"` (the local shell-integration check below)                                                                                             |
| `prepare`    | `(command -v lefthook >/dev/null 2>&1 && { lefthook install \|\| echo '…' >&2; } \|\| true) && (command -v tsx >/dev/null 2>&1 && tsx … \|\| true)` |
| `josh`       | `josh`                                                                                                                                              |

**A package you publish does not ship `preinstall`.** When `package.json` is not `private: true`, `josh init` also writes kit's `.pnpmfile.mjs`, which drops the safe-chain `preinstall` from the packed manifest; your repository keeps it. A pnpmfile of your own is kept, with a warning. See [sync.md](./sync.md) for the lockfile refresh it needs.

**`preinstall` scans nothing.** Your local `pnpm install` is scanned only once you install safe-chain's shell integration with the hash-verified steps in kit's [SECURITY.md](https://github.com/joshuafolkken/kit/blob/main/SECURITY.md#installing-safe-chain) and restart your terminal. Until then the `node -e` check prints a warning on each install (never in `CI`) and exits zero. On CI, installs run with `--ignore-scripts`, and the distributed `.github/actions/setup-pnpm` action installs safe-chain itself. `josh init` and `josh sync` replace a `preinstall` an earlier kit wrote (`pnpm dlx @aikidosec/safe-chain… setup-ci`) with this form and leave any other value alone.

**`prepare` installs the Git hooks** (`lefthook install` and `fix-gh-packages`); it runs on your local install, not when your package is installed as a dependency. Each step runs only when its binary is on `PATH` and is tolerated with `|| true`. A `lefthook install` that fails prints a warning on standard error and still exits zero — if you see it, your hooks are not installed ([`core.hooksPath`](#corehookspath-stops-lefthook-installing-anything) is the usual cause).

- When a `prepare` already exists, `josh init` appends the lifecycle to it; your own steps stay fail-fast.
- A script that already runs `fix-gh-packages` is not given a second copy.
- A kit-managed `postinstall` from an earlier version is moved to `prepare`; a custom `postinstall` is left alone.
- `josh sync` rewrites the `prepare` clause an earlier kit wrote to this form, and nothing else in `scripts`; run `pnpm install` afterwards for it to take effect.

Why `preinstall` and `prepare` take this form: `docs/maintainers/init-rationale.md` → "The safe-chain preinstall and the prepare lifecycle".

Every other toolchain task is a `pnpm josh <command>` subcommand, not a package script. Existing scripts are never overwritten.

## Dependencies

The `full` profile adds the packages below to `devDependencies`. The `basic` profile adds kit and, when Web files exist and the project has no formatter of its own, Prettier. An entry is only added when it is missing — an existing version is never overwritten, so re-running `josh init` is idempotent.

| Package                                                                                     | Version                                                                                                         |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `@joshuafolkken/kit`                                                                        | pinned to the running kit version (the generated configs import from this package, so it must be present)       |
| ESLint, TypeScript, `@playwright/test`, Prettier and its three preset plugins (kit's peers) | versions from kit's own development dependencies                                                                |
| `cspell`, `@types/node`                                                                     | versions from kit's own development dependencies                                                                |
| `lefthook`                                                                                  | version from kit's own development dependencies; only when Git exists (the only case `lefthook.yml` is written) |
| `secretlint`, `@secretlint/secretlint-rule-preset-recommend`                                | versions from kit's own development dependencies; see [Secret scanning](#secret-scanning-pre-commit)            |

Every generated config has its tool in this list, so `josh init` → `josh gate` passes in a new project with no manual install. These packages live in the project because Prettier, ESLint and the other tools resolve their plugins from it, not through kit. The generated `tsconfig.json` names `"types": ["node"]`. Under `--no-install`, a new project has no lefthook yet; your own install's `prepare` adds the hooks.

`packageManager` and `devEngines.packageManager.version` are written with kit's exact pnpm pin, or with the running pnpm when it is newer. The `allowBuilds` entries kit's `pnpm-workspace.yaml` approves are added to an existing `allowBuilds` map; entries you already answered keep their values.

`prettier.config.js` sets `tailwindStylesheet` only when the stylesheet exists: a name already in the file is kept while its file exists, and otherwise `src/routes/layout.css` is used when present. `josh init` and `josh sync` remove a stylesheet name whose file does not exist.

Re-running `josh init` adds any ESLint plugin an upgraded project is missing ([Update kit](./how-to/update-kit.md)).

### Available `pnpm josh` subcommands

The `josh` script runs every subcommand indexed in the [Command Catalog](./josh-command-catalog.md). The ones you type by hand are described in [josh-commands.md](./josh-commands.md) — for example [`josh lint`](./josh-commands.md#josh-lint), [`josh check`](./josh-commands.md#josh-check) and [`josh main:sync`](./josh-commands.md#josh-mainsync). The package scripts kit retired are listed in [init-rationale.md](./maintainers/init-rationale.md#retired-package-scripts) — `docs/maintainers/init-rationale.md` → "Retired package scripts".

## AI files

The following is the `full` profile's candidate list. Git and GitHub files are included only when their conditions hold. `SECURITY.md` is written from a template with your repository's `owner/repo` filled in, and skipped when the Git `origin` is not on GitHub. If a file already exists, it is skipped; in a `full` project the run ends with a hint to run `josh sync` to update it.

The `basic` profile copies short AI pointers and a `pnpm-workspace.yaml` that approves the esbuild and unrs-resolver build scripts, adds `.prettierignore` for Web files, and adds Git or GitHub files only when present.

```text
CLAUDE.md           AGENTS.md           GEMINI.md
CODE_OF_CONDUCT.md
.cursorrules        .coderabbit.yaml    .gitattributes
.mcp.json           .prettierignore     SECURITY.md
pnpm-workspace.yaml tsconfig.sonar.json
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

- **`CLAUDE.md` imports the rules.** It starts with a bootstrap instruction (run `pnpm install` and reread the file when kit is absent), then imports `@node_modules/@joshuafolkken/kit/dist/CLAUDE.md`, then your own additions. A package update keeps the rules current; `josh init` leaves an existing file untouched.
- **`AGENTS.md`, `GEMINI.md` and `.cursorrules` are copied**, because Codex, Gemini CLI and Cursor do not follow `@import`. They are short pointers to `CLAUDE.md`, with their `prompts/` and `eslint/` paths rewritten into `node_modules/@joshuafolkken/kit/…` ([sync.md → Path transformation](./sync.md#path-transformation)).
- **The skills ship as the `kit` Claude Code plugin.** `.claude/settings.json` enables it and carries the `permissions.deny` rules. Nothing needs installing: in a trusted workspace an interactive session loads the skills from its first session, a headless one (`claude -p`) from its second.
- **`sonar-project.properties`** is generated from the repository name `gh api repos/{owner}/{repo}` returns; without `gh` or a GitHub repository it is skipped with a warning.
- **The Codex files** are managed copies of kit's configuration. Run `josh sync` after updating kit to receive changes.

Why the AI files take this shape: `docs/maintainers/init-rationale.md` → "The AI files".

## Tool installs

After all files are processed, `josh init` runs:

1. **`pnpm install`** — installs the development dependencies it added. The `prepare` script it runs installs the git hooks defined in `lefthook.yml` (pre-commit, commit-msg, pre-push).
2. **`josh format`** — formats every file, including the ones `josh init` just wrote.

A failed install skips the format, and `josh init` exits non-zero with the commands to re-run by hand; `josh start` then stops before its commit. A failed format is only a warning. `josh gate` is not run, since in an existing project it can fail on the project's own code.

`--no-install` skips both, for CI or an offline machine. `josh init` then prints the `pnpm install` hint and, in a `full` project with Git, runs `lefthook install` only when lefthook is already installed.

### `core.hooksPath` stops lefthook installing anything

**lefthook refuses to install while git has a custom hooks path set**, even when it points at the repository's own `.git/hooks`. Your install still succeeds, with one warning line, and no pre-commit, pre-push or commit-msg hook runs. A fresh clone and a `git worktree add` (what `josh lane:open` creates) are where it shows up. kit cannot fix this for you: `core.hooksPath` lives in the per-clone `.git/config`.

Check and clear it:

```bash
git config --get core.hooksPath                 # prints the path when one is set
git config --unset-all --local core.hooksPath   # restores git's default — the same directory
```

Then re-run `pnpm install` (or `pnpm exec lefthook install`). `lefthook install --reset-hooks-path` does the same unset, and `lefthook install --force` installs without touching the setting; `prepare` runs neither, so a path you set on purpose is kept. Why kit does not clear it for you: `docs/maintainers/init-rationale.md` → "core.hooksPath".

### Dependency barrier (pre-push)

The pre-push hook runs one `pnpm install` as a `setup` step before its parallel commands, so they do not each start an install when `josh bump` has just changed `package.json`. You will see it in the push output; when the tree is already in sync it takes about 0.25s. A failing `setup` is only a warning. The reason is in `docs/maintainers/init-rationale.md` → "The pre-push dependency barrier".

### Secret scanning (pre-commit)

The pre-commit hook runs [secretlint](https://github.com/secretlint/secretlint) over the staged files, so a credential is caught before it enters git history. `josh init` provisions `.secretlintrc.json` (recommend preset) and the `secretlint` and `@secretlint/secretlint-rule-preset-recommend` devDependencies. The hook runs through [`josh secretlint-scan`](./josh-commands-automation.md#josh-secretlint-scan), which skips with a notice when the binary is absent.

> **Upgrading an existing project:** `josh sync` adds the same config and devDependencies, but the secret scan does **not** run until you run `pnpm install`.

To scan the whole tree rather than just staged files:

```bash
pnpm exec secretlint "**/*"
```

To make `josh` available system-wide, install the kit globally with `pnpm add -g @joshuafolkken/kit` (see [cli.md](./cli.md)).
