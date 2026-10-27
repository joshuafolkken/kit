import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { direct_importers } from './direct-importers'

// joshuafolkken/kit#5122: a file every test imports narrows to the test files importing it directly,
// read off their text, rather than sending `vitest related` to the whole suite.

const BASE_MODULE_KEY = 'scripts/git/base'
const IMPORTER = 'tools/x.ts'
const IMPORTS = Object.fromEntries([
	['#scripts/*', './scripts/*.ts'],
	['#tools/*', './tools/*.ts'],
])
const PACKAGE_FILE = 'package.json'
const OTHER_TEST = 'scripts/other.test.ts'
const NON_TEST_IMPORTER = 'tools/test/pure-files.helper.ts'
const EVERY_TEST_MODULE = 'tools/test/unit-projects.ts'
const UNIMPORTED_MODULE = 'tools/test/pure-files.ts'
const OTHER_MODULE = 'scripts/other.ts'
const ALIASED_IMPORTER = 'tools/test/unit-projects.test.ts'
const RELATIVE_IMPORTER = 'scripts/test/vitest-config.test.ts'

const FIXTURE_FILES: Readonly<Record<string, string>> = {
	[PACKAGE_FILE]: JSON.stringify({ imports: IMPORTS }),
	[EVERY_TEST_MODULE]: 'export const projects = []\n',
	[UNIMPORTED_MODULE]: 'export const pure = []\n',
	[OTHER_MODULE]: 'export const other = 1\n',
	[ALIASED_IMPORTER]: "import { projects } from '#tools/test/unit-projects'\n",
	[RELATIVE_IMPORTER]: "import { projects } from '../../tools/test/unit-projects.ts'\n",
	[OTHER_TEST]: "import { other } from './other'\n",
	[NON_TEST_IMPORTER]: "import { pure } from './pure-files'\n",
}

describe('direct_importers.specifiers_of', () => {
	it('reads static, dynamic, export-from and mocked specifiers', () => {
		const source = [
			"import a from './a'",
			"import './b'",
			"export { c } from '#scripts/c'",
			"const d = await import('./d.ts')",
			"vi.mock('./e')",
		].join('\n')

		expect(direct_importers.specifiers_of(source)).toEqual([
			'./a',
			'./b',
			'#scripts/c',
			'./d.ts',
			'./e',
		])
	})
})

describe('direct_importers.resolve_specifier', () => {
	it('resolves a relative specifier beside the importing file, extension dropped', () => {
		expect(direct_importers.resolve_specifier('../git/base.ts', 'scripts/test/x.test.ts', {})).toBe(
			BASE_MODULE_KEY,
		)
	})

	it('resolves an alias through the package imports', () => {
		expect(direct_importers.resolve_specifier('#scripts/git/base', IMPORTER, IMPORTS)).toBe(
			BASE_MODULE_KEY,
		)
	})

	it('answers nothing for a package import', () => {
		expect(direct_importers.resolve_specifier('zod', IMPORTER, IMPORTS)).toBeUndefined()
	})
})

describe('direct_importers.every_test_importers', () => {
	let fixture: FixtureWorkspace

	beforeEach(async () => {
		fixture = git_fixture_workspace.open_workspace('direct-importers-')
		await git_fixture_workspace.git(fixture.workspace, ['init', '--quiet'])

		for (const [file, content] of Object.entries(FIXTURE_FILES)) {
			mkdirSync(path.dirname(path.join(fixture.workspace, file)), { recursive: true })
			writeFileSync(path.join(fixture.workspace, file), content)
		}
	})

	afterEach(async () => {
		await git_fixture_workspace.close_workspace(fixture)
	})

	it('maps a file every test imports to the test files importing it directly', async () => {
		const importers = await direct_importers.every_test_importers(fixture.workspace, [
			EVERY_TEST_MODULE,
		])

		expect(importers.get(EVERY_TEST_MODULE)).toEqual([RELATIVE_IMPORTER, ALIASED_IMPORTER])
	})

	it('maps one only a non-test file imports to no test file', async () => {
		const importers = await direct_importers.every_test_importers(fixture.workspace, [
			UNIMPORTED_MODULE,
		])

		expect(importers.get(UNIMPORTED_MODULE)).toEqual([])
	})

	it('leaves out a file not every test imports', async () => {
		const importers = await direct_importers.every_test_importers(fixture.workspace, [OTHER_MODULE])

		expect(importers.has(OTHER_MODULE)).toBe(false)
	})
})
