#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { run_handoff_lanes } from './run-handoff-lanes'

// `josh run:handoff-lanes` — the hand-off chain (`run-handoff-lanes.ts`); it takes no arguments.

const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const USAGE = 'Usage: josh run:handoff-lanes'

function print(text: string): void {
	console.info(text)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	if (argv.length > 0) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	return await run_handoff_lanes.run({ ...run_handoff_lanes.DEFAULT_IO, print })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(ARGV_OFFSET))
}

const run_handoff_lanes_cli = { USAGE, run }

export { run_handoff_lanes_cli }
