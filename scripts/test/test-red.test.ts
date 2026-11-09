import { existsSync } from 'node:fs'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { BaseTree } from '#scripts/git/base-tree'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_red } from './test-red'

// Drives `josh test:red` against a real git repository, modelled on joshuafolkken/kit#2308 →
// joshuafolkken/kit#2393: `run:report` emitted the whole event stream instead of the invocation's
// events. A test at the grain the user saw (the whole output) is red on the pre-fix tree; a test that
// only checks the helper exists stays green there, which is the gap the command closes.

const RUN_TIMEOUT = 60_000

const BUGGY_REPORT =
	'export function report(events, invocation) {\n\treturn events.map((event) => event.name)\n}\n'
const FIXED_REPORT =
	'export function report(events, invocation) {\n' +
	'\treturn events.filter((event) => event.invocation === invocation).map((event) => event.name)\n}\n'

const TEST_IMPORTS = "import { expect, it } from 'vitest'\nimport { report } from './report.js'\n"
const REPORT_FILE = 'report.js'
const TEST_FILE = 'report.test.ts'
const NESTED_DIRECTORY = 'nested'
const NESTED_TEST_FILE = `${NESTED_DIRECTORY}/report.test.ts`
const NODE_MODULES = 'node_modules'
const PROJECT_NODE_MODULES = path.resolve(NODE_MODULES)
const PACKAGE_FILE = 'package.json'
const MODULE_PACKAGE = '{ "type": "module" }\n'

const PORCELAIN = '--porcelain'
const CONFLICT_FILE = 'conflict.txt'
const VITEST_CONFIG_FILE = 'vitest.config.js'
const EXCLUDING_CONFIG = `export default { test: { exclude: ['**/${TEST_FILE}'] } }\n`
const OUTPUT_FILE_CONFIG = `export default { test: { outputFile: 'results.json' } }\n`

const WHOLE_OUTPUT_TEST = `${TEST_IMPORTS}it('reports only the invocation', () => {
	const events = [{ name: 'old', invocation: 1 }, { name: 'new', invocation: 2 }]
	expect(report(events, 2)).toEqual(['new'])
})
`
const SHALLOW_TEST = `${TEST_IMPORTS}it('exports report', () => {
	expect(typeof report).toBe('function')
})
`

// joshuafolkken/kit#4770: the tree's run names a Vite cache of its own, outside the borrowed
// `node_modules`, so it never re-bundles the dependencies a gate beside it is importing.
const OWN_CACHE_TEST = `import { expect, it } from 'vitest'
it('runs on a cache of its own', () => {
	const directory = process.env.JOSH_VITEST_CACHE_DIR ?? ''
	expect(directory).not.toBe('')
	expect(directory).not.toContain('node_modules')
})
`

const fixture: { current?: FixtureWorkspace } = {}

async function git(arguments_: ReadonlyArray<string>): Promise<string> {
	return await git_fixture_workspace.git(process.cwd(), arguments_)
}

async function write(name: string, content: string): Promise<void> {
	await writeFile(path.join(process.cwd(), name), content)
}

async function write_base(vitest_config: string | undefined): Promise<void> {
	await write(PACKAGE_FILE, MODULE_PACKAGE)
	if (vitest_config !== undefined) await write(VITEST_CONFIG_FILE, vitest_config)
	await write('.gitignore', `${NODE_MODULES}\n`)
	await write(REPORT_FILE, BUGGY_REPORT)
}

// main carries the buggy report (and `vitest_config`, when given); the `fix` branch fixes it and adds
// `test_body`, when given, as the regression test.
async function build_fix_branch(
	test_body: string | undefined,
	vitest_config?: string,
): Promise<void> {
	await git(['init', git_fixture_workspace.MAIN_BRANCH])
	await write_base(vitest_config)
	await git(['add', '.'])
	await git(['commit', '-m', 'base'])
	await git(['switch', '-c', 'fix'])
	await write(REPORT_FILE, FIXED_REPORT)
	if (test_body !== undefined) await write(TEST_FILE, test_body)
	await symlink(PROJECT_NODE_MODULES, path.join(process.cwd(), NODE_MODULES), 'dir')
}

