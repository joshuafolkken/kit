# @joshuafolkken/kit — Overview

For anyone deciding whether kit fits their project: what it sets up for each profile, and how it works. `@joshuafolkken/kit` sets up a repository for AI-assisted development: AI assistant rules, formatting and Git settings for any project, plus the full lint, type-check, test and hook toolchain for Node projects. It is framework-agnostic; the SvelteKit-specific layer lives in the separate [`@joshuafolkken/app-kit`](https://github.com/joshuafolkken/app-kit) package.

## What it provides

`josh init` picks a profile from the project ([init.md](./init.md#project-profiles) has the rules): `basic` for a project without Node tooling (an `index.html` site, or Python, Rust and other languages), `full` for a JavaScript / TypeScript project with npm dependencies.

| Area           | Tool                     | `basic`                                                                           | `full`                                             |
| -------------- | ------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------- |
| AI assistants  | Claude / Gemini / Cursor | Short `CLAUDE.md` rules, `AGENTS.md` / `GEMINI.md` pointing at it, `.cursorrules` | The full rules in the same files                   |
| Editor         | VS Code                  | Extension recommendations; save formatting when HTML, CSS or JS files exist       | Extension recommendations and workspace settings   |
| Git            | —                        | `.gitignore` / `.gitattributes` when Git exists                                   | same                                               |
| Formatting     | Prettier                 | Only when HTML, CSS or JS files exist                                             | Shared config with import sorting                  |
| Linting        | ESLint                   | —                                                                                 | Vanilla config via `create_vanilla_config`         |
| Type-checking  | TypeScript               | `tsconfig.json` only when TypeScript files exist                                  | `base.json` tsconfig preset                        |
| Tests          | Vitest / Playwright      | —                                                                                 | Run when installed and test files exist            |
| Git hooks      | Lefthook                 | —                                                                                 | Pre-commit lint + pre-push checks                  |
| Spell-checking | cspell                   | —                                                                                 | Shared word list and ignore rules                  |
| CI/CD          | GitHub Actions           | No workflows; PR template and release-notes config when a GitHub origin exists    | Workflow templates for CI, tagging, and SonarQube  |
| Security       | SonarQube + `pnpm audit` | —                                                                                 | `sonar-project.properties` template + audit script |

In a `basic` project, `josh gate`, `josh lint` and the other checks skip each tool that has nothing to run and print the reason. kit ships no linter or test runner for languages other than JavaScript and TypeScript.

## How it works

1. **Install** — [Set up the basic profile](./setup/basic.md) for `basic`, [Set up the full profile](./setup/full.md) for `full`.
2. **Init** — run `josh init` once. It creates or merges the config files for the profile, copies AI files and adds the profile's `package.json` scripts and development dependencies, then runs `pnpm install` (which installs the Git hooks in a `full` project with Git) and `josh format`.
3. **Sync** — in a `full` project, run `josh sync` after upgrading the package to pull in updated AI files, workflow templates, and other managed files. A `basic` project only upgrades the package ([#2827](https://github.com/joshuafolkken/kit/issues/2827)).
4. **josh CLI** — a single `josh` binary (available as `pnpm josh` after init) gives you git workflow helpers, version management, security auditing, and more.

To walk the Issue-driven loop once — file an Issue, have an agent plan and implement it, verify, merge — follow [tutorial.md](./tutorial.md). To find the steps for a task — updating kit or dependencies, releasing, running Issues — start at [how-to.md](./how-to.md). The full list of guides is in the [README](../README.md#documentation).
