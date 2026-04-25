# Changelog

All notable changes to `@joshuafolkken/kit` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow the `package.json` version field. Each release corresponds to a merged PR on the `main` branch.

---

## [0.96.0] — 2026-04-25

### Changed

- Pinned `@types/node` to `^24.0.0` to match CI Node 24 runtime
- Moved `pnpm josh audit` from pre-commit hook to pre-push hook to speed up commit workflow
- Added comment to `tsconfig/base.jsonc` explaining why `bundler` module resolution is correct for the `tsx` + ESNext setup

### Added

- `vitest.config.ts` with explicit `include` patterns, 10-second test timeout, and `v8` coverage provider
- `JOSH_REQUIRED_CHECKS` environment variable to configure which CI checks are waited on before merge (comma-separated, defaults to `CodeRabbit,SonarQube`)

---

## [0.95.0] — 2026-04-25

### Added

- Unit tests for `version-check-logic.ts`, `security-audit-logic.ts`, `overrides-check.ts`, and `josh.ts`

### Changed

- Renamed orphaned test files to use dot-separated naming: `init-logic-{cspell,merge,transform,yaml}.test.ts` → `init-logic.{cspell,merge,transform,yaml}.test.ts`

---

## [0.94.0] — 2026-04-25

### Changed

- `bump-version.ts`: uses `z.record` for JSON write-back to preserve key insertion order; uses `z.looseObject` only for version extraction
- `git-gh-check.ts`: caches the `gh --version` promise to avoid redundant checks and clears the cache on failure to allow retry
- `git-error.ts`: removed type assertion; uses type-narrowing helper `has_stderr_field` instead
- `init-logic-vite.ts`: replaced bracket-depth parser with comment-anchor injection (`// @kit:visualizer-plugins`) for simpler, more robust Vite config merging

---

## [0.93.0] — 2026-04-25

### Fixed

- `scripts-ai/prep.ts`: `josh latest:update` now correctly excludes capped packages from the update command instead of bypassing overrides
- `git-pr-followup.ts`: removed hardcoded PR label list; uses labels from the actual PR instead
- `completion-gate.ts`: corrected command references to use `josh` instead of bare script paths

---

## [0.92.0] — 2026-04-25

### Security

- Migrated all `exec`-with-string-template calls in `scripts/git/` to `spawn`/`execFile` with argument arrays, eliminating shell injection risk

---

## [0.91.0] — Initial release

### Added

**Linting and formatting**

- ESLint configs for SvelteKit (`create_sveltekit_config`) and vanilla TypeScript (`create_vanilla_config`) projects
- Prettier config with import sorting via `@ianvs/prettier-plugin-sort-imports`

**TypeScript**

- `tsconfig/base.jsonc` — strict TypeScript config suitable for Node.js scripts
- `tsconfig/sveltekit.jsonc` — extended config for SvelteKit projects

**Git hooks (Lefthook)**

- Pre-commit: prevent direct commits to `main`, lint staged files, type-check, spell-check
- Pre-push: run unit tests and security audit
- Commit-msg: validate commit message contains an issue number

**Spell-checking**

- `cspell/` — shared word list and ignore rules

**Editor**

- VS Code extension recommendations and workspace settings

**AI assistant files**

- `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursorrules` — AI instruction files with project conventions and workflow commands

**CI/CD templates**

- GitHub Actions workflows for CI, release tagging, and SonarQube analysis

**`josh` CLI**

| Command          | Description                                       |
| ---------------- | ------------------------------------------------- |
| `josh init`      | Initialize all config files in a new project      |
| `josh sync`      | Sync managed files from the package               |
| `josh lint`      | Check code with Prettier and ESLint               |
| `josh format`    | Format code with Prettier and ESLint              |
| `josh test:unit` | Run unit tests with Vitest                        |
| `josh check`     | Type-check (SvelteKit)                            |
| `josh git`       | AI-assisted commit, push, and PR creation         |
| `josh followup`  | AI-assisted PR follow-up, CI watch, and merge     |
| `josh notify`    | Send a Telegram notification                      |
| `josh bump`      | Bump the package version (major/minor/patch)      |
| `josh version`   | Show current and latest package version           |
| `josh overrides` | Check pnpm override snapshot for drift            |
| `josh audit`     | Run OSV Scanner security audit                    |
| `josh latest`    | Update pnpm, dependencies, and run security audit |
| `josh prep`      | Pre-implementation preparation (AI workflow)      |
| `josh issue`     | Fetch GitHub issue details (AI workflow)          |

See [docs/overview.md](./docs/overview.md) for architecture details and [docs/josh-commands.md](./docs/josh-commands.md) for the full CLI reference.
