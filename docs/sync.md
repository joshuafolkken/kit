# josh sync — Detailed Behavior

`josh sync` overwrites managed files in your project with the latest versions from the installed `@joshuafolkken/kit` package. Run it after upgrading the package.

```bash
pnpm josh sync
```

Unlike `josh init` (which skips existing files), `josh sync` is designed for keeping managed files up to date. Most managed files are overwritten; `pnpm-workspace.yaml` is merged (see below).

## What gets synced

### AI files (overwritten)

These files are copied verbatim from the package, with one path transformation applied (see below):

```text
CLAUDE.md           AGENTS.md           GEMINI.md
CODE_OF_CONDUCT.md
.cursorrules        .coderabbit.yaml    .gitattributes
.mcp.json           .ncurc.json         .prettierignore
SECURITY.md         tsconfig.sonar.json
.github/workflows/ci.yml
.github/workflows/auto-tag.yml
.github/workflows/production.yml
.github/workflows/sonar-qube.yml
.github/pull_request_template.md
.github/release.yml
.github/dependabot.yml
```

> **GitHub Actions workflows are single-sourced by the kit.** Every consumer-facing workflow
> (`ci.yml`, `auto-tag.yml`, `production.yml`, `sonar-qube.yml`) is overwritten on
> each `josh sync`, so action SHA pins are bumped once in the kit and propagated to all consumers —
> no per-consumer maintenance. The kit's own `github-actions` Dependabot is what bumps those pins at
> the source; `josh sync` then distributes them. The `github-actions` entry in the distributed
> `dependabot.yml` is intentionally kept as a backstop (it covers any non-kit workflow a consumer
> adds, and finds nothing to bump for synced workflows since their pins are already current).

### `pnpm-workspace.yaml` (merged)

`pnpm-workspace.yaml` is **merged**, not overwritten. Your existing file is the base: all top-level keys it already has (user-added keys like `packages:`, and any value you already set on a managed key) are preserved as-is. Kit-managed keys the template introduces (`minimumReleaseAgeExclude`, `allowBuilds`, `overrides`, `trustLockfile`) are appended only when missing.

`trustLockfile: true` skips pnpm 11.5's install-time supply-chain re-verification of the committed lockfile. Without it, clean CI environments (e.g. Cloudflare Workers Builds) that cannot authenticate private `@joshuafolkken/*` GitHub Packages hit a false `ERR_PNPM_TARBALL_URL_MISMATCH`. `minimum-release-age` still applies at resolution time, so age-based supply-chain protection is preserved.

### File mappings (overwritten if source exists)

These are fully-managed files whose package source has a different name than the destination. They are byte-copied on every sync (consumers do not hand-edit them):

| Package source               | Destination                |
| ---------------------------- | -------------------------- |
| `templates/workflows/ci.yml` | `.github/workflows/ci.yml` |

If the source file does not exist in the installed package, the destination is skipped with a warning.

> `.gitignore` used to be a byte-copy mapping here, which wiped project-local entries on every sync. It is now **union-merged** instead — see the merged-config table below.

### `sonar-project.properties` (regenerated)

The Sonar config is regenerated from the current GitHub repo name (fetched via `gh repo view`). If `gh` is unavailable or the repo cannot be identified, this file is skipped with a warning.

The project key and organization are derived from the `owner/repo` slug:

- `project_key` → `owner_repo` (slash replaced with underscore, lowercased)
- `organization` → `owner` (lowercased)

### Config files (merged, only when already present)

These files are created by `josh init`. `josh sync` refreshes them in place by reusing the same merge functions `init` uses — never created on first run, so projects that opted out stay opted out. Each handler is idempotent: when the file is already current, it logs `unchanged` and skips the write.

`.secretlintrc.json` is the one exception: it **is** created when missing, because the pre-commit secret scan it configures ships to every consumer through `lefthook/base.yml` and cannot run without it. There is no opt-out to preserve — a project that predates the rule simply has no such file yet.

