# Running josh commands without tsx

kit ships `scripts/` as TypeScript and pre-builds every script command. Its `josh` bin is the bundled
`dist/josh.js`, which runs under plain node and cannot load a `.ts` script. It once spawned a tsx
child for every command not pre-built — about 0.16 s per call on top of the command's own work
(joshuafolkken/kit#3328); since joshuafolkken/kit#7013 it imports every command pre-built.

## kit's own checkout — fresh bundles, rebuilt when stale

kit's `pnpm josh` script starts `tools/josh/josh-ready.ts` under plain node. The launcher shares
`hook_bundle_stamp.is_fresh` with `run-hook.sh`'s launcher and checks both `dist/` and
`dist/commands/`. Each build records the bytes it bundled, its toolchain inputs and emitted files.
A fresh build runs `dist/josh.js` with no TS loader. Missing inputs or outputs and edited inputs
rebuild `dist/` first — `pnpm build`, its progress on stderr — and then run the new `dist/josh.js`, so
a command never runs a bundle older than the source (joshuafolkken/kit#6769). A lock beside
`dist/commands/` keeps concurrent launches to one build; the others wait for it. Only a failed
build, or a source edited during the build, selects the source dispatcher, registering tsx in the
same process. Arguments and exit codes follow the selected dispatcher.

The gate's steps and lefthook's commands are `pnpm josh <command>` calls, so they take the
same path. With fresh bundles, no command starts tsx to run itself.

Measured on 2026-11-01 (node 26.12.1, macOS), `pnpm josh doc:section CLAUDE.md Communication`, 15
runs interleaved between the two scripts:

| Script                                | Median | Fastest |
| ------------------------------------- | -----: | ------: |
| Before (`tsx scripts/josh/josh.ts`)   | 263 ms |  236 ms |
| After (`node --import tsx …/josh.ts`) | 204 ms |  187 ms |

## The policy

**Every script command is pre-built, and `dist/josh.js` imports it in its own process**
(joshuafolkken/kit#7013). The dispatcher starts tsx only in `josh-ready`'s fallback, when the
build fails. tsx stays a runtime dependency: a detached `.ts` child (the ship relaunch, the lane
supervisors) gets it through `ts_entry_loader.loader_argv`, and `metrics` loads the command map
with `tsImport`.

- **One build, shared chunks** — `pnpm build` bundles the script of every command-map entry
  (`scripts/build/build-commands.ts`) to `dist/commands/<script basename>.js` with code splitting,
  so code the commands share lands once in `chunk-*.js`. The dispatcher derives the same path
  (`josh_in_process.in_process_target`); no per-command flag selects it.
- **Each module keeps its source location** — the build defines `import.meta.url`, `filename` and
  `dirname` as module-local values naming the module's source file, worked out from the output
  file at run time (`scripts/build/source-location.ts`). A path climbed from a module's own location
  resolves as from the source, and the dispatcher sets `argv[1]` to the source script, so the main
  guard `process.argv[1] === fileURLToPath(import.meta.url)` fires for the launched script only — a
  guarded module in another command's closure, or a command another command imports, runs as from
  source. A bundle therefore runs only when launched the dispatcher's way, never as `node <bundle>`.
- **`tsx_arguments`** (only the optional `.env` flag) are applied in process before the import
  (`josh_environment_file.apply_node_flags`), with the same filter that keeps launch-only switches out
  of the file's reach.
- Claude Code hooks are pre-built separately (`dist/hooks/`, joshuafolkken/kit#2023);
  `main-guard-boundary.test.ts` keeps every imported module guard-free for those single-entry bundles
  (joshuafolkken/kit#4186).

Measured on 2026-11-10 (macOS) for joshuafolkken/kit#7013:

| Measure                                         | Before          | After                            |
| ----------------------------------------------- | --------------- | -------------------------------- |
| `node dist/josh.js lane:list` (wall / peak RSS) | 2.36 s / 353 MB | 1.99–2.56 s / 267–284 MB, no tsx |
| `tsx scripts/build/build.ts` (wall / peak RSS)  | —               | 7.20 s / 527 MB                  |
| `dist/commands`                                 | 6 commands      | 209 entries + 557 chunks, 7.3 MB |

## The first step — `doc:section`

`doc:section` was the first command pre-built: every workflow entry reads its documents section by
section, so it is among the most frequent calls a run makes, and it is local and deterministic.

Measured on 2026-10-06 (node 26.10.0, macOS), `node dist/josh.js doc:section CLAUDE.md Project`, 50
runs interleaved between the two builds:

| Build                          | Median | Fastest |
| ------------------------------ | -----: | ------: |
| Before (tsx child)             | 344 ms |  262 ms |
| After (`dist/commands` import) | 154 ms |  126 ms |

## The second step — the run's repeated reads

`doc:read`, `read:set`, `run:prep` and `run:step` were pre-built next (joshuafolkken/kit#4186): a
run calls each of them at every entry and between its steps. joshuafolkken/kit#7013 then pre-built
every remaining command at once.
