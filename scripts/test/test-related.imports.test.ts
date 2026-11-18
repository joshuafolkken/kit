import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_pinned_fixture } from './test-pinned-fixture'
import { test_read_map } from './test-read-map'
import { related_scope, type RelatedScope } from './test-related-scope'
import { test_related_select } from './test-related-select'
import { test_unit_guard } from './test-unit-guard'
import { vitest_failure_summary } from './vitest-failure-summary'

// joshuafolkken/kit#7453: direct-only cap selection hid a newly introduced indirect import
// from a test whose filesystem mock omitted constants, until CI ran it.
const WIDE = 'wide.ts'
const STARTUP = 'startup.ts'
const INDIRECT_TEST = 'sync.test.ts'
const FILES: Readonly<Record<string, string>> = {
	'package.json': '{"type":"module"}',
	'.gitignore': 'node_modules\n',
	'tsconfig.json': '{"compilerOptions":{"module":"esnext","moduleResolution":"bundler"}}',
	'vitest.config.ts': 'export default { test: { include: ["*.test.ts"] } }',
	[WIDE]: 'export const value = 1\n',
	'entry.ts': "export { value } from './wide'\n",
	'wide.test.ts':
		"import { it, expect } from 'vitest'\nimport { value } from './wide'\nit('reads', () => expect(value).toBe(1))\n",
	[INDIRECT_TEST]:
		"import { it, expect, vi } from 'vitest'\nvi.mock('node:fs', () => ({ readFileSync: vi.fn() }))\nit('imports', async () => expect((await import('./entry')).value).toBe(1))\n",
}
const ADDED_STARTUP =
	"import { constants } from 'node:fs'\nexport const permission = constants.F_OK\n"
const CHANGED_WIDE = "import { permission } from './startup'\nexport const value = permission + 1\n"
const VITEST_FLAGS = ['--config', 'vitest.config.ts', '--maxWorkers=1']
const RUN_TIMEOUT = 120_000
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
	const workspace = git_fixture_workspace.open_workspace('related-imports-')

	fixture.current = workspace
	process.chdir(workspace.workspace)
	await base()
	await test_pinned_fixture.link_node_modules()
	write(WIDE, CHANGED_WIDE)
	write(STARTUP, ADDED_STARTUP)
	write(
		'startup.test.ts',
		"import { it, expect } from 'vitest'\nimport { permission } from './startup'\nit('reads', () => expect(permission).toBe(0))\n",
	)
})

afterEach(async () => {
	if (fixture.current !== undefined) await git_fixture_workspace.close_workspace(fixture.current)
})

// The scope as `josh test:related` hands it to vitest: resolved, then its test files selected over the
// real import graph (joshuafolkken/kit#7976).
async function selected(warm: boolean): Promise<RelatedScope> {
	const root = process.cwd()
	const changed = [WIDE, STARTUP]
	const scope = related_scope.resolve_scope({
		root,
		changed,
		recorded: new Set(),
		is_present: () => true,
		map: warm
			? {
					version: test_read_map.MAP_VERSION,
					commit: 'old-map',
					dirty: {},
					change: [],
					directories: [],
					readers: {},
				}
			: undefined,
	})
	const selection = await test_related_select.select(root, scope, changed)

	return test_related_select.scope_of(root, scope, selection)
}

describe('related selection after importing new startup code', () => {
	it.each([false, true])('keeps indirect importers with warm map %s', async (warm) => {
		const scope = await selected(warm)
		const tests = scope.mode === 'none' ? [] : (scope.tests ?? [])

		expect(tests).toContain(path.join(process.cwd(), INDIRECT_TEST))
		expect(tests).toContain(path.join(process.cwd(), 'wide.test.ts'))
	})

	it(
		'detects the actual indirect mock import failure before shipping',
		async () => {
			const scope = await selected(false)
			const report = vi.spyOn(vitest_failure_summary, 'report')
			const exit = await test_unit_guard.run_vitest_in(
				process.cwd(),
				related_scope.vitest_arguments(scope, VITEST_FLAGS),
			)

			expect(exit).not.toBe(0)
			expect(report).toHaveBeenCalledWith(
				expect.any(Array),
				expect.stringContaining('No "constants" export'),
				exit,
			)
		},
		RUN_TIMEOUT,
	)
})
