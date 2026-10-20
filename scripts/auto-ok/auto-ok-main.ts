#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { auto_ok_cli } from './auto-ok-cli'

// The `josh auto-ok:next` entry, kept apart from `auto-ok-cli.ts` because other modules import that
// one: a bundle is one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186).
//
// `process.exitCode` rather than `process.exit()`: the answer is written with `console.info`, and on
// macOS a write to a pipe is asynchronous — `process.exit()` can tear the process down before it has
// drained, and this command's whole contract is `answer=$(pnpm josh auto-ok:next)`. The same shape
// is already in `scripts/cost-runtime/cost-cli.ts`, which met the truncation first.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await auto_ok_cli.run(process.argv.slice(ARGV_OFFSET))
}
