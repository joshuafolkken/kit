import { existsSync } from 'node:fs'
import path from 'node:path'
import type { GateTree } from '#scripts/gate/gate-tree'
import { scoped_green } from '#scripts/gate/scoped-green'
import { verification_inputs } from '#scripts/gate/verification-inputs'
import { changed_file_scope } from '#scripts/git/changed-file-scope'
import { file_map_stamp } from '#scripts/josh/file-map-stamp'
import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { run_record_path } from '#scripts/josh/run-record-path'
import { review_stamps } from '#scripts/review/review-stamps'
import { run_ship_lap } from './run-ship-lap'
import type { SyncedCheck } from './run-ship-synced-scope'

// **A scoped pair the ship can name the moved files of runs over them alone** (joshuafolkken/kit#5531).
// A pair whose records could not narrow re-ran over the whole branch's related set after a review
// fix of one file, or a main merge meeting the branch in one.
//
// **The check is no weaker.** Each named run starts from a tree the pair was green on over the whole
// branch: the tree this ship last met the pair green on, on the same base (a review round's fix), or the
// pre-merge tree a sync-only record vouches for (`run-ship-synced-scope.ts`, the files where the merge
// meets the branch). What can differ from it is the named files' reach, which the explicit run reads
// (`josh test:related <file>...`), so green there records each check green on this tree as a bare run
// would. **Whatever cannot be named runs the pair as before**: a moved file that configures a check,
// one no longer on disk — its importers are unreachable by name — or no green tree on this base.

// **A ship relaunched after a round-2 stop starts from the tree that round read** (joshuafolkken/kit#7789).
// A new process has no tree it met the pair green on, so the fix of one file re-ran the pair bare over
// the whole branch. The briefed stamp keeps the tree the last review round was briefed on
// (`review-stamps.ts`) — unlike the final-review stamp, which `review:record` removes on the very finding
// that stops round 2 — and it stands in only when every scoped check's green record describes exactly that tree and base, so a
// stamp the records do not vouch for — or a base a main merge moved — runs as before.

const should_forward_stderr = true
const MOVED_SINCE_GREEN = 'moved since this ship last met the pair green on this base'
const MOVED_SINCE_ROUND_TWO =
	'moved since the tree the stopped round 2 read, the pair green on it — resumed from the round-2 fix'

type ResumedFrom = 'round-2-fix' | 'none'

interface Baseline {
	tree: GateTree
	why: string
	resumed_from: ResumedFrom
}

interface Moved {
	files: ReadonlyArray<string>
	why: string
	resumed_from: ResumedFrom
}

const green: { tree?: GateTree } = {}

// The tree the pair was last green on in this ship process, whichever way it got there.
function remember(tree: GateTree): void {
	green.tree = tree
}

function forget(): void {
	delete green.tree
}

function is_nameable(
	checks: ReadonlyArray<SyncedCheck>,
	files: ReadonlyArray<string>,
	root: string,
): boolean {
	if (files.some((file) => !existsSync(path.join(root, file)))) return false

	return checks.every((check) => !verification_inputs.configures(check.label, files))
}

// The files to name, or `undefined` when they cannot vouch for the whole branch.
async function nameable(
	checks: ReadonlyArray<SyncedCheck>,
	files: ReadonlyArray<string>,
): Promise<ReadonlyArray<string> | undefined> {
	const root = await changed_file_scope.repository_root_or_cwd()

	return is_nameable(checks, files, root) ? files : undefined
}

// Every scoped check green on exactly this tree; a tree with no base or no files proves nothing.
function is_green(tree: GateTree): boolean {
	if (tree.base === undefined || Object.keys(tree.files).length === 0) return false

	return scoped_green.missing_scripts(tree.files, tree.base).length === 0
}

// The tree round 2 started on, when the pair's records still vouch for it.
function round_two_tree(): GateTree | undefined {
	const stamp = review_stamps.briefed_stamp.read()

	if (stamp === undefined) return undefined
	const tree = { files: stamp.files, base: stamp.base }

	return is_green(tree) ? tree : undefined
}

// The green tree a named run starts from: this process's own first, else the stopped round 2's.
function baseline(): Baseline | undefined {
	if (green.tree !== undefined) {
		return { tree: green.tree, why: MOVED_SINCE_GREEN, resumed_from: 'none' }
	}

	const tree = round_two_tree()

	return tree === undefined
		? undefined
		: { tree, why: MOVED_SINCE_ROUND_TWO, resumed_from: 'round-2-fix' }
}

// What moved since the last green tree on this base, with why that tree.
async function moved_since_green(
	checks: ReadonlyArray<SyncedCheck>,
	tree: GateTree,
): Promise<Moved | undefined> {
	const last = baseline()

	if (last?.tree.base === undefined || last.tree.base !== tree.base) return undefined

	const moved = file_map_stamp
		.changed_since({ taken_at: '', files: last.tree.files }, tree.files)
		.filter((file) => !run_record_path.is_run_record(file))
	const files = await nameable(checks, moved)

	return files === undefined ? undefined : { files, why: last.why, resumed_from: last.resumed_from }
}

function record(checks: ReadonlyArray<SyncedCheck>, tree: GateTree): void {
	for (const check of checks) scoped_green.record_green(check.stamp, tree)
}

// One phase a check, each over the named files; nothing named runs nothing.
function named_phases(
	checks: ReadonlyArray<SyncedCheck>,
	files: ReadonlyArray<string>,
): ReadonlyArray<() => Promise<JoshResult>> {
	if (files.length === 0) return []

	return checks.map(
		(check) => async () =>
			await josh_command.josh_run([check.script, ...files], {
				should_forward_stderr,
				environment: run_ship_lap.caller_environment(),
			}),
	)
}

// `detail` follows `why`: the files each check was handed, and what each condition named for a pair
// named after a merge.
function describe(files: ReadonlyArray<string>, why: string, detail = ''): string {
	return `scoped pair: narrowed to the ${String(files.length)} file(s) ${why}${detail}.`
}

const run_ship_narrowed = {
	describe,
	forget,
	moved_since_green,
	named_phases,
	nameable,
	record,
	remember,
}

export type { Moved, ResumedFrom }
export { run_ship_narrowed }
