#!/usr/bin/env tsx
/**
 * Check dependency overrides for unexpected changes.
 *
 * Checks effective overrides in pnpm-workspace.yaml and reports ignored package.json entries.
 *
 * Usage:
 *   tsx scripts/overrides/overrides-check.ts --save      # save current overrides as snapshot
 *   tsx scripts/overrides/overrides-check.ts              # compare current overrides against snapshot
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cli_flags } from '#scripts/lib/cli-flags'
import { overrides_snapshot_schema } from '#scripts/lib/schemas'
import { overrides_files } from './overrides-files'
import { overrides_check, type OverridesDiff } from './overrides-logic'

const ARGV_OFFSET = 2
const OPTIONS = { save: { type: 'boolean', default: false } } as const
const USAGE = cli_flags.usage_line(['--save'], 'overrides')

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

// A line nobody can read is refused before the snapshot is read or written: a misspelled `--save` that
// fell through would compare against the record the caller meant to replace.
function refuse_usage(): never {
	console.error(USAGE)

	return process.exit(1)
}

function main(argv: ReadonlyArray<string>): void {
	const values = cli_flags.values_of(argv, OPTIONS)

	if (values === undefined) refuse_usage()
	run_overrides_check(values.save)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export { run_overrides_check, main }
