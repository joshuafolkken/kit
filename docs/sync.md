# josh sync — Detailed Behavior

`josh sync` overwrites managed files in your project with the latest versions from the installed `@joshuafolkken/config` package. Run it after upgrading the package.

```bash
pnpm josh sync
```

Unlike `josh init` (which skips existing files), `josh sync` **always overwrites** — it is designed for keeping managed files up to date.

## What gets synced

### AI files (always overwritten)

These files are copied verbatim from the package, with one path transformation applied (see below):

```text
CLAUDE.md           AGENTS.md           GEMINI.md
.cursorrules        .coderabbit.yaml    .gitattributes
.mcp.json           .ncurc.json         .prettierignore
SECURITY.md         pnpm-workspace.yaml tsconfig.sonar.json
wrangler.jsonc
.github/workflows/ci.yml
.github/workflows/auto-tag.yml
.github/workflows/production.yml
.github/workflows/sonar-cube.yml
.github/pull_request_template.md
```

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

## Path transformation

`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, and other AI files contain references to `prompts/` files. `josh sync` rewrites these paths so they point to the correct location in `node_modules`:

```text
`prompts/foo.md`  →  `node_modules/@joshuafolkken/config/prompts/foo.md`
```

This transformation is applied to backtick-quoted paths matching the pattern `` `prompts/<path>` ``.

## What does NOT get synced

Config files that were created by `josh init` and may have been customized by the project are **not** touched by `josh sync`:

- `eslint.config.js`
- `prettier.config.js`
- `playwright.config.ts`
- `tsconfig.json`
- `cspell.config.yaml`
- `lefthook.yml`
- `.vscode/extensions.json`
- `.vscode/settings.json`
- `package.json`

To update these, re-run `josh init` (it will merge safely) or edit them manually.

## When to run

Run `josh sync` whenever you:

- Upgrade `@joshuafolkken/config` to a new version
- Want to pull in updated GitHub workflow templates
- Want to reset AI files (`CLAUDE.md`, `AGENTS.md`, etc.) to the latest package version after local edits
