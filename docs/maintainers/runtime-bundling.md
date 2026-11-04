# Running josh commands without tsx

kit ships `scripts/` as TypeScript and uses pre-built bundles where available. Its `josh` bin is the bundled
`dist/josh.js`, which runs under plain node and cannot load a `.ts` script, so it spawns a tsx child
for every script command — about 0.16 s per call on top of the command's own work
(joshuafolkken/kit#3328).

## kit's own checkout — fresh bundles, source fallback

kit's `pnpm josh` script starts `tools/josh/josh-ready.ts` under plain node. The launcher shares
`hook_bundle_stamp.is_fresh` with `run-hook.sh`'s launcher and checks both `dist/` and
`dist/commands/`. Each build records the bytes it bundled, its toolchain inputs and emitted files.
A fresh build runs `dist/josh.js`; missing inputs or outputs and edited inputs select the source dispatcher,
registering tsx in the same process. Arguments and exit codes follow the selected dispatcher.

The gate's steps and lefthook's commands are `pnpm josh <command>` calls, so they take the
same path. With fresh bundles, commands not yet pre-built still spawn a tsx child. Run `pnpm build`
to refresh the bundles after editing source.

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
