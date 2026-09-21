#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { CSPELL_CACHE_FILE, CSPELL_CACHE_FLAGS } from '#scripts/josh/josh-command-types'
import { lane_cache_run } from '#scripts/lane/lane-cache-run'
import { buffered_process, FAIL_EXIT_CODE } from '#scripts/lib/buffered-process'

const ARGV_START = 2
// `--no-progress` turns off cspell's per-file `N/1607 <path> cached` line (joshuafolkken/kit#2296).
// Those lines ran to 1,607 of them — the whole output past the 8,000-character tool cap — so a gate
// that failed on one unknown word buried the failure under progress and a run could read only the
// first of several failures. The summary and the issue lines it prints are untouched; only the
// progress reporter is silenced.
const CSPELL_NO_PROGRESS = '--no-progress'
const CSPELL_ARGS = [
	'exec',
	'cspell',
	'.',
	'--dot',
	CSPELL_NO_PROGRESS,
	...CSPELL_CACHE_FLAGS,
] as const

// The wrapper puts cache transfer directly around cspell rather than around the whole gate (#2060),
// so a later failing check cannot prevent a completed cache from reaching the primary checkout.
async function run(extra_arguments: ReadonlyArray<string> = []): Promise<number> {
	const result = await lane_cache_run.run(
		CSPELL_CACHE_FILE,
		async () => await buffered_process.run_buffered_process([...CSPELL_ARGS, ...extra_arguments]),
	)
	if (result.output) process.stdout.write(result.output)

	return buffered_process.is_process_failed(result) ? FAIL_EXIT_CODE : 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(ARGV_START))
}

const cspell_cached = { run }

export { CSPELL_ARGS, cspell_cached }
