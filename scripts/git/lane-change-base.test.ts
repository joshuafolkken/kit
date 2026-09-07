import { mkdtempSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git_command } from './git-command'

// joshuafolkken/kit#1527, with real git rather than a mocked one.
//
// A mocked test can only pin which arguments the reading passes; what actually broke is a property
// of git in a **linked work tree** — the `main` ref is shared across every work tree of the
// repository, so one lane merging changes what an unmerged lane's two-dot `git diff main` reports.
// Nothing short of building that topology demonstrates the fix, so this file builds it: a primary
// work tree, a lane cut from it, and a commit landing on `main` afterwards.

const TIMEOUT_MS = 30_000
const LANE_FILE = 'lane-change.txt'
const OTHER_LANE_FILE = 'other-lane-merged.txt'
const LANE_EDIT = 'edited by this lane\n'

const fixture = { workspace: '', repository_root: '', lane_root: '', previous_cwd: '' }

async function git(cwd: string, arguments_: Array<string>): Promise<string> {
	const { stdout } = await execa('git', arguments_, { cwd })

	return stdout.trimEnd()
}

async function commit_all(cwd: string, message: string): Promise<void> {
	await git(cwd, ['add', '--all'])
	await git(cwd, ['commit', '--no-verify', '-m', message])
}

async function build_repository(): Promise<void> {
	await git(fixture.repository_root, ['config', 'user.email', 'lane@example.test'])
	await git(fixture.repository_root, ['config', 'user.name', 'Lane Fixture'])
	await git(fixture.repository_root, ['config', 'commit.gpgsign', 'false'])
	await writeFile(path.join(fixture.repository_root, LANE_FILE), 'base\n')
	await commit_all(fixture.repository_root, 'base')
}

// The lane is cut first, and only afterwards does another lane's work land on the shared `main`.
async function advance_main_after_cutting_the_lane(): Promise<void> {
	const add_worktree = ['worktree', 'add', '-b', 'lane-under-test', fixture.lane_root]

	await git(fixture.repository_root, add_worktree)
	await writeFile(
		path.join(fixture.repository_root, OTHER_LANE_FILE),
		'merged by a different lane\n',
	)
	await commit_all(fixture.repository_root, 'another lane merged')
}

beforeEach(async () => {
	fixture.previous_cwd = process.cwd()
	fixture.workspace = mkdtempSync(path.join(tmpdir(), 'kit-lane-base-'))
	fixture.repository_root = path.join(fixture.workspace, 'primary')
	fixture.lane_root = path.join(fixture.workspace, 'lane')

	await git(fixture.workspace, ['init', '--initial-branch=main', 'primary'])
	await build_repository()
	await advance_main_after_cutting_the_lane()
}, TIMEOUT_MS)

afterEach(async () => {
	process.chdir(fixture.previous_cwd)
	await rm(fixture.workspace, { force: true, recursive: true })
})

describe('a lane reads its own changes while the shared default branch advances', () => {
	it(
		'leaves a file merged by another lane out of the listing while the work is uncommitted',
		async () => {
			await writeFile(path.join(fixture.lane_root, LANE_FILE), LANE_EDIT)
			process.chdir(fixture.lane_root)

			const names = await git_command.diff_main_names()

			expect(names.split('\n')).toStrictEqual([LANE_FILE])
			expect(names).not.toContain(OTHER_LANE_FILE)
		},
		TIMEOUT_MS,
	)

	// A lane works uncommitted for most of a run and committed for the rest of it, so the base has to
	// be right at both points: once `HEAD` moves ahead, the merge base has to stay where it was.
	it(
		'still reports only the change this branch made once the lane has committed',
		async () => {
			await writeFile(path.join(fixture.lane_root, LANE_FILE), LANE_EDIT)
			await commit_all(fixture.lane_root, 'lane work')
			process.chdir(fixture.lane_root)

			await expect(git_command.diff_main_names()).resolves.toBe(LANE_FILE)
		},
		TIMEOUT_MS,
	)
})

describe('the gate stamp base across the same advance', () => {
	// Nothing this lane's checks read has changed, so a green record taken before another lane's
	// merge still covers this tree — and it only does if the base it names has not moved.
	it(
		'holds still across a merge made by another lane',
		async () => {
			process.chdir(fixture.lane_root)
			const before = await git_command.change_base_commit()

			await writeFile(path.join(fixture.repository_root, 'third.txt'), 'a third lane\n')
			await commit_all(fixture.repository_root, 'a third lane merged')

			await expect(git_command.change_base_commit()).resolves.toBe(before)
		},
		TIMEOUT_MS,
	)

	// The primary work tree is the case that must not change: sitting on the default branch, the
	// merge base *is* that branch's commit, so the reading is exactly what it always was.
	it(
		'reads the same as before in a checkout sitting on the default branch',
		async () => {
			await writeFile(path.join(fixture.repository_root, LANE_FILE), 'edited on main\n')
			process.chdir(fixture.repository_root)

			await expect(git_command.diff_main_names()).resolves.toBe(LANE_FILE)
		},
		TIMEOUT_MS,
	)
})
