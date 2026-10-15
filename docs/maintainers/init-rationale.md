# josh init — rationale and history

History behind [init.md](../init.md), kept here so the user-facing page describes only current behavior.

## Retired package scripts

`josh init` once added these scripts to a project's `package.json`; they are no longer managed, and their behavior lives in the `josh` CLI ([josh-commands.md](../josh-commands.md)): `git`, `git:followup`, `telegram:test`, `audit:security`, `prep`, `issue:prep`, `prevent-main-commit`, `check-commit-message`, `version:*`, `overrides:check`, `check:ci`, `check:svelte`, `check:svelte:ci`.

## Renamed profiles

`basic` and `full` were called `static` and `node` until joshuafolkken/kit#2829. `josh profile`
also prints a `compat: profile: static (…)` line for a `basic` project, for workflows synced before
the rename.

## Claude settings for a `josh start` basic project

A `basic` project `josh start` set up gets `.claude/settings.json` because `backlogrun` starts each
agent as a headless `claude -p`, which stops at its first command without the distributed
permissions (joshuafolkken/kit#3796).

## The tsconfig exclude list

`playwright.config.ts` points the `html` reporter at `playwright-report/`, which holds Playwright's
own minified trace-viewer bundle. A project with a broad `include` (`"./**/*.ts"`, the natural
SvelteKit shape) would type-check that bundle and get thousands of `tsc --noEmit` errors, but only on
a machine that has run the E2E suite. Playwright refuses an HTML output folder nested inside the
tests output folder (and vice versa), so both directories are listed.

The entries live in the consumer file because a `tsconfig.json` `exclude` overrides the extended
preset's rather than merging with it, so shipping them in `base.json` or app-kit's
`tsconfig/sveltekit.json` would do nothing for a project that declares its own. `josh sync` merges
rather than create-only writes the list because every existing consumer already has a
`tsconfig.json`.

The same override rule is why the `src/service-worker*` globs are there. A SvelteKit project extends
`./.svelte-kit/tsconfig.json`, which excludes those paths itself: the service worker runs in a worker
context with its own `lib` (`WebWorker`) and its own `$service-worker` ambient types. Writing any
`exclude` key replaced that array outright, so before joshuafolkken/kit#796 a project that later
added `src/service-worker.ts` got a type-check failure several layers away from the file it wrote.
They are written unconditionally because kit does not detect SvelteKit, and at `josh init` time the
generated config does not exist yet. SvelteKit's remaining entry, `../node_modules/**`, is covered by
`node_modules`.

## The safe-chain preinstall and the prepare lifecycle

The `node -e` `preinstall` check fetches and scans nothing; safe-chain's own shell integration does
the scanning, and kit does not install it because it rewrites the user's shell configuration. The
earlier `pnpm dlx @aikidosec/safe-chain setup-ci` form downloaded safe-chain without a hash check on
every install and acted only on a CI runner. A published package strips the `preinstall` through
`.pnpmfile.mjs` because pnpm otherwise fails `pnpm add` of that package until the installer approves
the script as a build script (joshuafolkken/kit#3110).

The hooks live in `prepare`, not `postinstall`, because `prepare` runs on a local install and during
`pack` / `publish` but not when the package is installed as a dependency. Each step is guarded so a
missing `lefthook` / `tsx` does not abort a production or CI install that omits dev dependencies.
A failed `lefthook install` warns on standard error because a silent failure left projects with zero
hooks for weeks (joshuafolkken/kit#1503, joshuafolkken/kit#1507); `josh sync` rewrites the old clause
because consumers upgrade by syncing, not by re-running `josh init`.

## core.hooksPath

git provides no way to commit repository configuration, since a clone could then activate arbitrary
hooks on the machine that cloned it, so `core.hooksPath` has to be cleared once per clone. An existing
checkout hides the problem because a `pnpm install` with nothing to do never runs `prepare`. Neither
`--reset-hooks-path` nor `--force` is wired into `prepare`, because rewriting a developer's git
configuration as a side effect of `pnpm install` would break a deliberately set path.

## The pre-push dependency barrier

The pre-push commands run in parallel through pnpm, and pnpm installs when `node_modules` has drifted
from `package.json` — which `josh bump` causes on nearly every push. Without a barrier each command
started its own install at the same moment, rebuilding `node_modules/.bin` while the tests ran from
it, so a push failed for an unrelated reason and passed when re-run (joshuafolkken/kit#813). The
`setup` step is an optimization, not a gate: if it fails, each command falls back to installing on
its own as before.

## Running from outside the project

`pnpm dlx` caches the package it fetched for about a day, so the kit it runs can be older than the
registry's. Before the hand-off, that kit wrote its own version and templates into the project; now
the project's own resolution, under its `minimumReleaseAge`, picks the version. A cached copy released
before the hand-off existed still sets the project up on its own until the cache expires. The bare
`package.json` stops pnpm walking up to an ancestor's manifest and rewriting that project's files.

## The AI files

`CLAUDE.md` is distributed by import rather than byte-copied: the package ships a path-transformed
copy at `dist/CLAUDE.md`, generated at publish time by `scripts/build/build-claude-md.ts`, so a
package update alone keeps the rules current (joshuafolkken/kit#1878). The four skills used to be
copied; they now ship as the `kit` plugin, and `josh sync` removes a stale copy whose content still
matches the shipment (joshuafolkken/kit#1879).

## Where each section came from

The issues behind each section of [init.md](../init.md), kept here so the page carries no provenance
citations.

| Section                       | Issues                            |
| ----------------------------- | --------------------------------- |
| Project profiles              | #2814, #2818, #2829               |
| `josh init` or `josh start`   | #2816                             |
| Run from outside the project  | #2794, #2866                      |
| Package scripts               | #1503, #1507, #2707, #2711, #3095 |
| Dependencies                  | #2710                             |
| tsconfig exclude              | #796                              |
| AI files                      | #963, #1878, #1879, #2990         |
| Tool installs                 | #2766                             |
| Dependency barrier (pre-push) | #813                              |
