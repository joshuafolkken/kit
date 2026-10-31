import { gate_labels } from '#scripts/gate/gate-labels'
import type { GateTree } from '#scripts/gate/gate-tree'
import type { MovedParts } from '#scripts/gate/moved-paths'
import { scoped_green } from '#scripts/gate/scoped-green'
import { since_green } from '#scripts/gate/since-green'
import { changed_file_scope } from '#scripts/git/changed-file-scope'
import { changed_paths } from '#scripts/git/changed-paths'
import type { FileMapStampAccess } from '#scripts/josh/file-map-stamp'
import { run_record_path } from '#scripts/josh/run-record-path'
import { review_stamps } from '#scripts/review/review-stamps'
import { test_read_map, type ReadMap } from '#scripts/test/test-read-map'
import { related_scope } from '#scripts/test/test-related-scope'
import { test_related_synced, type SyncedSplit } from '#scripts/test/test-related-synced'
import { whole_suite_files } from '#scripts/test/whole-suite-files'
import { run_ship_narrowed } from './run-ship-narrowed'

// **A scoped pair whose records went stale only because a merge with the default branch moved the base
// re-runs nothing when that merge shares nothing with this branch's change** (joshuafolkken/kit#4985).
// The sync, the commit stage's catch-up and a lane's own conflict merge each moved the base under a
// pair green on the branch side, and the pair re-ran over the branch's related set — minutes of core
// budget for main's files, which main's CI had already verified.
//
// **Where the two can meet still runs.** A file both sides changed, a test reaching both a synced module
// and this branch's change (`test-related-synced.ts`), or a synced module the import graph cannot
// split keeps the pair running as before, narrowed by the checks themselves (`since-green.ts`). So
// does, for `lint:related`, any file whose imports reach both sides, and for `test:related` a synced
// file every test depends on or a non-code file a test reads: `josh test:related` leaves those to the
// branch's own tests, which a settled record would skip. The
// gate still runs over the merged tree wherever it ran before (joshuafolkken/kit#4825), and CI runs
// the whole suite.
//
// **Whatever cannot be read settles nothing**: a record that is absent or cannot be compared, a branch
// side that moved since its record, a merge that changed a check's configuration, or a branch change
// git cannot read.

interface SyncedCheck {
	script: string
	label: string
	stamp: FileMapStampAccess
}

const CHECKS: ReadonlyArray<SyncedCheck> = [
	{
		script: scoped_green.LINT_SCRIPT,
		label: gate_labels.LINT_LABEL,
		stamp: review_stamps.lint_related_stamp,
	},
	{
		script: scoped_green.TEST_SCRIPT,
		label: gate_labels.UNIT_LABEL,
		stamp: review_stamps.test_related_stamp,
	},
]

function is_sync_only(parts: MovedParts): boolean {
	return (
		parts.synced.length > 0 &&
		parts.changed.every((relative) => run_record_path.is_run_record(relative))
	)
}

async function synced_of(
	check: SyncedCheck,
	tree: GateTree,
): Promise<ReadonlyArray<string> | undefined> {
	const parts = await since_green.read_moved_parts(check.stamp, check.label, undefined, tree)

	return parts !== undefined && is_sync_only(parts) ? parts.synced : undefined
}

// What the merge brought in, when every stale record moved by nothing else.
async function synced_files(
	checks: ReadonlyArray<SyncedCheck>,
	tree: GateTree,
): Promise<ReadonlyArray<string> | undefined> {
	const parts = await Promise.all(checks.map(async (check) => await synced_of(check, tree)))
	const known = parts.filter((synced) => synced !== undefined)

	return known.length > 0 && known.length === parts.length ? [...new Set(known.flat())] : undefined
}

async function branch_change(): Promise<ReadonlyArray<string> | undefined> {
	try {
		return await changed_paths.read_changed_paths(false)
	} catch {
		return undefined
	}
}

function is_whole_suite(file: string): boolean {
	return whole_suite_files.WHOLE_SUITE_FILES.has(file)
}

