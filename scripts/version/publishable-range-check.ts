#!/usr/bin/env tsx
/**
 * Release gate: every dependency range this package publishes must resolve for a consumer, and no
 * peer range it publishes may fall below an installed toolkit's.
 *
 * Usage: tsx scripts/version/publishable-range-check.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { adopt_toolkits } from '#scripts/adopt/adopt-toolkits'
import { npm_registry } from './npm-registry'
import { peer_floor } from './peer-floor'
import {
	publishable_range,
	type ProbeResult,
	type PublishedRange,
	type RangeProbe,
} from './publishable-range'

const PACKAGE_JSON_PATH = 'package.json'
const FAILURE_EXIT_CODE = 1
const NODE_MODULES = 'node_modules'

// A registry query rather than a direct fetch: safe-chain installs shims ahead of the package
// managers on PATH, so the answer comes back already filtered by the same minimum-age policy a
// consumer installs under. A plain fetch would read the unfiltered registry and pass a range no
// consumer can resolve — the exact blind spot this guard exists to close.
function probe_range(name: string, range: string): ProbeResult {
	return npm_registry.view(`${name}@${range}`, 'version')
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

/** No installed toolkit means nothing to compare against, which passes in silence. */
function check_peer_floors(
	package_json_content: string,
	toolkit_json_contents: ReadonlyArray<string>,
): number {
	const lagging = peer_floor.find_lagging(package_json_content, toolkit_json_contents)

	if (lagging.length === 0) return 0

	console.error(peer_floor.format_failure(lagging))

	return FAILURE_EXIT_CODE
}

// The manifest of every `@joshuafolkken/*` toolkit this project declares and has installed. The
// roster is `josh adopt`'s own rather than a second one kept here, so a toolkit published later is
// compared the day it is installed. kit's own checkout declares none, and a declared toolkit that is
// not installed has no manifest to read.
function read_installed_toolkit_manifests(project_root: string): Array<string> {
	return adopt_toolkits
		.all_declared_toolkits(project_root)
		.map((package_name) => path.join(project_root, NODE_MODULES, package_name, PACKAGE_JSON_PATH))
		.filter((manifest_path) => existsSync(manifest_path))
		.map((manifest_path) => readFileSync(manifest_path, 'utf8'))
}

// Both checks always run, so one invocation reports everything there is to fix.
function main(): void {
	const package_json_content = readFileSync(PACKAGE_JSON_PATH, 'utf8')
	const range_exit_code = check(package_json_content, probe_range)
	const toolkit_json_contents = read_installed_toolkit_manifests(process.cwd())
	const peer_exit_code = check_peer_floors(package_json_content, toolkit_json_contents)

	process.exit(Math.max(range_exit_code, peer_exit_code))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

const publishable_range_check = { check, check_peer_floors, read_installed_toolkit_manifests }

export { publishable_range_check }
