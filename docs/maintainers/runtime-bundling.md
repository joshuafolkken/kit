# Running josh commands without tsx

kit ships `scripts/` as TypeScript and runs it with `tsx`. In kit's own checkout that costs one tsx
start per `pnpm josh` call: the dispatcher is loaded as TypeScript and imports each script in its
own process (joshuafolkken/kit#1342). A consumer pays twice. Its `josh` bin is the bundled
`dist/josh.js`, which runs under plain node and cannot load a `.ts` script, so it spawns a tsx child
for every script command — about 0.16 s per call on top of the command's own work
(joshuafolkken/kit#3328).

## kit's own checkout — tsx as a loader, never `dist/`

kit's `pnpm josh` script is `node --import tsx scripts/josh/josh.ts` (joshuafolkken/kit#5632): tsx is
registered as a loader in the one node process, where the `tsx` CLI started a second node process
to run the dispatcher. It reads the sources on every call, so an edit is never run through a stale
build.

The gate's steps and lefthook's commands are `pnpm josh <command>` calls, so they take the
same path. `dist/josh.js` is not used here: every command not yet pre-built would spawn a tsx child
from it, slower than the in-process import (`rule:list`: about 550 ms against 300 ms).

Measured on 2026-11-01 (node 26.12.1, macOS), `pnpm josh doc:section CLAUDE.md Communication`, 15
runs interleaved between the two scripts:

| Script                                | Median | Fastest |
| ------------------------------------- | -----: | ------: |
| Before (`tsx scripts/josh/josh.ts`)   | 263 ms |  236 ms |
| After (`node --import tsx …/josh.ts`) | 204 ms |  187 ms |

## The policy

**Reduce tsx at runtime one command at a time, starting with the most frequently called.** A command
is pre-built to JavaScript and imported by `dist/josh.js` in its own process; every command not yet
pre-built keeps the tsx child, unchanged. There is no flag day: tsx stays a runtime dependency until
no consumer-reachable command needs it.

- **Mark the command** — `is_bundled: true` on its entry in the command map. That one flag is the
  single source: `pnpm build` bundles every marked command (`scripts/build/build-commands.ts`) to
  `dist/commands/<script basename>.js`, and the dispatcher routes every marked command to that file
  (`josh_in_process.in_process_target`).
- **Pick by call frequency** — commands a run calls many times (document reads, run-step queries)
  before ones a run calls once. Claude Code hooks are already pre-built separately (`dist/hooks/`,
  joshuafolkken/kit#2023) and are not part of this list.
- **A command that cannot be marked** — one with `tsx_arguments` (`--env-file` has to be in force
  before the script's first line, which an in-process import cannot give), or one whose import
  closure carries a second `process.argv[1] === fileURLToPath(import.meta.url)` main guard: each
  bundle is a single file, so every module in it shares the entry's `import.meta.url` and that guard
  would fire too. Move the guarded main into an entry nothing imports (`*-cli.ts` / `*-main.ts`)
  first, as the hooks did (joshuafolkken/kit#2922). `build-commands.test.ts` refuses both, and
  `main-guard-boundary.test.ts` keeps every imported module guard-free (joshuafolkken/kit#4186).

## The first step — `doc:section`

`doc:section` was the first command marked: every workflow entry reads its documents section by
section, so it is among the most frequent calls a run makes, and it is local and deterministic.

Measured on 2026-10-06 (node 26.10.0, macOS), `node dist/josh.js doc:section CLAUDE.md Project`, 50
runs interleaved between the two builds:

| Build                          | Median | Fastest |
| ------------------------------ | -----: | ------: |
| Before (tsx child)             | 344 ms |  262 ms |
| After (`dist/commands` import) | 154 ms |  126 ms |

## The second step — the run's repeated reads

`doc:read`, `read:set`, `run:prep` and `run:step` were marked next (joshuafolkken/kit#4186): a run
calls each of them at every entry and between its steps.
