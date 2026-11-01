import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { test_pinned_logic } from './test-pinned-logic'
import type { ReachedCount } from './test-pinned-reach'
import { test_related_cap } from './test-related-cap'
import { test_related_pins } from './test-related-pins'

// joshuafolkken/kit#5642: a change to the josh command registry always runs the registry tests, even when
// the cap narrows its reach to the direct importers.

const { REGISTRY_TESTS } = test_related_pins
const COMMAND_TABLE = 'scripts/josh/josh-commands-development.ts'
const COMMAND_TABLE_TEST = 'scripts/josh/josh-commands-development.test.ts'
const PACKAGE_FILE = 'package.json'
const FIXTURE_FILES: Readonly<Record<string, string>> = {
	[PACKAGE_FILE]: JSON.stringify({ imports: {} }),
	[COMMAND_TABLE]: 'export const commands = 1\n',
	[COMMAND_TABLE_TEST]: "import { commands } from './josh-commands-development'\n",
}

async function open_fixture(): Promise<FixtureWorkspace> {
	const fixture = git_fixture_workspace.open_workspace('test-related-pins-')

	await git_fixture_workspace.git(fixture.workspace, ['init', '--quiet'])

	for (const [file, content] of Object.entries(FIXTURE_FILES)) {
		mkdirSync(path.dirname(path.join(fixture.workspace, file)), { recursive: true })
		writeFileSync(path.join(fixture.workspace, file), content)
	}

	return fixture
}

async function past_the_cap(files: ReadonlyArray<string>): Promise<Array<ReachedCount>> {
	return files.map((file) => ({ file, count: test_pinned_logic.MAX_TEST_FILES + 1 }))
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
		const changed = [COMMAND_TABLE, 'scripts/josh/josh-commands-lane.ts']

		expect(test_related_pins.pinned_tests(changed)).toEqual(REGISTRY_TESTS)
	})

	it('pins nothing to a change outside the registry', () => {
		expect(test_related_pins.pinned_tests(['scripts/test/test-related.ts'])).toEqual([])
	})
})

describe('test_related_cap.capped_importers with a registry file past the cap', () => {
	let fixture: FixtureWorkspace

	beforeEach(async () => {
		fixture = await open_fixture()
	})

	afterEach(async () => {
		await git_fixture_workspace.close_workspace(fixture)
	})

	it('narrows to the direct importers and the pinned registry tests', async () => {
		const capped = await test_related_cap.capped_importers(
			fixture.workspace,
			[COMMAND_TABLE],
			false,
			past_the_cap,
		)

		expect(capped.over_cap).toEqual([COMMAND_TABLE])
		expect(capped.importers.get(COMMAND_TABLE)).toEqual([COMMAND_TABLE_TEST, ...REGISTRY_TESTS])
	})
})
