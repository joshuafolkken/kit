#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { run_ship_wait_cli } from './run-ship-wait-cli'

// The `josh ship:wait` entry, kept apart from `run-ship-wait-cli.ts` because `ship --detach` imports
// that one (`run-ship-detach-wait.ts`): a bundle is one file, so a main guard there would fire for
// every command that carries it (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await run_ship_wait_cli.run(process.argv.slice(ARGV_OFFSET))
}
