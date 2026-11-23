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

const { PIN_ROWS, REGISTRY_TESTS } = test_related_pins
const COMMAND_DERIVE = 'tools/document/command-derive.test.ts'
const ENVIRONMENT = 'scripts/document/environment-file-reference.test.ts'
const TELEGRAM = 'scripts/josh/josh-command-telegram-environment.test.ts'
const UNTESTED = 'tools/test/untested-sources.test.ts'
const BUILD_HOOKS = 'scripts/build/build-hooks.test.ts'
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

describe('test_related_pins.PIN_ROWS', () => {
	it.each(PIN_ROWS.flatMap((row) => row.tests))('names %s, a test file on disk', (file) => {
		expect(existsSync(path.resolve(file))).toBe(true)
	})
})

describe('test_related_pins.pinned_tests', () => {
	it('pins each test once to a change touching two command tables', () => {
		const pins = test_related_pins.pinned_tests([COMMAND_TABLE, 'scripts/josh/josh-commands-ai.ts'])

		expect(pins.slice(0, REGISTRY_TESTS.length)).toEqual(REGISTRY_TESTS)
		expect(new Set(pins).size).toBe(pins.length)
	})

	it('pins the in-process main-guard test to a change adding a command to a table', () => {
		expect(test_related_pins.pinned_tests([COMMAND_TABLE])).toContain(
			'scripts/josh/josh-in-process.test.ts',
		)
	})

	it('pins no registry test to a change outside the registry', () => {
		expect(test_related_pins.pinned_tests(['scripts/test/test-related.ts'])).not.toContain(
			REGISTRY_TESTS[0],
		)
	})

	it.each(['scripts/test/test-related.test.ts', 'src/lib/foo.ts', 'README.md', 'scripts/a.d.ts'])(
		'pins nothing to %s, which no row reads',
		(file) => {
			expect(test_related_pins.pinned_tests([file])).toEqual([])
		},
	)
})

// joshuafolkken/kit#8861: each derived-artifact test, the changed-path shapes that reach it and one that
// does not.
describe('test_related_pins.pinned_tests for a derived-artifact test', () => {
	const GENERATOR = 'tools/document/generate-catalog.ts'
	const ENVIRONMENT_PAGE = 'docs/environment-variables.md'
	const NEW_SCRIPT = 'scripts/run/run-new.ts'
	const NEW_TOOL = 'tools/lane/lane-new.ts'
	const CLI_PAGE = 'docs/cli.md'
	const NOTIFIER = 'scripts/notify/telegram-notify.ts'

	it.each([
		[COMMAND_DERIVE, ['docs/josh-command-catalog.md', GENERATOR]],
		[COMMAND_DERIVE, ['eslint/rules/code-quality.js', 'CLAUDE.md', 'prompts/refactoring.md']],
		[ENVIRONMENT, [ENVIRONMENT_PAGE, NEW_SCRIPT]],
		[ENVIRONMENT, ['.claude/skills/workflow-commands/chain-rule.md', CLI_PAGE]],
		[TELEGRAM, [NOTIFIER, COMMAND_TABLE]],
		[UNTESTED, [NEW_TOOL, NEW_SCRIPT]],
		[BUILD_HOOKS, ['scripts/hooks/stop-guard.ts', 'tools/hooks/hook-daemon.ts']],
		[BUILD_HOOKS, ['scripts/josh/session-language-main.ts', 'scripts/build/build-hooks.ts']],
	])('pins %s to each of %j', (test, files) => {
		for (const file of files) expect(test_related_pins.pinned_tests([file])).toContain(test)
	})

	it.each([
		[COMMAND_DERIVE, CLI_PAGE],
		[ENVIRONMENT, NEW_TOOL],
		[TELEGRAM, GENERATOR],
		[UNTESTED, ENVIRONMENT_PAGE],
		[BUILD_HOOKS, NOTIFIER],
	])('does not pin %s to %s', (test, file) => {
		expect(test_related_pins.pinned_tests([file])).not.toContain(test)
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
			symbols: async () => undefined,
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
