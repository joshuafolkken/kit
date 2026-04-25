#!/usr/bin/env tsx
/**
 * Check pnpm.overrides for unexpected changes.
 *
 * Usage:
 *   tsx scripts/overrides-check.ts --save      # save current overrides as snapshot
 *   tsx scripts/overrides-check.ts              # compare current overrides against snapshot
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
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

function print_diff(diff: OverridesDiff): never {
	console.error('✖ pnpm.overrides changed unexpectedly:')

	for (const entry of diff.added) {
		console.error(`  + added:   ${entry.key} → ${entry.value}`)
	}

	for (const entry of diff.removed) {
		console.error(`  - removed: ${entry.key} (was ${entry.value})`)
	}

	for (const entry of diff.modified) {
		console.error(`  ~ changed: ${entry.key}: ${entry.old_value} → ${entry.new_value}`)
	}

	return process.exit(1)
}

function run_overrides_check(save: boolean): void {
	const current = overrides_check.read_overrides_from_package(readFileSync('package.json', 'utf8'))

	if (save) {
		writeFileSync(overrides_check.SNAPSHOT_PATH, `${JSON.stringify(current, undefined, '\t')}\n`)
		console.info(`✔ Overrides snapshot saved to ${overrides_check.SNAPSHOT_PATH}`)
		process.exit(0)
	}

	const snapshot = load_snapshot()
	const diff = overrides_check.compare(snapshot, current)

	if (diff.is_changed) print_diff(diff)

	console.info('✔ pnpm.overrides unchanged.')
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
