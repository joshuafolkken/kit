# Running josh commands without tsx

kit ships `scripts/` as TypeScript and runs it with `tsx`. In kit's own checkout that costs one tsx
start per `pnpm josh` call: the dispatcher is loaded as TypeScript and imports each script in its
own process (joshuafolkken/kit#1342). A consumer pays twice. Its `josh` bin is the bundled
`dist/josh.js`, which runs under plain node and cannot load a `.ts` script, so it spawns a tsx child
for every script command — about 0.16 s per call on top of the command's own work
(joshuafolkken/kit#3328).

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
  would fire too. Move the guarded main into a `*-cli.ts` file first, as the hooks did
  (joshuafolkken/kit#2922). `build-commands.test.ts` refuses both.

## The first step — `doc:section`

`doc:section` was the first command marked: every workflow entry reads its documents section by
section, so it is among the most frequent calls a run makes, and it is local and deterministic.

Measured on 2026-10-06 (node 26.10.0, macOS), `node dist/josh.js doc:section CLAUDE.md Project`, 50
runs interleaved between the two builds:

| Build                          | Median | Fastest |
| ------------------------------ | -----: | ------: |
| Before (tsx child)             | 344 ms |  262 ms |
| After (`dist/commands` import) | 154 ms |  126 ms |
