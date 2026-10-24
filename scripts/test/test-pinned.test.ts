import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { test_pinned } from './test-pinned'
import { test_pinned_fixture } from './test-pinned-fixture'
import { test_pinned_logic } from './test-pinned-logic'

// Drives `josh test:pinned` against a real git repository (`test-pinned-fixture.ts`). The first hunk
// is pinned — reverting it turns its test red — and must not be listed; it comes first so that a revert
// left in place would turn the second hunk's run red too and hide it.

const RUN_TIMEOUT = 120_000
const INCOMING_FILE = 'incoming.js'
const MAIN = 'main'
const { CHANGED_DRIVER, DRIVER_FILE, build_base, build_change_branch, git, snapshot, write } =
	test_pinned_fixture

const fixture: { current?: FixtureWorkspace } = {}

beforeEach(() => {
	const workspace = git_fixture_workspace.open_workspace('test-pinned-')

	fixture.current = workspace
	process.chdir(workspace.workspace)
})

afterEach(async () => {
	if (fixture.current !== undefined) await git_fixture_workspace.close_workspace(fixture.current)
})

describe('test_pinned.run', () => {
	it(
		'lists the #4102-shaped hunk no test pins and not the pinned one, leaving the checkout untouched',
		async () => {
			await build_change_branch()
			const before = await snapshot()

			const report = await test_pinned.run(test_pinned_logic.DEFAULT_MAX_HUNKS)

			expect(report.unpinned).toEqual([
				expect.objectContaining({ file: DRIVER_FILE, new_start: 6 }),
			])
			expect(report.unpinned[0]?.is_green).toBe(true)
			expect(report.unchecked).toEqual([])
			expect(await snapshot()).toBe(before)
		},
		RUN_TIMEOUT,
	)

	it(
		'reports the hunks past the cap as unchecked without running them',
		async () => {
			await build_change_branch()

			const report = await test_pinned.run(1)

			expect(report.unpinned).toEqual([])
			expect(report.unchecked.map((hunk) => test_pinned_logic.location(hunk))).toEqual([
				`${DRIVER_FILE}:6`,
			])
		},
		RUN_TIMEOUT,
	)
})

// joshuafolkken/kit#4620's round 2: a new module's functions were reached only by a test that mocked
// the whole module, so no test ran their bodies. The tests here call `reach` directly and mock
// `stopped` away; the run must list `stopped` and not `reach`.
const REVIEWED_FILE = 'reviewed.js'
const REVIEWED_MODULE = `export function reach(issue) {
	return issue + 1
}

export const reviewed = {
	stopped(issue) {
		return issue > 0
	},
}
`
const MOCKED_TEST = `import { expect, it, vi } from 'vitest'
import { reach, reviewed } from './reviewed.js'

vi.mock('./reviewed.js', async (original) => ({
	...(await original()),
	reviewed: { stopped: vi.fn(() => true) },
}))

it('reaches the next issue', () => {
	expect(reach(1)).toBe(2)
})

it('reads the mocked stop', () => {
	expect(reviewed.stopped(1)).toBe(true)
})
`

async function build_added_module(): Promise<void> {
	await build_base()
	await git(['switch', '-c', 'change'])
	await write(REVIEWED_FILE, REVIEWED_MODULE)
	await write('reviewed.test.ts', MOCKED_TEST)
	await test_pinned_fixture.link_node_modules()
}

describe('test_pinned.run on an added file', () => {
	it(
		'lists the added function only a whole-module mock reaches, and not the one a test calls',
		async () => {
			await build_added_module()

			const report = await test_pinned.run(test_pinned_logic.DEFAULT_MAX_HUNKS)

			expect(report.unpinned.map((hunk) => test_pinned_logic.location(hunk))).toEqual([
				`${REVIEWED_FILE}:6 reviewed.stopped`,
			])
			expect(report.unpinned[0]?.is_green).toBe(true)
			expect(report.unparsed).toEqual([])
		},
		RUN_TIMEOUT,
	)
})

describe('test_pinned.run without vitest', () => {
	// No `node_modules` at all, so `typescript` is missing too and the comment hunk at line 1 is kept.
	it('reports every hunk unchecked rather than unpinned when no vitest is installed', async () => {
		await build_base()
		await git(['switch', '-c', 'change'])
		await write(DRIVER_FILE, CHANGED_DRIVER)

		const report = await test_pinned.run(test_pinned_logic.DEFAULT_MAX_HUNKS)

		expect(report.has_runner).toBe(false)
		expect(report.unpinned).toEqual([])
		expect(report.unchecked.map((hunk) => test_pinned_logic.location(hunk))).toEqual([
			`${DRIVER_FILE}:1`,
			`${DRIVER_FILE}:3`,
			`${DRIVER_FILE}:6`,
		])
	})
})

// A lane's `josh main:merge` that stopped on a conflict leaves the default branch's files in the work
// tree with `HEAD` still before the merge; what main brought in is not this branch's change.
async function merge_incoming(): Promise<void> {
	await build_change_branch()
	await git(['switch', MAIN])
	await write(INCOMING_FILE, 'export function incoming() {\n\treturn 1\n}\n')
	await git(['add', INCOMING_FILE])
	await git(['commit', '-m', 'incoming'])
	await git(['switch', 'change'])
	await git(['merge', '--no-commit', '--no-ff', MAIN])
}

describe('test_pinned.run while a merge of main is in progress', () => {
	it('probes only the branch change, not the files main brings in', async () => {
		await merge_incoming()

		const report = await test_pinned.run(0)

		expect(report.unchecked.map((hunk) => test_pinned_logic.location(hunk))).toEqual([
			`${DRIVER_FILE}:3`,
			`${DRIVER_FILE}:6`,
		])
	})

	// The worktree at `HEAD` predates the merge, so what main brought in is copied in with the branch
	// change: without it a changed file importing an incoming module fails every run and reads as pinned.
	it(
		'still lists an unpinned hunk of a file that imports a module main brings in',
		async () => {
			await merge_incoming()
			await write(DRIVER_FILE, `import { incoming } from './incoming.js'\n${CHANGED_DRIVER}`)

			const report = await test_pinned.run(test_pinned_logic.DEFAULT_MAX_HUNKS)

			expect(report.unpinned).toEqual(
				expect.arrayContaining([expect.objectContaining({ file: DRIVER_FILE, new_start: 7 })]),
			)
		},
		RUN_TIMEOUT,
	)
})

describe('test_pinned.run under a user diff config', () => {
	it('reads the hunks when diff.mnemonicPrefix renames the diff prefixes', async () => {
		await build_change_branch()
		await git(['config', 'diff.mnemonicPrefix', 'true'])

		const report = await test_pinned.run(0)

		expect(report.unchecked.map((hunk) => test_pinned_logic.location(hunk))).toEqual([
			`${DRIVER_FILE}:3`,
			`${DRIVER_FILE}:6`,
		])
	})
})
