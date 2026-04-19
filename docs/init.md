# josh init — Detailed Behavior

`josh init` sets up a new project with all the toolchain config files managed by `@joshuafolkken/kit`. Run it once after installing the package.

```bash
pnpm josh init
```

## Project type detection

`josh init` needs to know whether your project is SvelteKit or vanilla TypeScript.

1. **Auto-detect** — if `svelte.config.js` or `svelte.config.ts` exists in the current directory, `sveltekit` is used automatically.
2. **CLI flag** — pass `--type sveltekit` or `--type vanilla` to skip detection.
3. **Interactive prompt** — if detection fails and no flag is given, you are prompted to choose.

The project type controls which ESLint config, tsconfig preset, and Lefthook config are generated.

## Config files

Each file is either created (if missing) or merged (if it already exists). Files without a merge strategy show a sample you can copy manually.

| File                      | If missing                                                        | If exists                                        |
| ------------------------- | ----------------------------------------------------------------- | ------------------------------------------------ |
| `.npmrc`                  | Created with registry, engine-strict, minimum-release-age         | Missing lines appended                           |
| `eslint.config.js`        | Created with `create_sveltekit_config` or `create_vanilla_config` | Sample shown — add manually                      |
| `prettier.config.js`      | Created with shared config                                        | Sample shown — add manually                      |
| `playwright.config.ts`    | Created with `create_playwright_config`                           | Sample shown — add manually                      |
| `tsconfig.json`           | Created with `extends` pointing to the preset                     | Preset entry prepended to `extends` array        |
| `cspell.config.yaml`      | Created with `import` pointing to the shared word list            | Import entry added under `import:` key           |
| `lefthook.yml`            | Created with `extends` pointing to the preset                     | Preset entry added under `extends:` key          |
| `.vscode/extensions.json` | Created from package template                                     | Missing recommendations merged in                |
| `.vscode/settings.json`   | Created from package template                                     | Missing keys merged in (existing keys untouched) |

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

`josh init` reads your `package.json` and adds any missing scripts from the recommended set. Existing scripts are never overwritten.

Scripts added for all project types:

| Script               | Command                                           |
| -------------------- | ------------------------------------------------- |
| `postinstall`        | `lefthook install`                                |
| `josh`               | `josh`                                            |
| `lint`               | `pnpm lint:prettier && pnpm lint:eslint`          |
| `lint:prettier`      | `prettier --check .`                              |
| `lint:eslint`        | `eslint . --cache --cache-strategy content`       |
| `format`             | `pnpm format:prettier && pnpm format:eslint`      |
| `format:prettier`    | `prettier --write .`                              |
| `format:eslint`      | `eslint . --fix --cache --cache-strategy content` |
| `cspell`             | `cspell lint ...`                                 |
| `cspell:dot`         | `pnpm cspell . --dot`                             |
| `test:unit`          | `vitest run`                                      |
| `lefthook:install`   | `lefthook install`                                |
| `lefthook:uninstall` | `lefthook uninstall`                              |
| `lefthook:commit`    | `lefthook run pre-commit`                         |
| `lefthook:push`      | `lefthook run pre-push`                           |
| `main:sync`          | `git checkout main && git pull`                   |
| `main:merge`         | `git pull origin main`                            |

Additional scripts added for SvelteKit projects:

| Script     | Command                                                                        |
| ---------- | ------------------------------------------------------------------------------ |
| `check`    | `svelte-kit sync && svelte-check --tsconfig ./tsconfig.json`                   |
| `check:ci` | `svelte-kit sync && svelte-check --tsconfig ./tsconfig.json --threshold error` |

Retired scripts (previously managed, now removed): `git`, `git:followup`, `telegram:test`, `audit:security`, `prep`, `issue:prep`, `prevent-main-commit`, `check-commit-message`, `version:*`, `overrides:check`.

## AI files

The following files are **copied from the package** on first run. If a file already exists, it is skipped with a message suggesting `josh sync` to update it.

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
.gitignore          (from templates/gitignore)
sonar-project.properties  (generated from GitHub repo name)
```

`CLAUDE.md`, `AGENTS.md`, and `GEMINI.md` have their `prompts/` paths rewritten to point to `node_modules/@joshuafolkken/kit/prompts/` so they work correctly in the consuming project.

`sonar-project.properties` is generated from the GitHub repo name fetched via `gh repo view`. If `gh` is not available or the repo cannot be identified, the file is skipped with a warning.

## Tool installs

After all files are processed, `josh init` runs:

1. **`lefthook install`** — installs git hooks defined in `lefthook.yml` (pre-commit, commit-msg, pre-push).
2. **`josh install`** — installs the `josh` binary to `~/.local/bin` for system-wide access.
