import { symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { test_pinned } from './test-pinned'
import { test_pinned_logic } from './test-pinned-logic'

// Drives `josh test:pinned` against a real git repository, modelled on joshuafolkken/kit#4102's round 1:
// `run()` gained a driver-flag output beside `result.token`, and the tests only covered the default
// path, so reverting that hunk to `result.token` left every test green. The first hunk is pinned —
// reverting it turns its test red — and must not be listed; it comes first so that a revert left in
// place would turn the second hunk's run red too and hide it. A committed new module with no function
// adds no probe.

const RUN_TIMEOUT = 120_000
const DRIVER_FILE = 'driver.js'
const TEST_FILE = 'driver.test.ts'
const NODE_MODULES = 'node_modules'
const PROJECT_NODE_MODULES = path.resolve(NODE_MODULES)
const PORCELAIN = '--porcelain'

const ADDED_FILE = 'added.js'
const INCOMING_FILE = 'incoming.js'
const MAIN = 'main'
const BASE_DRIVER = `// A driver.
export function label(code) {
	return code === 0 ? 'ok' : 'busy'
}

export function token_of(result) {
	return result.token
}
`
const CHANGED_DRIVER = `// The driver, whose comment edit no test can pin and the run drops.
export function label(code) {
	return code === 0 ? 'merged' : 'busy'
}

export function token_of(result, argv) {
	return argv.includes('--driver') ? String(result.code) : result.token
}
`
const DEFAULT_PATH_TEST = `import { expect, it } from 'vitest'
import { label, token_of } from './driver.js'

it('labels a merge', () => {
	expect(label(0)).toBe('merged')
})

it('reads the token on the default path', () => {
	expect(token_of({ token: 't', code: 0 }, [])).toBe('t')
})
`

const fixture: { current?: FixtureWorkspace } = {}

async function git(arguments_: ReadonlyArray<string>): Promise<string> {
	return await git_fixture_workspace.git(process.cwd(), arguments_)
}

async function write(name: string, content: string): Promise<void> {
	await writeFile(path.join(process.cwd(), name), content)
}

// main carries the base driver; the `change` branch commits a new module no test reaches, and leaves
// the changed driver and its test uncommitted, so the run has to copy the working tree in.
async function build_base(): Promise<void> {
	await git(['init', git_fixture_workspace.MAIN_BRANCH])
	await write('package.json', '{ "type": "module" }\n')
	await write('.gitignore', `${NODE_MODULES}\n`)
	await write(DRIVER_FILE, BASE_DRIVER)
	await git(['add', '.'])
	await git(['commit', '-m', 'base'])
}

async function build_change_branch(): Promise<void> {
	await build_base()
	await git(['switch', '-c', 'change'])
	await write(ADDED_FILE, 'export const ADDED = 1\n')
	await git(['add', ADDED_FILE])
	await git(['commit', '-m', 'add'])
	await write(DRIVER_FILE, CHANGED_DRIVER)
	await write(TEST_FILE, DEFAULT_PATH_TEST)
	await symlink(PROJECT_NODE_MODULES, path.join(process.cwd(), NODE_MODULES), 'dir')
}

async function snapshot(): Promise<string> {
	const status = await git(['status', PORCELAIN])
	const trees = await git(['worktree', 'list', PORCELAIN])

	return `${status}\n${trees}`
}

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
	await symlink(PROJECT_NODE_MODULES, path.join(process.cwd(), NODE_MODULES), 'dir')
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
