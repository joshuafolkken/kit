#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { run_wait_cli } from './run-wait-cli'

// The `josh wait` entry, kept apart from `run-wait-cli.ts` so a bundle that imports the CLI module
// does not fire this guard (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await run_wait_cli.run(process.argv.slice(ARGV_OFFSET))
}
