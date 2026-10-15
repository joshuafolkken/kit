# @joshuafolkken/kit

**AI assistant setup, plus an optional GitHub workflow.**

kit gives Claude Code or Codex your project's rules and checks.

## The workflow

Type `backlogrun` and the agent takes the Issues you name from plan to merged PR — in parallel, unattended. A live board shows where each one stands:

![The backlogrun board: ten Issues running side by side, seven already merged, each with its stage and elapsed time](./docs/images/backlogrun-board.png)

[Every keyword, including the ones that stop for you earlier](./docs/how-to/run-issues.md)

## Sound familiar?

[The whole story](./docs/why.md)

- [I keep repeating the same instructions](./docs/why.md#i-keep-repeating-the-same-instructions)
- [The agent does things I never asked for](./docs/why.md#the-agent-does-things-i-never-asked-for)
- [Wiring AI up to GitHub is a chore](./docs/why.md#wiring-ai-up-to-github-is-a-chore)
- [Done doesn't mean done](./docs/why.md#done-doesnt-mean-done)

## Quick start

### With the GitHub workflow

Requires [Node.js, pnpm and the gh CLI](./docs/setup/prerequisites.md).

```bash
gh auth login # once
pnpm add -D --allow-build=esbuild --allow-build=unrs-resolver @joshuafolkken/kit
pnpm exec josh start
```

Next: [tutorial](./docs/tutorial.md)

### Your first backlogrun

Tell the agent the change you want, then type `kickoff new auto ok` to it (or add the `auto-ok` label to an existing Issue).

```bash
pnpm josh backlogrun
```

Details: [Run the backlog unattended](./docs/how-to/run-backlog.md)

### AI assistant only — no GitHub account needed

Adds the AI assistant rules, editor settings and a `josh` script, plus Git, GitHub and TypeScript settings where the project has them. It also adds Prettier for HTML, CSS or JavaScript, unless the project already formats with Biome or dprint ([what it adds](./docs/setup/basic.md)).

Requires [Node.js and pnpm](./docs/setup/prerequisites.md).

```bash
pnpm --allow-build=esbuild dlx @joshuafolkken/kit init
```

Next: [tutorial](./docs/tutorial.md#without-github-one-change-checked-locally)

## Claude Code in a fresh-machine run

A [`josh fresh:run`](./docs/maintainers/fresh-machine.md) scenario that runs Claude Code needs a sign-in, saved once:

1. In a terminal at the kit repository, run:

   ```bash
   pnpm josh auth:setup
   ```

2. A browser opens: sign in with your Claude account and press "Authorize".
3. Done when the terminal prints `saved: CLAUDE_CODE_OAUTH_TOKEN (macOS keychain)`. There is no token to copy or write into a file.
4. To check, run `pnpm josh auth:setup --check`: it prints `ok` and the day it was saved.
5. When the token expires, Claude Code in the container fails to sign in — start again from step 1.

## Docs

[How-to](./docs/how-to.md) · [All docs](./docs/overview.md)

[app-kit](https://github.com/joshuafolkken/app-kit) · [game-kit](https://github.com/joshuafolkken/game-kit) · [Releases](https://github.com/joshuafolkken/kit/releases) · [Contributing](./docs/maintainers/README.md)
