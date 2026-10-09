#!/usr/bin/env tsx
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { file_reader } from '#scripts/lib/read-file'
import { metrics_baseline_merge } from './metrics-baseline-merge'

// The git merge driver `.gitattributes` names for `.josh/metrics-baseline.json`.
// git calls it with the base, ours and theirs versions of the file as
// `%O %A %B`; it writes the merged file over ours and exits 0, or exits non-zero to leave the
// conflict to git. The merge itself is `metrics-baseline-merge.ts`; `scripts/git/merge-drivers.ts`
// registers this script for `josh main:merge`.

const ARGV_OFFSET = 2
const CONFLICT_EXIT_CODE = 1

function read_side(file_path: string): string {
	return file_reader.read_if_readable(file_path) ?? ''
}

function run(argv: ReadonlyArray<string>): number {
	const [base_path = '', ours_path = '', theirs_path = ''] = argv
	const merged = metrics_baseline_merge.merge(
		read_side(base_path),
		read_side(ours_path),
		read_side(theirs_path),
	)

	if (merged === undefined) return CONFLICT_EXIT_CODE

	writeFileSync(ours_path, merged)

	return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = run(process.argv.slice(ARGV_OFFSET))
}

const metrics_merge_driver = { run }

export { metrics_merge_driver }
