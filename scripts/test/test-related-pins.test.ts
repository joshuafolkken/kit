import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { direct_importers } from './direct-importers'
import { test_pinned_logic } from './test-pinned-logic'
import type { ReachedTests } from './test-pinned-reach'
import { test_related_pins } from './test-related-pins'
import type { RelatedScope } from './test-related-scope'
import { test_related_select } from './test-related-select'

// joshuafolkken/kit#5642: a change to the josh command registry always runs the registry tests, even when
// the cap cuts its reach (joshuafolkken/kit#7976).

const { REGISTRY_TESTS } = test_related_pins
const { MAX_TEST_FILES } = test_pinned_logic
const OUTER_TESTS = Array.from(
	{ length: MAX_TEST_FILES },
	(_, index) => `scripts/outer/outer-${String(index).padStart(3, '0')}.test.ts`,
)
const COMMAND_TABLE = 'scripts/josh/josh-commands-development.ts'
const COMMAND_TABLE_TEST = 'scripts/josh/josh-commands-development.test.ts'
const PACKAGE_FILE = 'package.json'
const FIXTURE_FILES: Readonly<Record<string, string>> = {
	[PACKAGE_FILE]: JSON.stringify({ imports: {} }),
	[COMMAND_TABLE]: 'export const commands = 1\n',
	[COMMAND_TABLE_TEST]: "import { commands } from './josh-commands-development'\n",
	...Object.fromEntries([...REGISTRY_TESTS, ...OUTER_TESTS].map((test) => [test, ''])),
}

async function open_fixture(): Promise<FixtureWorkspace> {
	const fixture = git_fixture_workspace.open_workspace('test-related-pins-')

	await git_fixture_workspace.git(fixture.workspace, ['init', '--quiet', '--initial-branch=main'])

	for (const [file, content] of Object.entries(FIXTURE_FILES)) {
		mkdirSync(path.dirname(path.join(fixture.workspace, file)), { recursive: true })
		writeFileSync(path.join(fixture.workspace, file), content)
	}

	await git_fixture_workspace.git(fixture.workspace, ['add', '.'])
	await git_fixture_workspace.git(fixture.workspace, ['commit', '-m', 'base'])
	await git_fixture_workspace.git(fixture.workspace, ['switch', '-c', 'change'])

	return fixture
}

// Each file reaching the cap's worth of outer tests, absolute under `root`.
function past_the_cap(
	root: string,
): (files: ReadonlyArray<string>) => Promise<Array<ReachedTests>> {
	const tests = OUTER_TESTS.map((test) => path.join(root, test))

	return async (files) => files.map((file) => ({ file, tests }))
}

describe('test_related_pins.is_registry_source', () => {
	it.each([COMMAND_TABLE, 'scripts/josh/josh-aliases.ts', 'scripts/josh/josh-command-map.ts'])(
		'pins the registry tests to %s',
		(file) => {
			expect(test_related_pins.is_registry_source(file)).toBe(true)
		},
	)

	it.each([COMMAND_TABLE_TEST, 'scripts/josh/josh-logic.ts', 'scripts/test/josh-aliases.ts'])(
		'pins nothing to %s',
		(file) => {
			expect(test_related_pins.is_registry_source(file)).toBe(false)
		},
	)
})

describe('test_related_pins.REGISTRY_TESTS', () => {
	it.each(REGISTRY_TESTS)('names %s, a test file on disk', (file) => {
		expect(existsSync(path.resolve(file))).toBe(true)
	})
})

describe('test_related_pins.pinned_tests', () => {
	it('pins the registry tests once to a change touching two command tables', () => {
		const changed = [COMMAND_TABLE, 'scripts/josh/josh-commands-ai.ts']

		expect(test_related_pins.pinned_tests(changed)).toEqual(REGISTRY_TESTS)
	})

	it('pins the in-process main-guard test to a change adding a command to a table', () => {
		expect(test_related_pins.pinned_tests([COMMAND_TABLE])).toContain(
			'scripts/josh/josh-in-process.test.ts',
		)
	})

	it('pins nothing to a change outside the registry', () => {
		expect(test_related_pins.pinned_tests(['scripts/test/test-related.ts'])).toEqual([])
	})
})

describe('test_related_select.select with a registry file reaching past the cap', () => {
	let fixture: FixtureWorkspace

	beforeEach(async () => {
		fixture = await open_fixture()
		process.chdir(fixture.workspace)
	})

	afterEach(async () => {
		await git_fixture_workspace.close_workspace(fixture)
	})

	it('runs the direct importers and the pinned registry tests before the outer reach', async () => {
		const root = fixture.workspace
		const scope: RelatedScope = {
			mode: 'related',
			files: [path.join(root, COMMAND_TABLE)],
			reason: '',
		}
		const selection = await test_related_select.select(root, scope, [COMMAND_TABLE], {
			reach: past_the_cap(root),
			importers: direct_importers.importers_of,
			all_tests: async () => [],
		})

		const [logic, command_map, in_process] = REGISTRY_TESTS

		expect(selection.tests.slice(0, 1 + REGISTRY_TESTS.length)).toEqual([
			command_map,
			COMMAND_TABLE_TEST,
			in_process,
			logic,
		])
		expect(selection.deferred).toBe(1 + REGISTRY_TESTS.length)
	})
})
