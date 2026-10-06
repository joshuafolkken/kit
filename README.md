# @joshuafolkken/kit

[![Claude Code](https://img.shields.io/badge/Claude_Code-supported-D97757?logo=claude&logoColor=white)](https://claude.com/claude-code)
[![Codex](https://img.shields.io/badge/Codex-supported-412991)](https://openai.com/codex/)
[![npm version](https://img.shields.io/npm/v/@joshuafolkken/kit)](https://www.npmjs.com/package/@joshuafolkken/kit)
[![License](https://img.shields.io/github/license/joshuafolkken/kit)](./LICENSE)

[![Node.js](https://img.shields.io/node/v/@joshuafolkken/kit?logo=nodedotjs)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/npm/dependency-version/@joshuafolkken/kit/peer/typescript?logo=typescript)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/github/package-json/packageManager/joshuafolkken/kit?logo=pnpm&label=pnpm)](https://pnpm.io/)

[![CI](https://github.com/joshuafolkken/kit/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/joshuafolkken/kit/actions/workflows/ci.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=joshuafolkken_kit&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=joshuafolkken_kit)

**AI assistant setup, plus an optional GitHub workflow.**

kit gives Claude Code or Codex your project's rules and checks. With the workflow, the agent takes each change from Issue to merged PR.

**Only want the AI assistant, without the GitHub workflow?** Set it up here: [Node projects](./docs/setup/full.md#2-install-and-initialize-with-josh-init) · [Other projects](./docs/setup/basic.md)

## Sound familiar?

Each pain links to how it is solved — or read [the whole story](./docs/why.md).

kit solves these in every project — and so do [app-kit] and [game-kit], which build on it:

- [Done doesn't mean done](./docs/why.md#done-doesnt-mean-done)
- [Quality slips with every change](./docs/why.md#quality-slips-with-every-change)
- [I keep repeating the same instructions](./docs/why.md#i-keep-repeating-the-same-instructions)
- [The agent does things I never asked for](./docs/why.md#the-agent-does-things-i-never-asked-for)
- [Reviewing every change is a chore](./docs/why.md#reviewing-every-change-is-a-chore)
- [Some changes need a human eye](./docs/why.md#some-changes-need-a-human-eye)
- [I spend all day talking to the agent](./docs/why.md#i-spend-all-day-talking-to-the-agent)
- [Big requests come back sloppy](./docs/why.md#big-requests-come-back-sloppy)
- [I want many Issues solved at once](./docs/why.md#i-want-many-issues-solved-at-once)
- [AI costs keep climbing](./docs/why.md#ai-costs-keep-climbing)
- [Writing Issues is a chore](./docs/why.md#writing-issues-is-a-chore)
- [Wiring AI up to GitHub is a chore](./docs/why.md#wiring-ai-up-to-github-is-a-chore)
- [I can't tell if the agent is stuck or done](./docs/why.md#i-cant-tell-if-the-agent-is-stuck-or-done)
- [One task overwrote another's work](./docs/why.md#one-task-overwrote-anothers-work)
- [A session cut off and I lost track](./docs/why.md#a-session-cut-off-and-i-lost-track)
- [The backlog fills with duplicate Issues](./docs/why.md#the-backlog-fills-with-duplicate-issues)

The app and game kits add:

| Your pain                                                                                                                  | kit | [app-kit] | [game-kit] |
| -------------------------------------------------------------------------------------------------------------------------- | :-: | :-------: | :--------: |
| [Setting up SvelteKit on Cloudflare takes a day](https://github.com/joshuafolkken/app-kit/blob/main/docs/setup/install.md) |  —  |    ✅     |     ✅     |
| [I'm not sure the app is secure](https://github.com/joshuafolkken/app-kit/blob/main/docs/security-headers.md)              |  —  |    ✅     |     ✅     |
| [Nobody looked at the screen](https://github.com/joshuafolkken/app-kit/blob/main/docs/shot.md)                             |  —  |    ✅     |     ✅     |
| [Starting a 3D game means building it all first](https://github.com/joshuafolkken/game-kit/blob/main/docs/install.md)      |  —  |     —     |     ✅     |

Each kit includes the one to its left: app-kit builds on kit, game-kit builds on app-kit.

[app-kit]: https://github.com/joshuafolkken/app-kit
[game-kit]: https://github.com/joshuafolkken/game-kit

## The workflow

| You type     | The agent                                        |
| ------------ | ------------------------------------------------ |
| `kickoff`    | Writes the plan on the Issue, then stops         |
| `halfrun`    | Implements and self-reviews, stops before commit |
| `prrun`      | Opens a green pull request, stops before merge   |
| `fullrun`    | Plans if needed, implements through to merge     |
| `backlogrun` | Runs many Issues unattended                      |

Each keyword in full: [Run Issues with the workflow keywords](./docs/how-to/run-issues.md). When a run needs you, it [notifies you on Telegram](./docs/how-to/set-up-notifications.md).

## Why you can trust "done"

- **Checks are commands.** Lint, types, spelling and tests run as one gate — "it should pass" doesn't count.
- **No test, no commit.** kit decides from the changed files whether a test is required.

## Quick start

Requires Node.js, pnpm (kit is installed and run with pnpm only) and the gh CLI — [how to install them](./docs/setup/prerequisites.md). Sign in once with `gh auth login` before `josh start`.

```bash
pnpm add -D --allow-build=esbuild --allow-build=unrs-resolver @joshuafolkken/kit
pnpm exec josh start
```

`josh start` picks the project's profile, writes kit's rules and checks, and creates the GitHub repository and workflow labels when they are missing. On a repository that already has history it opens a setup pull request instead of committing to `main` — merge it before your first run ([what it does](./docs/init.md#josh-init-or-josh-start)).

Add the two Telegram credentials to `.env` so a run that needs you can reach you, or `JOSH_NOTIFY=off` to go without — [Set up notifications](./docs/how-to/set-up-notifications.md).

Then open your agent and follow the [tutorial](./docs/tutorial.md).

AI assistant only, no GitHub workflow? [Node projects](./docs/setup/full.md#2-install-and-initialize-with-josh-init) · [Other projects](./docs/setup/basic.md)

## Docs

[Tutorial](./docs/tutorial.md) · [How-to](./docs/how-to.md) · [Commands](./docs/josh-commands.md) · [Troubleshooting](./docs/troubleshooting.md) · [All docs](./docs/overview.md)

[Releases](https://github.com/joshuafolkken/kit/releases) · [Security](./SECURITY.md) · [Contributing](./docs/maintainers/README.md) · [MIT](./LICENSE)
