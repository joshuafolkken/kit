#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { backlog_stalled } from './backlog-stalled'
import { backlog_stalled_detect } from './backlog-stalled-detect'

// `josh backlog:stalled` — read the three conditions once and print the verdict
// (joshuafolkken/kit#2359). This is the manual and testable face of the detector `stop-guard.ts` runs
// on every stop; both call the one `detect_and_report`, so the command and the hook can never drift.
//
// **It reports, it never stops.** The exit code is always success — a stall is a state to surface, not
// an error to fail on — so a caller (a person, a test, a wired hook) reads the verdict off stdout and is
// never halted by it. An unreadable record prints `unreadable` for the same reason: the run carries on.

const SUCCESS_EXIT_CODE = 0

async function main(): Promise<void> {
	try {
		console.info(await backlog_stalled_detect.detect_and_report())
	} catch {
		console.info(backlog_stalled.UNREADABLE)
	}

	process.exitCode = SUCCESS_EXIT_CODE
}

const backlog_stalled_cli = { main }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export { backlog_stalled_cli }