// main carries the buggy report and a shallow test; the `fix` branch changes only the test, so the
// merge-base runs the same code as HEAD and its result says nothing (joshuafolkken/kit#3214).
async function build_test_only_branch(): Promise<void> {
	await git(['init', git_fixture_workspace.MAIN_BRANCH])
	await write_base(undefined)
	await write(TEST_FILE, SHALLOW_TEST)
	await git(['add', '.'])
	await git(['commit', '-m', 'base'])
	await git(['switch', '-c', 'fix'])
	await write(TEST_FILE, WHOLE_OUTPUT_TEST)
}

async function snapshot(): Promise<string> {
	const status = await git(['status', PORCELAIN])
	const head = await git(['rev-parse', 'HEAD'])
	const trees = await git(['worktree', 'list', PORCELAIN])

	return `${head}\n${status}\n${trees}`
}

beforeEach(() => {
	const workspace = git_fixture_workspace.open_workspace('test-red-')

	fixture.current = workspace
	process.chdir(workspace.workspace)
})

afterEach(async () => {
	if (fixture.current !== undefined) await git_fixture_workspace.close_workspace(fixture.current)
})

describe('test_red.run', () => {
	// joshuafolkken/kit#3047: the changed tests are copied into the tree together, nested ones
	// included. One run answers both, so the whole-output fixture carries the nested copy as well.
	it(
		'is red when the regression test checks the whole output the user saw, nested copies included',
		async () => {
			await build_fix_branch(WHOLE_OUTPUT_TEST)
			await mkdir(path.join(process.cwd(), NESTED_DIRECTORY))
			await write(NESTED_TEST_FILE, WHOLE_OUTPUT_TEST.replace('./report.js', '../report.js'))

			const { verdict, files } = await test_red.run()

			expect(verdict).toBe('red')
			expect(files).toHaveLength(2)
			expect(files).toEqual(expect.arrayContaining([TEST_FILE, NESTED_TEST_FILE]))
		},
		RUN_TIMEOUT,
	)

	it(
		'is still red when the merge-base config names its own outputFile',
		async () => {
			await build_fix_branch(WHOLE_OUTPUT_TEST, OUTPUT_FILE_CONFIG)

			expect(await test_red.run()).toEqual({ verdict: 'red', files: [TEST_FILE] })
		},
		RUN_TIMEOUT,
	)

	it(
		'is green when the test does not reproduce the symptom, leaving the tree and index untouched',
		async () => {
			await build_fix_branch(SHALLOW_TEST)
			const before = await snapshot()

			const { verdict } = await test_red.run()

			expect(verdict).toBe('green')
			expect(await snapshot()).toBe(before)
		},
		RUN_TIMEOUT,
	)
})

describe('test_red.run beside a gate', () => {
	it(
		'runs the tree on a Vite cache outside the borrowed node_modules',
		async () => {
			await build_fix_branch(OWN_CACHE_TEST)

			expect(await test_red.run()).toEqual({ verdict: 'green', files: [TEST_FILE] })
		},
		RUN_TIMEOUT,
	)
})

describe('test_red.run when nothing runs', () => {
	it(
		'is no-test when the merge-base config excludes the changed test, so nothing ran',
		async () => {
			await build_fix_branch(SHALLOW_TEST, EXCLUDING_CONFIG)

			expect(await test_red.run()).toEqual({ verdict: 'no-test', files: [TEST_FILE] })
		},
		RUN_TIMEOUT,
	)

	it(
		'is test-only without a run when no runtime file changed beside the test',
		async () => {
			await build_test_only_branch()
			const before = await snapshot()

			expect(await test_red.run()).toEqual({ verdict: 'test-only', files: [TEST_FILE] })
			expect(await snapshot()).toBe(before)
		},
		RUN_TIMEOUT,
	)

	it(
		'is no-test when no Vitest file changed',
		async () => {
			await build_fix_branch(undefined)

			const { verdict } = await test_red.run()

			expect(verdict).toBe('no-test')
		},
		RUN_TIMEOUT,
	)
})

