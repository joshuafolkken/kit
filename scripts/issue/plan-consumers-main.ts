#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { plan_consumers_cli } from './plan-consumers-cli'

// The `josh plan:consumers` entry, kept apart from `plan-consumers-cli.ts` so a bundle carrying that
// module never fires this guard (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await plan_consumers_cli.run(process.argv.slice(ARGV_OFFSET))
}
