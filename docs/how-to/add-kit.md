# Add kit to an existing project

## When to use it

You have a repository and want kit's AI rules, formatting and checks in it. This page only routes you; the install guides hold the steps.

## Steps

1. Pick the guide for your [project profile](../init.md#project-profiles):
   - `static` — an `index.html` site, or Python, Rust or another non-Node project: follow [getting-started.md](../getting-started.md). It installs Node and pnpm too.
   - `node` — a JavaScript / TypeScript project with npm dependencies: follow [package.md](../package.md).
2. Optionally install the [global `josh` CLI](../cli.md) so `josh` works outside the project. The package alone is enough to use the configs.
3. Run `josh init` as the guide says ([what it creates](../init.md)), then `josh format` and `josh gate` to verify.

## Check it worked

- `josh gate` passes. In a `static` project it skips each check that has nothing to run and prints why ([`josh gate`](../josh-commands.md#josh-gate)).

## Common failures

- `josh` is not found after a global install: see [cli.md](../cli.md#2-if-josh-isnt-found) and [troubleshooting.md](../troubleshooting.md#josh-command-not-found-after-pnpm-add--g).
- The install gets the previous kit version right after a release: pnpm holds back releases younger than a day ([getting-started.md](../getting-started.md#3-install-kit)).
- Any other install or authentication error: [troubleshooting.md](../troubleshooting.md).
