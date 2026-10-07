# @joshuafolkken/kit

[![Claude Code](https://img.shields.io/badge/Claude_Code-supported-D97757?logo=claude&logoColor=white)](https://claude.com/claude-code)
[![Codex](https://img.shields.io/badge/Codex-supported-412991)](https://openai.com/codex/)
[![npm version](https://img.shields.io/npm/v/@joshuafolkken/kit)](https://www.npmjs.com/package/@joshuafolkken/kit)
[![License](https://img.shields.io/github/license/joshuafolkken/kit)](./LICENSE)

[![Node.js](https://img.shields.io/badge/dynamic/regex?url=https%3A%2F%2Fraw.githubusercontent.com%2Fjoshuafolkken%2Fkit%2Fmain%2Fpackage.json&search=%22node%22%3A%20%22%5C%5E%28%5B0-9%5D%2B%5C.%5B0-9%5D%2B%29%5B0-9.%5D%2A%20%5C%7C%5C%7C%20%5C%5E%28%5B0-9%5D%2B%29%5B0-9.%5D%2A%20%5C%7C%5C%7C%20%3E%3D%28%5B0-9%5D%2B%29&replace=%5E%241%20%7C%20%5E%242%20%7C%20%3E%3D%243&logo=nodedotjs&label=Node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/npm/dependency-version/@joshuafolkken/kit/peer/typescript?logo=typescript)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/dynamic/regex?url=https%3A%2F%2Fraw.githubusercontent.com%2Fjoshuafolkken%2Fkit%2Fmain%2Fpackage.json&search=pnpm%40%28%5B0-9.%5D%2B%29&replace=%241&logo=pnpm&label=pnpm)](https://pnpm.io/)

[![CI](https://github.com/joshuafolkken/kit/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/joshuafolkken/kit/actions/workflows/ci.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=joshuafolkken_kit&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=joshuafolkken_kit)

**AI assistant setup, plus an optional GitHub workflow.**

kit gives Claude Code or Codex your project's rules and checks. With the workflow, the agent takes each change from Issue to merged PR.

## Sound familiar?

Each pain links to how it is solved — or read [the whole story](./docs/why.md).

### Working with an AI agent

- [I keep repeating the same instructions](./docs/why.md#i-keep-repeating-the-same-instructions)
- [The agent does things I never asked for](./docs/why.md#the-agent-does-things-i-never-asked-for)
- [Reviewing every change is a chore](./docs/why.md#reviewing-every-change-is-a-chore)
- [I can't tell if the agent is stuck or done](./docs/why.md#i-cant-tell-if-the-agent-is-stuck-or-done)
- [AI costs keep climbing](./docs/why.md#ai-costs-keep-climbing)

### Working on GitHub

- [Wiring AI up to GitHub is a chore](./docs/why.md#wiring-ai-up-to-github-is-a-chore)
- [Writing Issues is a chore](./docs/why.md#writing-issues-is-a-chore)
- [Big requests come back sloppy](./docs/why.md#big-requests-come-back-sloppy)
- [I spend all day talking to the agent](./docs/why.md#i-spend-all-day-talking-to-the-agent)
- [I want many Issues solved at once](./docs/why.md#i-want-many-issues-solved-at-once)
- [Some changes need a human eye](./docs/why.md#some-changes-need-a-human-eye)
- [One task overwrote another's work](./docs/why.md#one-task-overwrote-anothers-work)
- [A session cut off and I lost track](./docs/why.md#a-session-cut-off-and-i-lost-track)
- [The backlog fills with duplicate Issues](./docs/why.md#the-backlog-fills-with-duplicate-issues)

### Writing TypeScript

- [Done doesn't mean done](./docs/why.md#done-doesnt-mean-done)
- [Quality slips with every change](./docs/why.md#quality-slips-with-every-change)
- [Updating dependencies keeps breaking things](./docs/why.md#updating-dependencies-keeps-breaking-things)

### The app and game kits add

| Your pain                                                                                                                  | [app-kit] | [game-kit] |
| -------------------------------------------------------------------------------------------------------------------------- | :-------: | :--------: |
| [Setting up SvelteKit on Cloudflare takes a day](https://github.com/joshuafolkken/app-kit/blob/main/docs/setup/install.md) |    ✅     |     ✅     |
| [I'm not sure the app is secure](https://github.com/joshuafolkken/app-kit/blob/main/docs/security-headers.md)              |    ✅     |     ✅     |
| [Nobody looked at the screen](https://github.com/joshuafolkken/app-kit/blob/main/docs/shot.md)                             |    ✅     |     ✅     |
| [Starting a 3D game means building it all first](https://github.com/joshuafolkken/game-kit/blob/main/docs/install.md)      |     —     |     ✅     |

app-kit builds on kit and game-kit builds on app-kit, so each includes everything in the kits beneath it.

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

## Quick start

Requires Node.js, pnpm and the gh CLI — [how to install them](./docs/setup/prerequisites.md).

```bash
gh auth login # once, before josh start
pnpm add -D --allow-build=esbuild --allow-build=unrs-resolver @joshuafolkken/kit
pnpm exec josh start
```

`josh start` sets kit up and creates the GitHub repository when it is missing. A repository with history gets a setup pull request instead — merge it before your first run ([what it does](./docs/init.md#josh-init-or-josh-start)).

Then open your agent and follow the [tutorial](./docs/tutorial.md).

**Only want the AI assistant, without the GitHub workflow?** [TypeScript projects](./docs/setup/full.md#2-install-and-initialize-with-josh-init) · [Other projects](./docs/setup/basic.md) — other projects get short AI rules and formatting only ([what each profile gets](./docs/init.md#project-profiles)).

## Docs

[Tutorial](./docs/tutorial.md) · [How-to](./docs/how-to.md) · [Commands](./docs/josh-commands.md) · [Troubleshooting](./docs/troubleshooting.md) · [All docs](./docs/overview.md)

[Releases](https://github.com/joshuafolkken/kit/releases) · [Security](./SECURITY.md) · [Contributing](./docs/maintainers/README.md) · [MIT](./LICENSE)
