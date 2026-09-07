import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { gate_skip } from '#scripts/gate-skip'
import { review_stamps } from '#scripts/review/review-stamps'
import { review_tree } from '#scripts/review/review-tree'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git_command } from './git-command'
import { git_fixture_workspace, type FixtureWorkspace } from './git-fixture-workspace'

// joshuafolkken/kit#1533, with real git rather than a mocked one.
//
// What broke is a property of `git diff --name-only`, not of any argument list this repository
// assembles: with rename detection on — git's default — a rename prints its destination and never
// its source. A mocked git cannot show that, because the mock would return whatever the test made it
// return. So this file builds the one topology that does: a branch that renames a file away, and the
// same branch after that file has come back.
//
// The consequence under test is `josh gate`'s reuse. Its green record is `base` plus a digest per
// changed path, and it only describes a tree because every path differing from `base` is supposed to
// be listed. Drop a rename's source and two materially different trees carry the same record — the
// gate then answers "passed" in a fifth of a second on a tree no check has read.

const TIMEOUT_MS = 30_000

const WORKSPACE_PREFIX = 'kit-rename-paths-'
const LANE_BRANCH = 'lane-under-test'
const PRIMARY = 'primary'

const MODULE_FILE = 'module.ts'
const RENAMED_FILE = 'renamed.ts'
const UNRELATED_FILE = 'unrelated.ts'
const MODULE_SOURCE = 'export const shared_value = 1\nexport const other_value = 2\n'

const { git, MAIN_BRANCH } = git_fixture_workspace

const fixture: FixtureWorkspace & { repository_root: string; stamp_path: string } = {
	workspace: '',
	repository_root: '',
	stamp_path: '',
	previous_cwd: '',
	restore_environment: undefined,
}

async function commit_all(message: string): Promise<void> {
	await git(fixture.repository_root, ['add', '--all'])
	await git(fixture.repository_root, ['commit', '--no-verify', '-m', message])
}

function in_repository(relative: string): string {
	return path.join(fixture.repository_root, relative)
}

// The base commit holds the module under its original name; the branch moves it. Committing the
// rename is what lets git pair the delete with the add, which is the state whose source path the
// default reading drops.
async function build_branch_that_renames(): Promise<void> {
	await writeFile(in_repository(MODULE_FILE), MODULE_SOURCE)
	await writeFile(in_repository(UNRELATED_FILE), 'export const untouched = 3\n')
	await commit_all('base')

	await git(fixture.repository_root, ['switch', '-c', LANE_BRANCH])
	await writeFile(in_repository(RENAMED_FILE), MODULE_SOURCE)
	await rm(in_repository(MODULE_FILE))
	await commit_all('rename the module')
}

beforeEach(async () => {
	const opened = git_fixture_workspace.open_workspace(WORKSPACE_PREFIX)

	fixture.workspace = opened.workspace
	fixture.previous_cwd = opened.previous_cwd
	fixture.restore_environment = opened.restore_environment
	fixture.repository_root = path.join(fixture.workspace, PRIMARY)
	fixture.stamp_path = path.join(fixture.workspace, 'gate-stamp.json')

	await git(fixture.workspace, ['init', MAIN_BRANCH, PRIMARY])
	await build_branch_that_renames()
	process.chdir(fixture.repository_root)
}, TIMEOUT_MS)

afterEach(async () => {
	await git_fixture_workspace.close_workspace(fixture)
})

describe('the changed-path listing across a rename', () => {
	it(
		'names the path the rename moved away from, not only the one it moved to',
		async () => {
			const output = await git_command.diff_main_names()
			const names = output.split('\n')

			expect(names).toContain(RENAMED_FILE)
			expect(names).toContain(MODULE_FILE)
			expect(names).not.toContain(UNRELATED_FILE)
		},
		TIMEOUT_MS,
	)

	// The staged reading is the other half of the same defect, and nothing else guards it: it feeds
	// `josh review:level --staged`, so a rename staged for commit would otherwise be classified from
	// its destination alone. Dropping the flag from one of the two readings has to fail a test.
	//
	// `reset --soft` puts the rename back into the index while `HEAD` returns to the base commit,
	// which is what a rename looks like in the moment before it is committed.
	it(
		'names both halves of a staged rename as well',
		async () => {
			await git(fixture.repository_root, ['reset', '--soft', 'HEAD~1'])

			const output = await git_command.diff_cached_names()
			const names = output.split('\n')

			expect(names).toContain(RENAMED_FILE)
			expect(names).toContain(MODULE_FILE)
		},
		TIMEOUT_MS,
	)
})

describe('a green gate record taken while a file was renamed away', () => {
	// The condition, named: the record was taken on a tree the module had *left*, and the tree it is
	// offered for is one the module has come *back* to — restored from the base commit, so it is
	// tracked and byte-identical to it. That is what makes it invisible from both directions: it
	// enters no diff against the base, and `git ls-files --others` does not list a tracked file. Both
	// trees therefore list `renamed.ts` at the same digest and nothing else, and the tree the gate
	// waves through is the one holding the module twice — which lint, the type check and the unit
	// suite would each have failed on.
	//
	// `git checkout <base> -- <path>` rather than a plain write: a written file would be untracked,
	// the untracked half of the reading would list it, and the record would be refused for a reason
	// that has nothing to do with the defect.
	it(
		'is refused once that file is back in the tree',
		async () => {
			const base = await git_command.change_base_commit()
			const recorded = await review_tree.read_changed_tree()

			review_stamps.gate_stamp.write(recorded, fixture.stamp_path, base)
			await git(fixture.repository_root, ['checkout', base, '--', MODULE_FILE])

			const restored = await review_tree.read_changed_tree()

			expect(gate_skip.reusable_green_gate(restored, base, fixture.stamp_path)).toBeUndefined()
		},
		TIMEOUT_MS,
	)

	// A second candidate cause for joshuafolkken/kit#1533, measured rather than assumed: this
	// repository's local `main` is a commit behind `origin/main` and nothing advances it, so
	// `change_base` anchors every reading on the stale ref. That widens the changed set — more files
	// are digested, never fewer — and it cannot survive the base moving, because the record names the
	// commit it was taken against and any other one is refused. This is what says so.
	it(
		'is refused when the base it names is not the base being asked about',
		async () => {
			const base = await git_command.change_base_commit()
			const tree = await review_tree.read_changed_tree()

			review_stamps.gate_stamp.write(tree, fixture.stamp_path, base)

			const other_base = await git_command.head_commit()

			expect(gate_skip.reusable_green_gate(tree, other_base, fixture.stamp_path)).toBeUndefined()
		},
		TIMEOUT_MS,
	)

	// The other half: the guard above must not be a refusal of everything. A record taken on this tree
	// and read back on the same tree is still reused, which is what joshuafolkken/kit#1328 bought.
	it(
		'is still reused while the tree has not moved',
		async () => {
			const base = await git_command.change_base_commit()
			const tree = await review_tree.read_changed_tree()

			review_stamps.gate_stamp.write(tree, fixture.stamp_path, base)

			expect(gate_skip.reusable_green_gate(tree, base, fixture.stamp_path)).toBeDefined()
		},
		TIMEOUT_MS,
	)
})
