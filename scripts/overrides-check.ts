#!/usr/bin/env tsx
/**
 * Check dependency overrides for unexpected changes.
 *
 * Reads both locations pnpm honours — `overrides:` in pnpm-workspace.yaml (pnpm 11) and
 * `pnpm.overrides` in package.json (legacy) — so an empty one is never mistaken for "no overrides".
 *
 * Usage:
 *   tsx scripts/overrides-check.ts --save      # save current overrides as snapshot
 *   tsx scripts/overrides-check.ts              # compare current overrides against snapshot
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { overrides_files } from './overrides/overrides-files'
import { overrides_check, type OverridesDiff } from './overrides/overrides-logic'
import { overrides_snapshot_schema } from './schemas'

function is_file_not_found(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function load_snapshot(): Record<string, string> {
	try {
		return overrides_snapshot_schema.parse(
			JSON.parse(readFileSync(overrides_check.SNAPSHOT_PATH, 'utf8')),
		)
	} catch (error) {
		if (is_file_not_found(error)) {
			console.error(`✖ Snapshot not found: ${overrides_check.SNAPSHOT_PATH}`)
			console.error('  Run with --save first to create a snapshot.')
		} else {
			console.error(`✖ Invalid snapshot JSON: ${overrides_check.SNAPSHOT_PATH}`)
		}

		throw new Error('Failed to load snapshot', { cause: error })
	}
}

function print_diff(diff: OverridesDiff, sources_summary: string): never {
	console.error(`✖ overrides changed unexpectedly (${sources_summary}):`)

	for (const line of overrides_check.format_diff_lines(diff)) {
		console.error(line)
	}

	return process.exit(1)
}

function save_snapshot(current: Record<string, string>, sources_summary: string): never {
	writeFileSync(overrides_check.SNAPSHOT_PATH, `${JSON.stringify(current, undefined, '\t')}\n`)
	console.info(
		`✔ Overrides snapshot saved to ${overrides_check.SNAPSHOT_PATH} (${sources_summary})`,
	)

	return process.exit(0)
}

function run_overrides_check(should_save: boolean): void {
	const sources = overrides_files.read_current_sources()
	const summary = overrides_check.describe_sources(sources)
	const current = overrides_check.read_overrides(sources)

	if (should_save) save_snapshot(current, summary)

	const snapshot = load_snapshot()
	const diff = overrides_check.compare(snapshot, current)

	if (diff.is_changed) print_diff(diff, summary)

	console.info(`✔ overrides unchanged (${summary}).`)
}

function main(): void {
	const { values } = parseArgs({
		options: { save: { type: 'boolean', default: false } },
		strict: true,
	})

	run_overrides_check(values.save)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

export { run_overrides_check }
