import { existsSync } from 'node:fs'
import path from 'node:path'
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

// **A scoped pair after a merge reads unchecked own edits and where the merge meets the branch**
// (joshuafolkken/kit#4985, joshuafolkken/kit#6279). With no unchecked own edits, it
// re-runs nothing when that merge shares nothing with this branch's change.
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
// **Whatever cannot be read settles nothing**: a record that is absent or cannot be compared,
// a merge that changed a check's configuration, or a branch change
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

// Each stale record must be comparable; keep own edits from both checks alongside the merge.
async function moved_files(
	checks: ReadonlyArray<SyncedCheck>,
	tree: GateTree,
): Promise<MovedParts | undefined> {
	const parts = await Promise.all(
		checks.map(
			async (check) =>
				await since_green.read_moved_parts(check.stamp, check.label, undefined, tree),
		),
	)
	const known = parts.filter((part) => part !== undefined)

	if (known.length === 0 || known.length !== parts.length) return undefined

	return {
		changed: [...new Set(known.flatMap((part) => part.changed))].filter(
			(file) => !run_record_path.is_run_record(file),
		),
		synced: [...new Set(known.flatMap((part) => part.synced))],
	}
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

// What only `test:related` reads where the two sides meet: it leaves a file the graph cannot split to
// the branch's own tests (`test-related.ts`), which a settled record would skip.
function read_by_tests(
	checks: ReadonlyArray<SyncedCheck>,
	synced: ReadonlyArray<string>,
	map: ReadMap | undefined,
): ReadonlyArray<string> {
	if (!has_check(checks, scoped_green.TEST_SCRIPT)) return []

	return synced.filter((file) => is_read_by_tests(map, file))
}

// What only `lint:related` reads there: its type-aware rules read every file whose imports reach both,
// code between included.
function lint_meeting(
	checks: ReadonlyArray<SyncedCheck>,
	split: SyncedSplit,
): ReadonlyArray<string> {
	return has_check(checks, scoped_green.LINT_SCRIPT) ? split.meeting : []
}

// **`test:related` is named over the branch's own change, not over `meeting`** (joshuafolkken/kit#7052):
// each module there handed to it ran all its importers — 1,536 files where the branch changed 9. Its
// run over the branch's change reaches every `shared` test, capped as the branch's own run is; CI runs
// the whole suite. A file the branch deleted is no longer one to name.
function test_overlap_of(
	root: string,
	branch: ReadonlyArray<string>,
	split: SyncedSplit,
	common: ReadonlyArray<string>,
): ReadonlyArray<string> {
	const own =
		split.shared.length > 0 ? branch.filter((file) => existsSync(path.join(root, file))) : []

	return [...new Set([...common, ...own])]
}

// What a merge-only staleness reads: the stale checks, what the merge brought in, and where it meets
// this branch's change — the files the pair is narrowed to (`run-ship-narrowed.ts`) when any. An
// `overlap` of `undefined` is a merge the import graph could not split, `unsplit` the graph's failure
// (`test-related-synced.ts`), which the ship logs in `unsplit_line` and records on its lap
// (joshuafolkken/kit#6196): the pair runs as before rather than naming every synced module
// (joshuafolkken/kit#6185).
interface SyncReading {
	checks: ReadonlyArray<SyncedCheck>
	synced: ReadonlyArray<string>
	overlap: ReadonlyArray<string> | undefined
	// The part of `overlap` `test:related` is named over, plus the branch's change where a test meets
	// it (`test_overlap_of`); absent, the check reads `overlap`.
	test_overlap?: ReadonlyArray<string>
	unsplit?: string
}

type Overlap = Pick<SyncReading, 'overlap' | 'test_overlap' | 'unsplit'>

function joined(
	first: ReadonlyArray<string>,
	second: ReadonlyArray<string>,
): ReadonlyArray<string> {
	return [...new Set([...first, ...second])]
}

function with_own_edits(overlap: Overlap, changed: ReadonlyArray<string>): Overlap {
	if (overlap.overlap === undefined) return overlap

	return {
		...overlap,
		overlap: joined(changed, overlap.overlap),
		test_overlap: joined(changed, overlap.test_overlap ?? []),
	}
}

// Every file a named pair runs over, for the check that each is still nameable.
function named_of(reading: SyncReading): ReadonlyArray<string> | undefined {
	if (reading.overlap === undefined) return undefined

	return joined(reading.overlap, reading.test_overlap ?? [])
}

// The files one check of a named pair runs over: its own part of the reading where it has one —
// `test:related` its `test_overlap`, `lint:related` the `overlap` alone.
function files_for(
	reading: SyncReading | undefined,
	script: string,
	files: ReadonlyArray<string>,
): ReadonlyArray<string> {
	const own = script === scoped_green.TEST_SCRIPT ? reading?.test_overlap : reading?.overlap

	return own ?? files
}

function unsplit_line(failure: string): string {
	return (
		'scoped pair: the import graph could not split the merge with the default branch ' +
		`(${failure}), so the pair runs as before.`
	)
}

// The synced files and tests where the merge and this branch's change meet.
async function overlap_of(
	checks: ReadonlyArray<SyncedCheck>,
	synced: ReadonlyArray<string>,
	branch: ReadonlyArray<string>,
): Promise<Overlap> {
	const root = await changed_file_scope.repository_root_or_cwd()
	const map = test_read_map.read_map(root)
	const split = await test_related_synced.split(root, synced, branch, map)
	const both = synced.filter((file) => branch.includes(file))
	// Code the graph left unsplit — whole-suite modules included, which it never splits.
	const unsplit = synced.filter(
		(file) =>
			related_scope.is_relatable(file) && !branch.includes(file) && !split.left.includes(file),
	)

	if (split.failure !== undefined && unsplit.length > 0) {
		return { overlap: undefined, unsplit: split.failure }
	}

	const common = [...both, ...unsplit, ...read_by_tests(checks, synced, map)]
	// `shared` is the tests within `meeting`: a file both name counts once (joshuafolkken/kit#6197).
	const named = [...common, ...split.shared, ...lint_meeting(checks, split)]

	return {
		overlap: [...new Set(named)],
		test_overlap: test_overlap_of(root, branch, split, common),
	}
}

function checks_of(scripts: ReadonlyArray<string>): ReadonlyArray<SyncedCheck> {
	return CHECKS.filter((check) => scripts.includes(check.script))
}

// Unknown records or an absent merge keep the pair's existing fallback.
async function read_sync(
	tree: GateTree,
	scripts: ReadonlyArray<string>,
): Promise<SyncReading | undefined> {
	const checks = checks_of(scripts)
	const parts = await moved_files(checks, tree)

	if (parts === undefined || parts.synced.length === 0) return undefined

	const branch = await branch_change()

	if (branch === undefined) return undefined

	const overlap = await overlap_of(checks, parts.synced, branch)

	return {
		checks,
		synced: parts.synced,
		...with_own_edits(overlap, parts.changed),
	}
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
	if (reading.overlap === undefined || reading.overlap.length > 0) return undefined

	run_ship_narrowed.record(reading.checks, tree)

	return reason(reading.checks, reading.synced)
}

const run_ship_synced_scope = { checks_of, files_for, named_of, read_sync, settle, unsplit_line }

export type { SyncedCheck, SyncReading }
export { run_ship_synced_scope }
