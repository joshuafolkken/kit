#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { run_progress_read } from './run-progress-read'
import { run_watcher_guard } from './run-watcher-guard'

// `josh run:watcher:guard` — refuses when lane children are in-flight but the progress watcher has not
// pinged its life record recently (joshuafolkken/kit#2113). This is the hand-run form, kept for a run
// that calls it before a loop iteration; the *automatic* wiring is in `pretool-guard.ts`, which
// composes the same guard through `run-watcher-hook.ts` so every tool call is checked
// (joshuafolkken/kit#2353).
//
// **Exits 0 (ok) or 1 (stale).** A non-zero exit is what the hook mechanism treats as a refusal —
// the same contract `batch:guard` and `rule:guard` hold.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

async function run(): Promise<number> {
	const life_target = await run_progress_read.live_target()
	const result = await run_watcher_guard.check(life_target)

	if (result.kind === 'ok') return SUCCESS_EXIT_CODE

	console.error(result.note)

	return FAILURE_EXIT_CODE
}

async function main(): Promise<void> {
	process.exitCode = await run()
}

const run_watcher_guard_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export { run_watcher_guard_cli }
