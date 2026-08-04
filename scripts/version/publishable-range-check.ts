#!/usr/bin/env tsx
/**
 * Release gate: every dependency range this package publishes must resolve for a consumer.
 *
 * Usage: tsx scripts/version/publishable-range-check.ts
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execaSync } from 'execa'
import {
	publishable_range,
	type ProbeResult,
	type PublishedRange,
	type RangeProbe,
} from './publishable-range'

const PACKAGE_JSON_PATH = 'package.json'
const VIEW_TIMEOUT_MS = 30_000
const FAILURE_EXIT_CODE = 1

// A registry query rather than a direct fetch: safe-chain installs shims ahead of the package
// managers on PATH, so the answer comes back already filtered by the same minimum-age policy a
// consumer installs under. A plain fetch would read the unfiltered registry and pass a range no
// consumer can resolve — the exact blind spot this guard exists to close.
//
// `pnpm view` rather than `npm view` because npm refuses to run at all inside a project whose
// `devEngines.packageManager` names pnpm with `onFail: "error"`, failing every probe with
// EBADDEVENGINES instead of answering. Both are shimmed, so the filtered view is preserved.
function probe_range(name: string, range: string): ProbeResult {
	const result = execaSync('pnpm', ['view', `${name}@${range}`, 'version'], {
		reject: false,
		timeout: VIEW_TIMEOUT_MS,
	})

	return { exit_code: result.exitCode ?? FAILURE_EXIT_CODE, stdout: result.stdout }
}

function report(violations: ReadonlyArray<PublishedRange>, total: number): number {
	if (violations.length === 0) {
		console.info(publishable_range.format_success(total))

		return 0
	}

	console.error(publishable_range.format_failure(violations))

	return FAILURE_EXIT_CODE
}

function report_skipped(skipped: ReadonlyArray<PublishedRange>): void {
	if (skipped.length === 0) return

	console.info(publishable_range.format_skipped(skipped))
}

/** Returns the process exit code so the decision can be asserted without spawning a process. */
function check(package_json_content: string, probe: RangeProbe): number {
	const ranges = publishable_range.read_published_ranges(package_json_content)
	const { checked, skipped } = publishable_range.partition_registry_ranges(ranges)

	report_skipped(skipped)

	return report(publishable_range.find_unsatisfiable(checked, probe), checked.length)
}

function main(): void {
	process.exit(check(readFileSync(PACKAGE_JSON_PATH, 'utf8'), probe_range))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

const publishable_range_check = { check, probe_range }

export { publishable_range_check }