// joshuafolkken/kit#6814: a test file spinning in a fork worker never lets vitest write its report,
// so the probe's own timeout kills the run and names the file instead of leaving it to the harness cap.
// Room for vitest to start and finish the passing file on a loaded machine, still inside `SPIN_MS`.
const PROBE_TIMEOUT = 15_000
const SPIN_FILE = 'spins.test.ts'
const PROGRESS_FILE = 'progress.log'
const PASS_FILE = 'passes.test.ts'
// The spin outlasts the probe's timeout but ends well inside the test's own, so a tree whose probe
// cannot kill it (the pre-fix tree test:red runs, a hunk test:pinned reverts) leaves no worker behind.
const SPIN_MS = 20_000
const SPIN_TEST = `import { it } from 'vitest'\nit('spins', () => {\n\tconst end = Date.now() + ${String(SPIN_MS)}\n\twhile (Date.now() < end) {}\n})\n`
const PASS_TEST =
	"import { expect, it } from 'vitest'\nit('passes', () => {\n\texpect(1).toBe(1)\n})\n"

async function probe_tree(): Promise<BaseTree> {
	const tree = path.join(process.cwd(), 'tree')

	await mkdir(tree)
	await writeFile(path.join(tree, PACKAGE_FILE), MODULE_PACKAGE)
	await writeFile(path.join(tree, SPIN_FILE), SPIN_TEST)
	await writeFile(path.join(tree, PASS_FILE), PASS_TEST)
	await symlink(PROJECT_NODE_MODULES, path.join(tree, NODE_MODULES), 'dir')

	return { parent: process.cwd(), tree }
}

// The run's own reporter writes the progress file once vitest has started, so the probe is live.
async function until_started(base: BaseTree): Promise<void> {
	await vi.waitFor(
		() => {
			expect(existsSync(path.join(base.parent, PROGRESS_FILE))).toBe(true)
		},
		{ timeout: PROBE_TIMEOUT },
	)
}

// A detached probe sits outside the group `run:review --join` signals, so the exit handler that runs
// `stop_live_probes` is what stops it.
describe('test_red.probe_in when the process that started it exits', () => {
	it(
		'kills the running probe, which reads stopped',
		async () => {
			const base = await probe_tree()
			const probe = test_red.probe_in(base, ['run', SPIN_FILE], RUN_TIMEOUT)

			await until_started(base)
			test_red.stop_live_probes()
			const { verdict } = await probe

			expect(verdict).toBe('stopped')
		},
		RUN_TIMEOUT,
	)
})

describe('test_red.probe_in with a timeout', () => {
	it(
		'kills a run past its timeout and fails naming the test file still running',
		async () => {
			const base = await probe_tree()
			const probe = test_red.probe_in(base, ['run', SPIN_FILE, PASS_FILE], PROBE_TIMEOUT)

			await expect(probe).rejects.toThrow(new RegExp(`still running: ${SPIN_FILE}$`, 'u'))
		},
		RUN_TIMEOUT,
	)

	it(
		'reads a run that ends inside its timeout as before',
		async () => {
			const base = await probe_tree()

			expect(await test_red.probe_in(base, ['run', PASS_FILE], PROBE_TIMEOUT)).toEqual({
				verdict: 'green',
				failed: [],
				ran: 1,
			})
		},
		RUN_TIMEOUT,
	)
})

// joshuafolkken/kit#5307: the changed paths are read through a merge in progress, so the pre-fix run
// is too — here main already carries the fix, so the tree's base holds it and the test is not red.
async function commit_all(message: string): Promise<void> {
	await git(['add', '.'])
	await git(['commit', '-m', message])
}

async function stop_a_merge_of_the_fix(): Promise<void> {
	await build_fix_branch(WHOLE_OUTPUT_TEST)
	await write(CONFLICT_FILE, 'fix\n')
	await commit_all('fix')
	await git(['switch', 'main'])
	await write(REPORT_FILE, FIXED_REPORT)
	await write(CONFLICT_FILE, 'main\n')
	await commit_all('main')
	await git(['switch', 'fix'])
	await expect(git(['merge', 'main'])).rejects.toThrow()
}

describe('test_red.run during a merge stopped on a conflict', () => {
	it(
		'runs the changed test against the tree’s base, which already holds main’s fix',
		async () => {
			await stop_a_merge_of_the_fix()

			expect(await test_red.run()).toEqual({ verdict: 'green', files: [TEST_FILE] })
		},
		RUN_TIMEOUT,
	)
})
