import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { review_diff_parts, type DiffParts } from './review-diff-parts'
import { review_diff_write } from './review-diff-write'

// joshuafolkken/kit#2963, driven through real git: the parts written for a change must cover every
// path `review:brief` reads as changed — tracked edits and untracked files alike — each part under
// the cap, and each path's parts exactly what the reviewer would otherwise have read in one print.

const TIMEOUT_MS = 30_000
const CAP = 300
const EDITED = 'edited.ts'
const ADDED = 'added.ts'
const LINE_COUNT = 60
const { git, MAIN_BRANCH } = git_fixture_workspace

const fixture: FixtureWorkspace & { root: string; base: string } = {
	previous_cwd: '',
	restore_environment: undefined,
	workspace: '',
	root: '',
	base: '',
}

function lines(label: string): string {
	return Array.from({ length: LINE_COUNT }, (_, index) => `${label} ${String(index)}\n`).join('')
}

async function build_change(root: string): Promise<string> {
	await git(fixture.workspace, ['init', MAIN_BRANCH, 'repo'])
	writeFileSync(path.join(root, EDITED), lines('old'))
	await git(root, ['add', '--all'])
	await git(root, ['commit', '-m', 'base'])
	writeFileSync(path.join(root, EDITED), lines('new'))
	// Staged, so a diff read against the index rather than the base would come back empty.
	await git(root, ['add', EDITED])
	writeFileSync(path.join(root, ADDED), lines('added'))

	return await git(root, ['rev-parse', 'HEAD'])
}

async function write_change_parts(): Promise<DiffParts> {
	const directory = path.join(fixture.workspace, 'parts')

	mkdirSync(directory)
	const paths = await changed_paths.read_changed_paths(false)

	return await review_diff_write.write_parts(
		{ root: fixture.root, base: fixture.base, paths, cap: CAP },
		directory,
	)
}

function body(files: ReadonlyArray<string> | undefined): string {
	return (files ?? []).map((file) => review_diff_parts.body_of(readFileSync(file, 'utf8'))).join('')
}

beforeEach(async () => {
	Object.assign(fixture, git_fixture_workspace.open_workspace('review-diff-write-'))
	const root = path.join(fixture.workspace, 'repo')
	const base = await build_change(root)

	Object.assign(fixture, { root, base })
	process.chdir(root)
}, TIMEOUT_MS)

afterEach(async () => {
	await git_fixture_workspace.close_workspace(fixture)
}, TIMEOUT_MS)

describe('review_diff_write.write_parts — the whole change, under the cap', () => {
	it('writes parts for every changed path, tracked and untracked', async () => {
		const parts = await write_change_parts()

		expect(Object.keys(parts).toSorted((left, right) => left.localeCompare(right))).toStrictEqual([
			ADDED,
			EDITED,
		])
	})

	it('keeps every part file within the cap', async () => {
		const parts = await write_change_parts()

		for (const file of Object.values(parts).flat()) {
			expect(readFileSync(file, 'utf8').length).toBeLessThanOrEqual(CAP)
		}
	})

	it("joins a tracked path's parts back to its whole diff", async () => {
		const parts = await write_change_parts()
		const diff = await review_diff_write.path_diff(fixture.root, fixture.base, EDITED)

		expect(body(parts[EDITED])).toBe(diff)
	})

	it('reads a tracked path against the base, staged edits included', async () => {
		const parts = await write_change_parts()
		const edited = body(parts[EDITED])

		expect(edited).toContain('-old 0')
		expect(edited).toContain('+new 0')
	})

	it("carries an untracked file's whole content", async () => {
		const parts = await write_change_parts()

		expect(body(parts[ADDED])).toContain(lines('added'))
	})
})
