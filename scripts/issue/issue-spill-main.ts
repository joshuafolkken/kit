#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_spill_cli } from './issue-spill-cli'

// The `josh issue:spill` entry, kept apart from `issue-spill-cli.ts` so a bundle that imports that
// one carries no main guard of its own (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await issue_spill_cli.run(process.argv.slice(ARGV_OFFSET))
}
