# Install the global `josh` CLI

For anyone who wants `josh` on their PATH, for both project profiles. Install `@joshuafolkken/kit` globally to run `josh` from any directory, independent of any project's `node_modules` — the same model as `@joshuafolkken/game-kit`'s `josh-game`.

## 1. Install globally

The public npm registry serves `@joshuafolkken/kit` without a GitHub token or registry mapping. If your existing `~/.npmrc` maps `@joshuafolkken` to GitHub Packages, that mapping still takes precedence; see [authentication.md](./authentication.md) for the existing setup until you migrate it.

For an existing project that routes `@joshuafolkken` to GitHub Packages, run `pnpm josh registry:migrate` inside that project. It reports the current routing and planned change, checks every locked `@joshuafolkken` package version on public npm, and updates the project `.npmrc` and lockfile. It leaves `~/.npmrc` untouched. If a scoped package version is unpublished on npm or resolution still points to GitHub Packages, it stops and explains why.

pnpm requires a one-time setup before any global install — it registers `PNPM_HOME` and appends it to your `PATH` via your shell rc file:

```bash
pnpm setup
exec $SHELL
```

Then install the kit and confirm the CLI runs:

```bash
pnpm add -g @joshuafolkken/kit
josh help
```

`josh help` prints the command listing; `josh --help` and `josh -h` do the same. `josh` now works from any directory. The global bin is a compiled, self-contained executable (`dist/josh.js`) — it is **not** tied to any project's `node_modules`, so reinstalling or removing a project's dependencies never breaks it.

## 2. If `josh` isn't found

The pnpm global bin directory isn't on your `PATH` yet. Run `pnpm setup`, then open a new terminal; the full steps are in [troubleshooting.md](./troubleshooting.md#josh-command-not-found-after-pnpm-add--g).

## Next

- Set up a project: `josh start` for a project that will use the GitHub Issue workflow — it also carries the setup to GitHub — and `josh init` for one that will not, or for a re-run; see [init.md → `josh init` or `josh start`](./init.md#josh-init-or-josh-start).
- Full command reference: [josh-commands.md](./josh-commands.md).
- Using the kit inside a project too? See [Set up the full profile](./setup/full.md).
- Hitting an error? See [troubleshooting.md](./troubleshooting.md).