| File                      | Merge strategy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.gitignore`              | Append any missing kit ignore patterns; consumer-local entries are preserved. Matching is per-line and comments/blank lines are skipped, so re-running is a no-op                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `.npmrc`                  | Append any missing lines from the kit's required-lines list, and remove the obsolete `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}` line — pnpm ignores env-var credentials from a project `.npmrc`, so it only produced a warning on every command (the credential belongs in `~/.npmrc`; see [authentication.md](./authentication.md)). A line holding a literal token is kept, because pnpm still honors it. When the line is removed, sync prints where the credential belongs, so a project on pnpm < 11.6 (where the line did still work) is not left with a silent 401                                                                                   |
| `eslint.config.js`        | Overwrite with the current kit template (no merge — same model as Playwright)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `tsconfig.json`           | Rewrite a retired `@joshuafolkken/*/tsconfig/*.jsonc` preset path to `.json`, then prepend the kit preset to the `extends` array — unless an `@joshuafolkken/*` tsconfig preset that already embeds kit base is present (e.g. app-kit's `tsconfig/sveltekit.json`) — then strip any `compilerOptions` key whose value equals the kit base preset (removing it as empty); value-divergent overrides and `include` are preserved, and the generated-output directories (`playwright-report`, `test-results`, plus `node_modules` / `build` / `dist`) are union-merged into `exclude`. Rewrites are emitted prettier-clean (short arrays like `exclude` stay on one line) |
| `cspell.config.yaml`      | Prepend the kit import to the `import:` list, unless already present or superseded by an `@joshuafolkken/*` cspell preset that already imports kit base (e.g. app-kit's or game-kit's import)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `lefthook.yml`            | Prepend the kit preset to the `extends:` list — unless an `@joshuafolkken/*` lefthook preset that already extends kit base is present (e.g. app-kit's `lefthook/sveltekit.yml`); adding a second kit-base extend would crash lefthook with a "possible recursion in extends" error                                                                                                                                                                                                                                                                                                                                                                                     |
| `.secretlintrc.json`      | Created when absent; an existing file is never rewritten, because its rule list becomes project-owned (custom patterns, deliberate exclusions) once written                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `package.json`            | Add the `secretlint` / `@secretlint/secretlint-rule-preset-recommend` devDependencies when missing, so projects initialized before the secretlint pre-commit rule can run it. A version the consumer already pinned is never changed. Until the following `pnpm install` lands the packages, the hook skips with a notice rather than blocking the commit                                                                                                                                                                                                                                                                                                              |
| `.vscode/extensions.json` | Append missing kit recommendations to `recommendations`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `.vscode/settings.json`   | Add missing top-level keys; for a key the project already owns, merge in kit's missing entries when both values are objects (a project entry always wins over kit's). Array- and scalar-valued keys the project owns are never touched                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Kit-only `.vscode/settings.json` keys (currently `sonarlint.connectedMode.project`, which points at the kit's own SonarQube project) are stripped from the template before distribution, so they are never written into consumer projects.

Object-valued settings are registries of independent entries (`files.associations`, `editor.codeActionsOnSave`, the per-language `[typescript]` blocks), so sync merges them one entry at a time: kit's entries are added, and any entry the project already declares keeps its own value. Without this, a project that customized such a key for one reason would silently never receive any later kit addition inside it. Arrays stay create-only — combining a list like `eslint.validate` would be a guess about intent, and overwriting it would drop the project's own entries.

### tsconfig normalization

`josh sync` keeps consumer `tsconfig.json` files minimal: any `compilerOptions` key whose value already equals the kit base preset (`base.json`) is redundant — the preset supplies it via `extends` — so sync removes it. A key whose value **differs** from the base (e.g. a library's `noEmitOnError: false`) is an intentional override and is preserved — sync cannot tell a necessary override from an unnecessary one, so it conservatively keeps every value-divergent key. `include` and project-specific keys the base does not define are also left untouched; `exclude` is union-merged (next section).

### tsconfig exclude — generated output directories

`josh sync` union-merges `node_modules`, `build`, `dist`, `playwright-report` and `test-results` into the consumer `exclude`: entries the project authored are kept verbatim, only missing ones are appended, and a re-sync on an already-merged file is a no-op.

The reason it is a merge rather than a create-only write: every existing consumer already has a `tsconfig.json`, so a strategy that only writes new files would leave the whole installed base type-checking Playwright's generated report. `playwright.config.ts` points the `html` reporter at `playwright-report/`, which holds Playwright's own minified trace-viewer bundle — a project with a broad `include` gets thousands of `tsc --noEmit` errors from third-party output right after running the E2E suite kit ships the config for. The report directory cannot simply live under the already-ignored `test-results/`: Playwright rejects an HTML output folder nested inside the tests output folder (and vice versa) as a configuration error, so both directories are excluded instead.

The entries must land in the **consumer** file: a `tsconfig.json` `exclude` **overrides** the extended preset's rather than merging with it, so putting them in `base.json` — or in app-kit's `tsconfig/sveltekit.json` — would have no effect on any project that declares its own. Declaring `exclude` also disables TypeScript's implicit exclusion of `outDir`, so a project with a custom `outDir` outside `build` / `dist` should add it to the list.

### tsconfig preset extension migration

kit-family tsconfig presets shipped as `*.jsonc` until kit 1.23. Playwright ≥ 1.62 appends `.json` to any `extends` entry that does not already end in it and then throws when the resulting path is missing, so a `.jsonc` preset resolved to `*.jsonc.json` and `playwright.config.ts` failed to load at all — the whole E2E suite could not start. The presets are now shipped as `*.json`, and `josh sync` rewrites any `extends` entry matching `@joshuafolkken/*/tsconfig/*.jsonc` to the `.json` path so an upgrading consumer is repaired automatically. Only kit-family preset paths are rewritten; a project-local `.jsonc` config is left untouched. A tsconfig is parsed as JSONC regardless of extension, so comments in the preset still work.

### Ecosystem-preset dedup (app-kit / game-kit consumers)

kit's base layer for `tsconfig.json`, `cspell.config.yaml`, and `lefthook.yml` is added only when the consumer does not already reference an `@joshuafolkken/*` preset for that subsystem. Every ecosystem preset — kit's own base, or an app-kit / game-kit framework preset — embeds, imports, or extends kit base by construction, so a second kit-base reference would be redundant (cspell / tsconfig) or a hard crash (`lefthook.yml` extends `lefthook/base.yml` twice → "possible recursion in extends"). The check reads the consumer's own config content — not its dependency tree — so it works for any current or future `@joshuafolkken` overlay without a hardcoded package name.

## Path transformation

`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, and other AI files contain references to `prompts/` files. `josh sync` rewrites these paths so they point to the correct location in `node_modules`:

```text
`prompts/foo.md`  →  `node_modules/@joshuafolkken/kit/prompts/foo.md`
```

This transformation is applied to backtick-quoted paths matching the pattern `` `prompts/<path>` ``.

## What does NOT get synced

- `package.json` — largely init-only to avoid clobbering project version / dependencies. To refresh kit-managed scripts or dev-dependency pins, re-run `josh init`. The one exception: `sync` realigns `devEngines.packageManager.version` with the whole `packageManager` pin, `+sha512…` Corepack integrity suffix included (pnpm compares the two as raw strings, so any drift — including a stripped suffix — reintroduces the pnpm `Cannot use both "packageManager" and "devEngines.packageManager"` warning); scripts, dependencies, and the project version are never touched.

## When to run

Run `josh sync` whenever you:

- Upgrade `@joshuafolkken/kit` to a new version
- Want to pull in updated GitHub workflow templates
- Want to reset AI files (`CLAUDE.md`, `AGENTS.md`, etc.) to the latest package version after local edits
