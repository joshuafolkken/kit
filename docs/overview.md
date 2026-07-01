# @joshuafolkken/kit — Overview

`@joshuafolkken/kit` is a shared toolchain for TypeScript projects. Install it once and get a consistent, opinionated development environment: linting, formatting, type-checking, git hooks, spell-checking, VS Code settings, and AI assistant files — all wired together. It is framework-agnostic; the SvelteKit-specific layer lives in the separate [`@joshuafolkken/app-kit`](https://github.com/joshuafolkken/app-kit) package.

## What it provides

| Area           | Tool                     | What ships                                            |
| -------------- | ------------------------ | ----------------------------------------------------- |
| Linting        | ESLint                   | Vanilla config via `create_vanilla_config`            |
| Formatting     | Prettier                 | Shared config with import sorting                     |
| Type-checking  | TypeScript               | `base.jsonc` tsconfig preset                          |
| Git hooks      | Lefthook                 | Pre-commit lint + pre-push checks                     |
| Spell-checking | cspell                   | Shared word list and ignore rules                     |
| Editor         | VS Code                  | Extension recommendations and workspace settings      |
| AI assistants  | Claude / Gemini / Cursor | `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursorrules` |
| CI/CD          | GitHub Actions           | Workflow templates for CI, tagging, and SonarQube     |
| Security       | SonarQube + `pnpm audit` | `sonar-project.properties` template + audit script    |

## How it works

1. **Install** — add the package to your project as a dev dependency.
2. **Init** — run `josh init` once. It creates or merges all config files, copies AI files, adds recommended `package.json` scripts, and installs git hooks.
3. **Sync** — run `josh sync` after upgrading the package to pull in updated AI files, workflow templates, and other managed files.
4. **josh CLI** — a single `josh` binary (available as `pnpm josh` after init) gives you git workflow helpers, version management, security auditing, and more.

## Quick links

- [josh commands](./josh-commands.md) — full CLI reference
- [josh init](./init.md) — what `josh init` creates and merges
- [josh sync](./sync.md) — what `josh sync` overwrites and why
- [scripts-ai](./scripts-ai.md) — Telegram env vars and AI workflow commands
- [authentication](./authentication.md) — one-time GitHub Packages auth setup
- [cli](./cli.md) — install and use the global `josh` CLI
- [package](./package.md) — use the kit as a project devDependency
- [troubleshooting](./troubleshooting.md) — common install and usage errors
