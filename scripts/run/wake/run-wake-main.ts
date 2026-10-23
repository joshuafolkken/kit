#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { run_wake_cli } from './run-wake-cli'

// The `josh run:wake` entry, and the script `--start` spawns with `--loop`. It is kept apart from
// `run-wake-cli.ts` because `backlogrun-cli.ts` and `backlogrun-restart.ts` import that one: a bundle
// is one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await run_wake_cli.run(process.argv.slice(ARGV_OFFSET))
}
