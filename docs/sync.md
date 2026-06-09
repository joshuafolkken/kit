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
SECURITY.md         tsconfig.sonar.json wrangler.jsonc
.github/workflows/ci.yml
.github/workflows/auto-tag.yml
.github/workflows/production.yml
.github/workflows/publish.yml
.github/workflows/sonar-qube.yml
.github/pull_request_template.md
.github/release.yml
.github/dependabot.yml
```

> **GitHub Actions workflows are single-sourced by the kit.** Every consumer-facing workflow
> (`ci.yml`, `auto-tag.yml`, `production.yml`, `publish.yml`, `sonar-qube.yml`) is overwritten on
> each `josh sync`, so action SHA pins are bumped once in the kit and propagated to all consumers —
> no per-consumer maintenance. The kit's own `github-actions` Dependabot is what bumps those pins at
> the source; `josh sync` then distributes them. The `github-actions` entry in the distributed
> `dependabot.yml` is intentionally kept as a backstop (it covers any non-kit workflow a consumer
> adds, and finds nothing to bump for synced workflows since their pins are already current).

### `pnpm-workspace.yaml` (merged)

`pnpm-workspace.yaml` is **merged**, not overwritten. Kit-managed keys (`onlyBuiltDependencies`, `minimumReleaseAgeExclude`) are updated from the package template; all other top-level keys (e.g. `packages:`) you have added are preserved and appended after the kit-managed content.

### File mappings (overwritten if source exists)

| Package source        | Destination  |
| --------------------- | ------------ |
| `templates/gitignore` | `.gitignore` |

If the source file does not exist in the installed package, the destination is skipped with a warning.

### `sonar-project.properties` (regenerated)

The Sonar config is regenerated from the current GitHub repo name (fetched via `gh repo view`). If `gh` is unavailable or the repo cannot be identified, this file is skipped with a warning.

The project key and organization are derived from the `owner/repo` slug:

- `project_key` → `owner_repo` (slash replaced with underscore, lowercased)
- `organization` → `owner` (lowercased)

### Config files (merged, only when already present)

These files are created by `josh init`. `josh sync` refreshes them in place by reusing the same merge functions `init` uses — never created on first run, so projects that opted out stay opted out. Each handler is idempotent: when the file is already current, it logs `unchanged` and skips the write.

| File                      | Merge strategy                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `.npmrc`                  | Append any missing lines from the kit's required-lines list                                                                          |
| `eslint.config.js`        | Overwrite with the current kit template (no merge — same model as Playwright)                                                        |
| `tsconfig.json`           | Prepend the kit preset to the `extends` array if not already present                                                                 |
| `cspell.config.yaml`      | Prepend the kit import to the `import:` list, unless already present or superseded by a transitive import (e.g. the game-kit import) |
| `lefthook.yml`            | Prepend the kit preset to the `extends:` list if not already present                                                                 |
| `.vscode/extensions.json` | Append missing kit recommendations to `recommendations`                                                                              |
| `.vscode/settings.json`   | Add missing top-level keys (existing keys are never overwritten)                                                                     |
| `vite.config.ts`          | Inject the `rollup-plugin-visualizer` import + plugin (SvelteKit projects only)                                                      |

Project type (`sveltekit` vs `vanilla`) is auto-detected from the presence of `svelte.config.{js,ts}`; `vite.config.ts` is only synced for SvelteKit projects.

Kit-only `.vscode/settings.json` keys (currently `sonarlint.connectedMode.project`, which points at the kit's own SonarQube project) are stripped from the template before distribution, so they are never written into consumer projects.

## Path transformation

`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, and other AI files contain references to `prompts/` files. `josh sync` rewrites these paths so they point to the correct location in `node_modules`:

```text
`prompts/foo.md`  →  `node_modules/@joshuafolkken/kit/prompts/foo.md`
```

This transformation is applied to backtick-quoted paths matching the pattern `` `prompts/<path>` ``.

## What does NOT get synced

- `package.json` — largely init-only to avoid clobbering project version / dependencies. To refresh kit-managed scripts or dev-dependency pins, re-run `josh init`. The one exception: `sync` realigns `devEngines.packageManager.version` with the `packageManager` pin (a drift between the two reintroduces the pnpm `Cannot use both "packageManager" and "devEngines.packageManager"` warning); scripts, dependencies, and the project version are never touched.

## When to run

Run `josh sync` whenever you:

- Upgrade `@joshuafolkken/kit` to a new version
- Want to pull in updated GitHub workflow templates
- Want to reset AI files (`CLAUDE.md`, `AGENTS.md`, etc.) to the latest package version after local edits
