import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { test_related_mocking } from './test-related-mocking'

// joshuafolkken/kit#7924: the tests a moved import can break past the direct importers are those that
// mock a module, by their own `vi.mock` or a fixture's.

const PLAIN_TEST = 'scripts/plain.test.ts'
const MOCK_TEST = 'scripts/mock.test.ts'
const DO_MOCK_TEST = 'scripts/do-mock.test.ts'
const FIXTURE_TEST = 'scripts/fixture.test.ts'
const ALIAS_TEST = 'scripts/alias.test.ts'
const GONE_TEST = 'scripts/gone.test.ts'
const MOCK_SOURCE = "vi.mock('node:fs', () => ({}))\n"
const FIXTURE_FILES: Readonly<Record<string, string>> = {
	'package.json': JSON.stringify({ imports: { '#scripts/*': './scripts/*' } }),
	'scripts/mocking-fixture.ts': MOCK_SOURCE,
	'scripts/plain-fixture.ts': 'export const plain = 1\n',
	[PLAIN_TEST]: "import { plain } from './plain-fixture'\nimport { vi } from 'vitest'\n",
	[MOCK_TEST]: MOCK_SOURCE,
	[DO_MOCK_TEST]: "vi.doMock('node:fs', () => ({}))\n",
	[FIXTURE_TEST]: "import './mocking-fixture'\n",
	[ALIAS_TEST]: "import '#scripts/mocking-fixture'\n",
}

function write_fixture(root: string): void {
	for (const [file, content] of Object.entries(FIXTURE_FILES)) {
		mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
		writeFileSync(path.join(root, file), content)
	}
}

describe('test_related_mocking.mocking_tests', () => {
	let fixture: FixtureWorkspace

	beforeEach(() => {
		fixture = git_fixture_workspace.open_workspace('test-related-mocking-')
		write_fixture(fixture.workspace)
	})

	afterEach(async () => {
		await git_fixture_workspace.close_workspace(fixture)
	})

	it.each([MOCK_TEST, DO_MOCK_TEST])('keeps %s, which mocks a module itself', (test) => {
		expect(test_related_mocking.mocking_tests(fixture.workspace, [test])).toEqual([test])
	})

	it.each([FIXTURE_TEST, ALIAS_TEST])('keeps %s, whose fixture mocks a module', (test) => {
		expect(test_related_mocking.mocking_tests(fixture.workspace, [test])).toEqual([test])
	})

	it('drops a test that mocks nothing and one that cannot be read', () => {
		const tests = [PLAIN_TEST, GONE_TEST]

		expect(test_related_mocking.mocking_tests(fixture.workspace, tests)).toEqual([])
	})
})
