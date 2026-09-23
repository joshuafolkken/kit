import { symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
const NODE_MODULES = 'node_modules'
const PROJECT_NODE_MODULES = path.resolve(NODE_MODULES)

const PORCELAIN = '--porcelain'
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

const fixture: { current?: FixtureWorkspace } = {}

async function git(arguments_: ReadonlyArray<string>): Promise<string> {
	return await git_fixture_workspace.git(process.cwd(), arguments_)
}

async function write(name: string, content: string): Promise<void> {
	await writeFile(path.join(process.cwd(), name), content)
}

async function write_base(vitest_config: string | undefined): Promise<void> {
	await write('package.json', '{ "type": "module" }\n')
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
	it(
		'is red when the regression test checks the whole output the user saw',
		async () => {
			await build_fix_branch(WHOLE_OUTPUT_TEST)

			expect(await test_red.run()).toEqual({ verdict: 'red', files: [TEST_FILE] })
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
		'is no-test when no Vitest file changed',
		async () => {
			await build_fix_branch(undefined)

			const { verdict } = await test_red.run()

			expect(verdict).toBe('no-test')
		},
		RUN_TIMEOUT,
	)
})
