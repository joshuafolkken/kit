# @joshuafolkken/kit

**Write a GitHub Issue. Your AI agent takes it to a merged PR — the same way in every project.**

kit gives Claude Code (or Codex, Gemini, Cursor) your project's rules, checks and an Issue-driven workflow. [Why kit exists](./docs/why.md) (Japanese)

## The workflow

| You type     | The agent                    |
| ------------ | ---------------------------- |
| `kickoff`    | Plans, then stops            |
| `halfrun`    | Implements, stops for review |
| `fullrun`    | Implements through to merge  |
| `backlogrun` | Runs many Issues unattended  |

When a run needs you, it [notifies you on Telegram](./docs/how-to/set-up-notifications.md).

## Why you can trust "done"

- **Checks are commands.** Lint, types, spelling and tests run as one gate — "it should pass" doesn't count.
- **No test, no commit.** kit decides from the changed files whether a test is required.

## Quick start

Requires Node.js, pnpm and the gh CLI — [how to install them](./docs/setup/prerequisites.md).

```bash
pnpm add -D --allow-build=esbuild --allow-build=unrs-resolver @joshuafolkken/kit
pnpm exec josh start
```

Then open your agent and follow the [tutorial](./docs/tutorial.md).

No Issue workflow? [Node projects](./docs/setup/full.md#2-install-and-initialize-with-josh-init) · [Other projects](./docs/setup/basic.md)

## Docs

[Tutorial](./docs/tutorial.md) · [How-to](./docs/how-to.md) · [Commands](./docs/josh-commands.md) · [Troubleshooting](./docs/troubleshooting.md) · [All docs](./docs/overview.md)

[Contributing](./CLAUDE.md) · [Publishing](./docs/publishing.md) · [MIT](./LICENSE)
