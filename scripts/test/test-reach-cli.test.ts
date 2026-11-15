import { mkdir, writeFile } from 'node:fs/promises'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { measure_declaration } from '#scripts/issue/measure-declaration'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_pinned_reach } from './test-pinned-reach'
import { test_reach_cli } from './test-reach-cli'

// joshuafolkken/kit#5238: `josh test:reach <file...>` prints each file's reached test count, the value
// `reached_test_count` gives that file alone, so a filing measures it without a hand-written probe.

const RUN_TIMEOUT = 60_000
const FAILURE = 1
const TSCONFIG_CONTENT =
	'{ "compilerOptions": { "allowJs": true, "moduleResolution": "bundler", "module": "esnext" } }\n'
const TEST_BODY = "import { it } from 'vitest'\n\nit('runs', () => {})\n"
const LEAF_BODY = 'export const leaf = 1\n'
// `leaf.ts` is reached by its own test and, through `middle.ts`, by the middle test.
const FILES: ReadonlyArray<readonly [string, string]> = [
	['leaf.ts', LEAF_BODY],
	['middle.ts', "export { leaf } from './leaf'\n"],
	['leaf.test.ts', `import './leaf'\n${TEST_BODY}`],
	['middle.test.ts', `import './middle'\n${TEST_BODY}`],
]

// No file, and `--count` with other than one file.
const USAGE_CASES: ReadonlyArray<{ argv: ReadonlyArray<string> }> = [
	{ argv: [] },
	{ argv: ['--count'] },
	{ argv: ['--count', 'leaf.ts', 'middle.ts'] },
]

const fixture: { current?: FixtureWorkspace } = {}

beforeEach(async () => {
	const workspace = git_fixture_workspace.open_workspace('test-reach-cli-')

	fixture.current = workspace
	process.chdir(workspace.workspace)
	await git_fixture_workspace.git(workspace.workspace, ['init', git_fixture_workspace.MAIN_BRANCH])
	vi.spyOn(console, 'error').mockReturnValue(undefined)
	vi.spyOn(console, 'info').mockReturnValue(undefined)
})

afterEach(async () => {
	vi.restoreAllMocks()
	if (fixture.current !== undefined) await git_fixture_workspace.close_workspace(fixture.current)
})

async function write_graph(): Promise<void> {
	await writeFile('tsconfig.json', TSCONFIG_CONTENT)
	await Promise.all(
		FILES.map(async ([file, content]) => {
			await writeFile(file, content)
		}),
	)
}

describe('test_reach_cli.run', () => {
	it(
		"prints each file's reached test count, the one reached_test_count gives it alone",
		async () => {
			await write_graph()

			expect(await test_reach_cli.run(['leaf.ts', 'middle.ts'])).toBe(0)
			expect(console.info).toHaveBeenCalledWith('2 leaf.ts\n1 middle.ts')
			expect(await test_pinned_reach.reached_test_count(['leaf.ts'])).toBe(2)
			expect(await test_pinned_reach.reached_test_count(['middle.ts'])).toBe(1)
		},
		RUN_TIMEOUT,
	)

	it.each([
		{ name: 'a path no file answers', path: 'lane/leaf.ts' },
		{ name: 'a directory', path: 'lane' },
	])('refuses $name rather than printing a 0 count', async ({ path }) => {
		await write_graph()
		await mkdir('lane')

		expect(await test_reach_cli.run(['middle.ts', path])).toBe(FAILURE)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('no such file'))
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining(path))
		expect(console.info).not.toHaveBeenCalled()
	})

	it('refuses where no import graph can be built', async () => {
		await writeFile('leaf.ts', LEAF_BODY)

		expect(await test_reach_cli.run(['leaf.ts'])).toBe(FAILURE)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('no import graph'))
	})

	it.each(USAGE_CASES)('prints the usage for $argv', async ({ argv }) => {
		expect(await test_reach_cli.run(argv)).toBe(FAILURE)
		expect(console.error).toHaveBeenCalledWith(test_reach_cli.USAGE)
	})
})

// joshuafolkken/kit#7604: a premise line reads the last output line as a number, so `--count`
// prints the count alone.
describe('test_reach_cli.run --count', () => {
	it(
		'prints the count alone, which a premise line reads as a number',
		async () => {
			await write_graph()

			expect(await test_reach_cli.run(['--count', 'leaf.ts'])).toBe(0)
			expect(console.info).toHaveBeenCalledWith('2')

			const output = vi.mocked(console.info).mock.calls.at(0)?.at(0)
			const premise = { command: 'pnpm josh test:reach --count leaf.ts', operator: '>=' } as const

			expect(measure_declaration.judge({ ...premise, threshold: 2 }, String(output))).toStrictEqual(
				{ kind: 'pass', value: 2 },
			)
		},
		RUN_TIMEOUT,
	)
})
