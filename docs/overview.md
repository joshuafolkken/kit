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
2. **Init** — run `josh init` once. It creates or merges the config files for the profile, copies AI files and adds the profile's `package.json` scripts and development dependencies, then runs `pnpm install` (which installs the Git hooks in a `full` project with Git) and `josh format`. For the GitHub Issue workflow, run `josh start` instead: it runs the same setup and carries it to GitHub ([init.md → `josh init` or `josh start`](./init.md#josh-init-or-josh-start)).
3. **Sync** — run `josh sync` after upgrading the package to pull in updated AI files, workflow templates, and other managed files. It follows the recorded profile, so a `basic` project gets only its own file set ([#2827](https://github.com/joshuafolkken/kit/issues/2827)).
4. **josh CLI** — a single `josh` binary (available as `pnpm josh` after init) gives you git workflow helpers, version management, security auditing, and more.

To walk the Issue-driven loop once — file an Issue, have an agent plan and implement it, verify, merge — follow [tutorial.md](./tutorial.md). To find the steps for a task — updating kit or dependencies, releasing, running Issues — start at [how-to.md](./how-to.md). The full list of guides is below.

## Documentation

**Set up**

- [setup/prerequisites.md](./setup/prerequisites.md) — Node.js, pnpm and the gh CLI
- [setup/basic.md](./setup/basic.md) — a `basic` project, from an empty machine
- [setup/full.md](./setup/full.md) — a Node project, with `josh init` or `josh start`
- [cli.md](./cli.md) — the global `josh` command
- [troubleshooting.md](./troubleshooting.md) — install and auth errors

**Use**

- [why.md](./why.md) — why kit exists: the pains it solves
- [tutorial.md](./tutorial.md) — your first change with an agent, from Issue to merge
- [how-to.md](./how-to.md) — guides by task

**Commands and configuration**

- [josh-commands.md](./josh-commands.md) — the `josh` commands you type by hand ([catalog](./josh-command-catalog.md) of every command)
- [josh-commands-automation.md](./josh-commands-automation.md) — the commands hooks, workflow runs and lanes call
- [init.md](./init.md) — what `josh init` creates
- [sync.md](./sync.md) — what `josh sync` updates
- [manual-config.md](./manual-config.md) — the presets without `josh init`
- [package-api.md](./package-api.md) — the package's exports

**AI workflow and operations**

- [scripts-ai.md](./scripts-ai.md) — Issue workflow commands and Telegram notifications
- [cloud-session.md](./cloud-session.md) — running in an agent container
- [eval.md](./eval.md) — measuring rule adherence
- [authentication.md](./authentication.md) — existing GitHub Packages installs only

**Maintaining kit**

- [publishing.md](./publishing.md) — releasing a new version
