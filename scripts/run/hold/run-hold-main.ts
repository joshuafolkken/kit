#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { run_hold_cli } from './run-hold-cli'

// The `josh run:hold` and `josh run:release` entry, kept apart from `run-hold-cli.ts` because other
// modules import that one: a bundle is one file, so a main guard there would fire for every command
// that carries it (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await run_hold_cli.run(process.argv.slice(ARGV_OFFSET))
}
