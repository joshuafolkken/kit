#!/usr/bin/env tsx
/**
 * Check pnpm.overrides for unexpected changes.
 *
 * Usage:
 *   tsx scripts/overrides-check.ts --save      # save current overrides as snapshot
 *   tsx scripts/overrides-check.ts              # compare current overrides against snapshot
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { overrides_check } from './overrides/overrides-logic'
import { overrides_snapshot_schema } from './schemas'

const { values } = parseArgs({
	options: { save: { type: 'boolean', default: false } },
	strict: true,
})

const current = overrides_check.read_overrides_from_package(readFileSync('package.json', 'utf8'))

if (values.save) {
	writeFileSync(overrides_check.SNAPSHOT_PATH, `${JSON.stringify(current, undefined, '\t')}\n`)
	console.info(`✔ Overrides snapshot saved to ${overrides_check.SNAPSHOT_PATH}`)
	process.exit(0)
}

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

const snapshot = load_snapshot()
const diff = overrides_check.compare(snapshot, current)

if (diff.is_changed) {
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

	process.exit(1)
}

console.info('✔ pnpm.overrides unchanged.')
