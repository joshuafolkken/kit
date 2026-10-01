# Add kit to an existing project

## When to use it

You have a repository and want kit's AI rules, formatting and checks in it. This page only routes you; the setup guides hold the steps.

## Steps

1. Pick the guide for your [project profile](../init.md#project-profiles):
   - `basic` — an `index.html` site, or Python, Rust or another non-Node project: follow [Set up the basic profile](../setup/basic.md). It installs Node and pnpm too.
   - `full` — a JavaScript / TypeScript project with npm dependencies: follow [Set up the full profile](../setup/full.md).
2. Optionally install the [global `josh` CLI](../cli.md) so `josh` works outside the project. The package alone is enough to use the configs.
3. Run `josh init` as the guide says ([what it creates](../init.md)) — it installs the dependencies and formats the project itself — then `josh gate` to verify.
4. If the project will use the GitHub Issue workflow, run `josh start` next and merge the setup pull request it opens, so `main` carries the setup ([init.md → `josh init` or `josh start`](../init.md#josh-init-or-josh-start)).

## Check it worked

- `josh gate` passes. In a `basic` project it skips each check that has nothing to run and prints why ([`josh gate`](../josh-commands.md#josh-gate)).

## Common failures

- `josh` is not found after a global install: see [cli.md](../cli.md#2-if-josh-isnt-found) and [troubleshooting.md](../troubleshooting.md#josh-command-not-found-after-pnpm-add--g).
- The install gets the previous kit version right after a release: pnpm holds back releases younger than a day ([Set up the basic profile](../setup/basic.md#3-install-kit-and-initialize)).
- Any other install or authentication error: [troubleshooting.md](../troubleshooting.md).
