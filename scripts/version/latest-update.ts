#!/usr/bin/env tsx
/**
 * Filtered `pnpm update --latest` that skips capped-override packages and never downgrades.
 *
 * Usage: tsx scripts/version/latest-update.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { overrides_files } from '#scripts/overrides/overrides-files'
import { overrides_check } from '#scripts/overrides/overrides-logic'
import { file_reader } from '#scripts/read-file'
import { execaSync } from 'execa'
import { latest_regression, type VersionRegression } from './latest-regression'
import { preinstall_version_update } from './preinstall-version-update'

const PACKAGE_JSON_PATH = 'package.json'
const LOCKFILE_PATH = 'pnpm-lock.yaml'

interface TreeSnapshot {
	package_json: string
	lockfile: string
}

function run(arguments_: Array<string>): number {
	const [cmd, ...rest] = arguments_
	if (cmd === undefined) return 0
	console.info(`\n▶ ${arguments_.join(' ')}`)
	const result = execaSync(cmd, rest, { stdio: 'inherit', reject: false })

	return result.exitCode ?? 1
}

function run_update(update_arguments: Array<string> | undefined): number {
	if (update_arguments === undefined) {
		console.info('\n⏭ No packages to update.')

		return 0
	}

	return run(update_arguments)
}

function take_snapshot(): TreeSnapshot {
	return {
		package_json: readFileSync(PACKAGE_JSON_PATH, 'utf8'),
		lockfile: file_reader.read_file_or_empty(LOCKFILE_PATH),
	}
}

// Restoring the files verbatim is the only recovery available: while the newer version is
// suppressed it is also unresolvable, so putting the old range back and re-installing fails with
// "the latest release is <older>". The captured lockfile still carries the resolved URL and
// integrity, which installs fine.
function restore_snapshot(snapshot: TreeSnapshot): void {
	writeFileSync(PACKAGE_JSON_PATH, snapshot.package_json)
	if (snapshot.lockfile.length > 0) writeFileSync(LOCKFILE_PATH, snapshot.lockfile)
}

function report_kept_back(regressions: ReadonlyArray<VersionRegression>): void {
	console.info(latest_regression.format_kept_back_notice(regressions))
}

function build_command(): Array<string> | undefined {
	const content = readFileSync(PACKAGE_JSON_PATH, 'utf8')

	return overrides_check.build_update_command(overrides_files.read_current_overrides(), content)
}

interface UpdateOutcome {
	status: number
	is_rolled_back: boolean
}

function find_regressions_after_update(snapshot: TreeSnapshot): Array<VersionRegression> {
	const after = readFileSync(PACKAGE_JSON_PATH, 'utf8')

	return latest_regression.find_regressions(snapshot.package_json, after)
}

// Rolling the whole update back rather than retrying without the offender: excluding a package from
// the update targets does not exclude it from resolution, and while its installed version sits above
// the newest allowed one that version is unresolvable, so a retry can only fail with
// ERR_PNPM_NO_MATCHING_VERSION. The choice is genuinely between a downgrade and no update, and this
// takes no update — the condition is transient, so a later run picks the upgrades up.
//
// Exits zero: the tree is left exactly as it was found, nothing is broken, and every workflow that
// runs `josh latest` in its preamble would otherwise stop for a situation that resolves itself.
function update_without_downgrading(snapshot: TreeSnapshot): UpdateOutcome {
	const status = run_update(build_command())
	if (status !== 0) return { status, is_rolled_back: false }

	const regressions = find_regressions_after_update(snapshot)
	if (regressions.length === 0) return { status, is_rolled_back: false }

	restore_snapshot(snapshot)
	report_kept_back(regressions)

	return { status: 0, is_rolled_back: true }
}

function report_excluded(excluded: ReadonlyArray<string>): void {
	if (excluded.length === 0) return

	console.info(`\n⏭ Skipping held-back / capped packages: ${excluded.join(', ')}`)
}

// Printed unconditionally so the overrides verdict does not depend on an agent remembering which
// file to open afterwards (kit #740). The summary names the files that were read, so a run with no
// overrides anywhere is distinguishable from a run that looked in the wrong place.
function report_overrides(before: Record<string, string>): void {
	const summary = overrides_check.describe_sources(overrides_files.read_current_sources())
	const diff = overrides_check.compare(before, overrides_files.read_current_overrides())

	if (!diff.is_changed) {
		console.info(`\n✔ overrides unchanged (${summary}).`)

		return
	}

	console.warn(`\n⚠ overrides changed (${summary}) — restore them unless the change was intended:`)

	for (const line of overrides_check.format_diff_lines(diff)) {
		console.warn(line)
	}
}

function main(): void {
	const snapshot = take_snapshot()
	const overrides = overrides_files.read_current_overrides()

	report_excluded(overrides_check.list_excluded_package_names(overrides))

	const outcome = update_without_downgrading(snapshot)

	report_overrides(overrides)

	// Skipped after a rollback so the tree really is left exactly as it was found — this sync writes
	// package.json to advance the pinned safe-chain version, which would contradict the notice that
	// nothing changed.
	if (outcome.status === 0 && !outcome.is_rolled_back) {
		preinstall_version_update.sync(PACKAGE_JSON_PATH)
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

const latest_update = { run, main, update_without_downgrading, take_snapshot, restore_snapshot }

export { latest_update }
export type { TreeSnapshot }
