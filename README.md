# @joshuafolkken/kit

[![npm version](https://img.shields.io/npm/v/@joshuafolkken/kit)](https://www.npmjs.com/package/@joshuafolkken/kit)
[![CI](https://github.com/joshuafolkken/kit/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/joshuafolkken/kit/actions/workflows/ci.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=joshuafolkken_kit&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=joshuafolkken_kit)

**AI assistant setup, plus an optional GitHub workflow.**

kit gives Claude Code or Codex your project's rules and checks. With the workflow, the agent takes each change from Issue to merged PR.

## Sound familiar?

[The whole story](./docs/why.md)

### Working with an AI agent

- [I keep repeating the same instructions](./docs/why.md#i-keep-repeating-the-same-instructions)
- [The agent does things I never asked for](./docs/why.md#the-agent-does-things-i-never-asked-for)
- [Reviewing every change is a chore](./docs/why.md#reviewing-every-change-is-a-chore)
- [I can't tell if the agent is stuck or done](./docs/why.md#i-cant-tell-if-the-agent-is-stuck-or-done)
- [AI costs keep climbing](./docs/why.md#ai-costs-keep-climbing)

### With the GitHub workflow

- [Wiring AI up to GitHub is a chore](./docs/why.md#wiring-ai-up-to-github-is-a-chore)
- [Writing Issues is a chore](./docs/why.md#writing-issues-is-a-chore)
- [Big requests come back sloppy](./docs/why.md#big-requests-come-back-sloppy)
- [I spend all day talking to the agent](./docs/why.md#i-spend-all-day-talking-to-the-agent)
- [Some changes need a human eye](./docs/why.md#some-changes-need-a-human-eye)

### Writing TypeScript

- [Done doesn't mean done](./docs/why.md#done-doesnt-mean-done)
- [Quality slips with every change](./docs/why.md#quality-slips-with-every-change)
- [Updating dependencies keeps breaking things](./docs/why.md#updating-dependencies-keeps-breaking-things)

## Quick start

### With the GitHub workflow

Requires [Node.js, pnpm and the gh CLI](./docs/setup/prerequisites.md).

```bash
gh auth login # once
pnpm add -D --allow-build=esbuild --allow-build=unrs-resolver @joshuafolkken/kit
pnpm exec josh start
```

Next: [tutorial](./docs/tutorial.md)

### AI assistant only — no GitHub account needed

Requires [Node.js and pnpm](./docs/setup/prerequisites.md).

```bash
pnpm --allow-build=esbuild dlx @joshuafolkken/kit init
```

Next: [tutorial](./docs/tutorial.md#without-github-one-change-checked-locally)

## The workflow

| You type     | The agent                                        |
| ------------ | ------------------------------------------------ |
| `kickoff`    | Writes the plan on the Issue, then stops         |
| `halfrun`    | Implements and self-reviews, stops before commit |
| `prrun`      | Opens a green pull request, stops before merge   |
| `fullrun`    | Plans if needed, implements through to merge     |
| `backlogrun` | Runs many Issues unattended                      |

[Each keyword in full](./docs/how-to/run-issues.md) · [Telegram notifications when a run needs you](./docs/how-to/set-up-notifications.md)

## Docs

[How-to](./docs/how-to.md) · [Commands](./docs/josh-commands.md) · [Troubleshooting](./docs/troubleshooting.md) · [All docs](./docs/overview.md)

[app-kit](https://github.com/joshuafolkken/app-kit) · [game-kit](https://github.com/joshuafolkken/game-kit) · [Releases](https://github.com/joshuafolkken/kit/releases) · [Security](./SECURITY.md) · [Contributing](./docs/maintainers/README.md) · [MIT](./LICENSE)

[![Node.js](https://img.shields.io/badge/dynamic/regex?url=https%3A%2F%2Fraw.githubusercontent.com%2Fjoshuafolkken%2Fkit%2Fmain%2Fpackage.json&search=%22node%22%3A%20%22%5C%5E%28%5B0-9%5D%2B%5C.%5B0-9%5D%2B%29%5B0-9.%5D%2A%20%5C%7C%5C%7C%20%5C%5E%28%5B0-9%5D%2B%29%5B0-9.%5D%2A%20%5C%7C%5C%7C%20%3E%3D%28%5B0-9%5D%2B%29&replace=%5E%241%20%7C%20%5E%242%20%7C%20%3E%3D%243&logo=nodedotjs&label=Node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/npm/dependency-version/@joshuafolkken/kit/peer/typescript?logo=typescript)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/dynamic/regex?url=https%3A%2F%2Fraw.githubusercontent.com%2Fjoshuafolkken%2Fkit%2Fmain%2Fpackage.json&search=pnpm%40%28%5B0-9.%5D%2B%29&replace=%241&logo=pnpm&label=pnpm)](https://pnpm.io/)
