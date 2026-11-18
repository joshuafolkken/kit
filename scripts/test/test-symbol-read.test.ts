import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { review_code_tree } from '#scripts/review/review-code-tree'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_pinned_fixture } from './test-pinned-fixture'
import { test_symbol_read } from './test-symbol-read'

// joshuafolkken/kit#7980: the work tree and the diff since the change base, read for the symbol walk.
const LIB = 'lib.ts'
const FILES: Readonly<Record<string, string>> = {
	'package.json': '{"type":"module"}',
	'.gitignore': 'node_modules\n',
	[LIB]: 'export function one() { return 1 }\nexport function two() { return 2 }\n',
	'one.test.ts': "import { one } from './lib'\nit('o', one)\n",
	'two.test.ts': "import { two } from './lib'\nit('t', two)\n",
}
const CHANGED_LIB = 'export function one() { return 1 }\nexport function two() { return 3 }\n'
const fixture: { current?: FixtureWorkspace } = {}

async function git(args: ReadonlyArray<string>): Promise<string> {
	return await git_fixture_workspace.git(process.cwd(), args)
}

function write(file: string, content: string): void {
	writeFileSync(path.join(process.cwd(), file), content)
}

async function base(): Promise<void> {
	await git(['init', '--initial-branch=main'])
	for (const [file, content] of Object.entries(FILES)) write(file, content)
	await git(['add', '.'])
	await git(['commit', '-m', 'base'])
	await git(['update-ref', 'refs/remotes/origin/main', 'HEAD'])
	await git(['switch', '-c', 'change'])
}

beforeEach(async () => {
	const workspace = git_fixture_workspace.open_workspace('symbol-read-')

	fixture.current = workspace
	process.chdir(workspace.workspace)
	await base()
	await test_pinned_fixture.link_node_modules()
	write(LIB, CHANGED_LIB)
})

afterEach(async () => {
	vi.restoreAllMocks()
	if (fixture.current !== undefined) await git_fixture_workspace.close_workspace(fixture.current)
})

describe('test_symbol_read.symbols', () => {
	it('selects the tests using the declarations the diff since the change base touched', async () => {
		expect(await test_symbol_read.symbols(process.cwd(), [LIB])).toEqual({
			tests: ['two.test.ts'],
			reach: [{ file: LIB, count: 1 }],
		})
	})

	it('reads nothing where typescript cannot be loaded', async () => {
		vi.spyOn(review_code_tree, 'load_typescript').mockReturnValue(undefined)

		expect(await test_symbol_read.symbols(process.cwd(), [LIB])).toBeUndefined()
	})
})
