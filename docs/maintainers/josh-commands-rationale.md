# josh command reference — rationale and history

How the dispatcher behind [josh-commands.md](../josh-commands.md) runs a command — kit's own
checkout and writing a new script — kept here so the reference states only each command's contract.

## How a command runs

Most commands are a TypeScript file under `scripts/`; the rest are a shell line the dispatcher spawns. In kit's own checkout the dispatcher evaluates a script command in its own process rather than starting a second TypeScript runtime for it. Three conditions decide whether a command takes that route:

- **The dispatcher must run from TypeScript source** — kit's own `pnpm josh`. A consumer's `josh` bin is the bundled `dist/josh.js` under plain node, so a consumer keeps the spawning path for every command except one marked `is_bundled`, which it imports pre-built from `dist/commands/` ([runtime-bundling.md](./runtime-bundling.md)).
- **The command must not need node flags of its own.** `doctor`, `latest:scope`, `followup` and `notify` pass `--env-file`, so they keep a process of their own.
- **A shell command has no script to import** and is spawned as before.

A new josh script keeps the canonical main guard `process.argv[1] === fileURLToPath(import.meta.url)`, or none at all. `scripts/josh/josh-in-process.test.ts` asserts the shape for every command that takes this route.

## `josh gate`'s core budget

Each check claims a place in a machine-wide weighted core budget before it starts (joshuafolkken/kit#2351). The weights are the same measured table the plan already uses — the static checks' reserved cores and the unit suite's worker cap — so a lone gate's four claims sum to exactly the core count and every one is admitted at once: a solo run's concurrency and worker count are unchanged. Under concurrency the machine-wide sum is what bounds admission, so overlapping gates can no longer each reserve the whole machine, and the "whoever started first took everything" asymmetry is gone — a later gate waits rather than shrinking everyone.

A leaked place is swept on read by the same pid-and-start-time liveness the unit-run marker uses, and a reservation that never fits is admitted at minimum width after a wait cap. A gate nested inside another gate's unit suite (this repository's own gate tests) takes no place, so it never waits on cores the outer gate is holding. The pre-push `pnpm install` and `pnpm josh audit` join the same budget through [`josh reserved-run`](../josh-commands-automation.md#josh-reserved-run).