// A synced file a test can reach with no import the graph splits: one every test depends on, or a
// non-code file a recorded test reads — every one of them when no map was recorded.
function is_read_by_tests(map: ReadMap | undefined, file: string): boolean {
	if (is_whole_suite(file)) return true
	if (related_scope.is_relatable(file)) return false

	return map === undefined || test_read_map.readers_of(map, file).length > 0
}

function has_check(checks: ReadonlyArray<SyncedCheck>, script: string): boolean {
	return checks.some((check) => check.script === script)
}

// What only one check reads where the two sides meet. `lint:related`'s type-aware rules read every
// file whose imports reach both, code between included; `test:related` leaves a file the graph
// cannot split to the branch's own tests (`test-related.ts`), which a settled record would skip.
function check_overlap(
	checks: ReadonlyArray<SyncedCheck>,
	synced: ReadonlyArray<string>,
	split: SyncedSplit,
	map: ReadMap | undefined,
): ReadonlyArray<string> {
	const meeting = has_check(checks, scoped_green.LINT_SCRIPT) ? split.meeting : []
	const read = has_check(checks, scoped_green.TEST_SCRIPT)
		? synced.filter((file) => is_read_by_tests(map, file))
		: []

	return [...meeting, ...read]
}

// The synced files and tests where the merge and this branch's change meet.
async function overlap_of(
	checks: ReadonlyArray<SyncedCheck>,
	synced: ReadonlyArray<string>,
	branch: ReadonlyArray<string>,
): Promise<ReadonlyArray<string>> {
	const root = await changed_file_scope.repository_root_or_cwd()
	const map = test_read_map.read_map(root)
	const split = await test_related_synced.split(root, synced, branch, map)
	const both = synced.filter((file) => branch.includes(file))
	// Code the graph left unsplit — whole-suite modules included, which it never splits.
	const unsplit = synced.filter(
		(file) =>
			related_scope.is_relatable(file) && !branch.includes(file) && !split.left.includes(file),
	)

	return [...both, ...split.shared, ...unsplit, ...check_overlap(checks, synced, split, map)]
}

// What a merge-only staleness reads: the stale checks, what the merge brought in, and where it meets
// this branch's change — the files the pair is narrowed to (`run-ship-narrowed.ts`) when any.
interface SyncReading {
	checks: ReadonlyArray<SyncedCheck>
	synced: ReadonlyArray<string>
	overlap: ReadonlyArray<string>
}

function checks_of(scripts: ReadonlyArray<string>): ReadonlyArray<SyncedCheck> {
	return CHECKS.filter((check) => scripts.includes(check.script))
}

// `undefined` when the stale records moved by more than a merge, and the pair runs as before.
async function read_sync(
	tree: GateTree,
	scripts: ReadonlyArray<string>,
): Promise<SyncReading | undefined> {
	const checks = checks_of(scripts)
	const synced = await synced_files(checks, tree)
	const branch = synced === undefined ? undefined : await branch_change()

	if (synced === undefined || branch === undefined) return undefined

	return { checks, synced, overlap: await overlap_of(checks, synced, branch) }
}

function reason(checks: ReadonlyArray<SyncedCheck>, synced: ReadonlyArray<string>): string {
	return (
		`scoped pair: ${checks.map((check) => check.script).join(' and ')} not re-run — the ` +
		`${String(synced.length)} file(s) the merge with the default branch brought in share no file ` +
		"or test with this branch's change."
	)
}

// The line a settled pair prints, after re-recording each stale check green on this tree so the gate
// and the brief read it as checked — or `undefined` where the merge meets the branch.
function settle(reading: SyncReading, tree: GateTree): string | undefined {
	if (reading.overlap.length > 0) return undefined

	run_ship_narrowed.record(reading.checks, tree)

	return reason(reading.checks, reading.synced)
}

const run_ship_synced_scope = { checks_of, read_sync, settle }

export type { SyncedCheck, SyncReading }
export { run_ship_synced_scope }
