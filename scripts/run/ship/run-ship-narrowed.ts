import { existsSync } from 'node:fs'
import path from 'node:path'
import type { GateTree } from '#scripts/gate/gate-tree'
import { scoped_green } from '#scripts/gate/scoped-green'
import { verification_inputs } from '#scripts/gate/verification-inputs'
import { changed_file_scope } from '#scripts/git/changed-file-scope'
import { file_map_stamp } from '#scripts/josh/file-map-stamp'
import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { run_record_path } from '#scripts/josh/run-record-path'
import type { SyncedCheck } from './run-ship-synced-scope'

// **A scoped pair the ship can name the moved files of runs over them alone** (joshuafolkken/kit#5531).
// A pair whose records could not narrow re-ran over the whole branch's related set — 6 to 18 minutes
// a stage — after a review fix of one file, or a main merge meeting the branch in one.
//
// **The check is no weaker.** Each named run starts from a tree the pair was green on over the whole
// branch: the tree this ship last met the pair green on, on the same base (a review round's fix), or the
// pre-merge tree a sync-only record vouches for (`run-ship-synced-scope.ts`, the files where the merge
// meets the branch). What can differ from it is the named files' reach, which the explicit run reads
// (`josh test:related <file>...`), so green there records each check green on this tree as a bare run
// would. **Whatever cannot be named runs the pair as before**: a moved file that configures a check,
// one no longer on disk — its importers are unreachable by name — or no green tree on this base.

const should_forward_stderr = true

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

// What moved since the last green tree on this base.
async function moved_since_green(
	checks: ReadonlyArray<SyncedCheck>,
	tree: GateTree,
): Promise<ReadonlyArray<string> | undefined> {
	const last = green.tree

	if (last?.base === undefined || last.base !== tree.base) return undefined

	const moved = file_map_stamp
		.changed_since({ taken_at: '', files: last.files }, tree.files)
		.filter((file) => !run_record_path.is_run_record(file))

	return await nameable(checks, moved)
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
			await josh_command.josh_run([check.script, ...files], should_forward_stderr),
	)
}

function describe(files: ReadonlyArray<string>, why: string): string {
	return `scoped pair: narrowed to the ${String(files.length)} file(s) ${why}.`
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

export { run_ship_narrowed }
