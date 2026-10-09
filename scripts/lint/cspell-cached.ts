#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { project_checks } from '#scripts/gate/project-checks'
import { CSPELL_CACHE_FILE, CSPELL_CACHE_FLAGS } from '#scripts/josh/josh-command-types'
import { lane_cache_run } from '#scripts/lane/lane-cache-run'
import { buffered_process, FAIL_EXIT_CODE } from '#scripts/lib/buffered-process'

const ARGV_START = 2
// `--no-progress` turns off cspell's per-file `N/1607 <path> cached` line.
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
function basic_skip_reason(directory: string): string | undefined {
	if (!project_checks.is_basic(directory)) return undefined

	if (!project_checks.has_config(directory, project_checks.CSPELL_CONFIGS)) {
		return 'no cspell configuration was found'
	}

	if (!project_checks.has_bin(directory, 'cspell')) return 'cspell is not installed'

	return undefined
}

async function run(extra_arguments: ReadonlyArray<string> = []): Promise<number> {
	const reason = basic_skip_reason(process.cwd())

	if (reason !== undefined) {
		console.info(project_checks.skip_notice('cspell', reason))

		return 0
	}

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
