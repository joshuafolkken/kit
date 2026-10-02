# @joshuafolkken/kit

**Write a GitHub Issue. Your AI agent takes it to a merged PR — the same way in every project.**

kit gives Claude Code (or Codex, Gemini, Cursor) your project's rules, checks and an Issue-driven workflow. You type one keyword. The agent plans, implements, verifies, opens the PR and merges it.

## The workflow

| You type         | The agent                                                              |
| ---------------- | ---------------------------------------------------------------------- |
| `kickoff new`    | Files the Issue from your conversation, posts the plan and stops       |
| `halfrun #N`     | Implements and verifies, then stops before commit so you can look      |
| `fullrun #N`     | Implements, verifies, self-reviews, opens the PR, waits for CI, merges |
| `backlogrun #N…` | Works through several Issues (or an epic) unattended                   |

## Why you can trust "done"

- **Checks are commands, not requests.** Lint, type check, spell check and tests run as one gate. "It should pass" doesn't count.
- **Missing tests stop the commit.** kit decides from the changed files whether a test is required, and stops the commit until the agent adds one or declares the change exempt.
- **It tells you when it stops.** A run that needs you sends a [Telegram notification](./docs/how-to/set-up-notifications.md).

More: [why kit exists](./docs/why.md) (Japanese)

## Quick start

Requires Node.js 22.19+, pnpm 12+ and the gh CLI — [how to install them](./docs/setup/prerequisites.md).

```bash
pnpm add -D --allow-build=esbuild --allow-build=unrs-resolver @joshuafolkken/kit
pnpm exec josh start
```

Then open your agent and follow the [tutorial](./docs/tutorial.md).

No Issue workflow? Run `pnpm --allow-build=esbuild dlx @joshuafolkken/kit init` instead — see setup for [Node projects](./docs/setup/full.md#2-install-and-initialize-with-josh-init) or [other projects](./docs/setup/basic.md).

## Docs

[Tutorial](./docs/tutorial.md) · [How-to](./docs/how-to.md) · [Commands](./docs/josh-commands.md) · [Troubleshooting](./docs/troubleshooting.md) · [Overview & all docs](./docs/overview.md)

## Contributing · License

[CLAUDE.md](./CLAUDE.md) · [publishing.md](./docs/publishing.md) · [MIT](./LICENSE)
