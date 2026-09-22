#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { run_stranded } from './run-stranded'
import { run_stranded_detect } from './run-stranded-detect'

// `josh run:stranded` — read the three facts once and print the verdict (joshuafolkken/kit#2375). This
// is the manual and testable face of the detector `stop-guard.ts` runs on every stop; both call the one
// `detect_and_report`, so the command and the hook can never drift.
//
// **It reports, it never stops.** The exit code is always success — a strand is a state to surface, not
// an error to fail on — so a caller (a person, a test, the wired hook) reads the verdict off stdout and
// is never halted by it. Anything unreadable prints `ok` for the same reason: nothing carried to strand,
// so the caller carries on.

const SUCCESS_EXIT_CODE = 0

async function main(): Promise<void> {
	try {
		console.info(await run_stranded_detect.detect_and_report())
	} catch {
		console.info(run_stranded.OK)
	}

	process.exitCode = SUCCESS_EXIT_CODE
}

const run_stranded_cli = { main }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export { run_stranded_cli }
