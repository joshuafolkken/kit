import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { related_heavy_tests, type HeavyReader } from './related-heavy-tests'
import type { RelatedScope } from './test-related-scope'

// joshuafolkken/kit#5105: a scoped run leaves out the heavy files a change reaches only through a
// hub, and never one this change moved or one importing a moved file directly.

const { EXCLUDE_FLAG, HEAVY_TEST_MS } = related_heavy_tests

const ROOT = path.resolve('/repo')
const HEAVY_FILE = 'tools/test/harness-kit.test.ts'
const IMPORTING_FILE = 'scripts/build/build-hooks.test.ts'
const ALIASED_FILE = 'scripts/test/pinned-cache.test.ts'
const LIGHT_FILE = 'scripts/lane/lane-ledger.test.ts'
const UNREADABLE_FILE = 'tools/metrics/metrics-base.integration.test.ts'
const CHANGED_MODULE = 'scripts/build/build-hooks.ts'
const BASE_MODULE_KEY = 'scripts/git/base'
const IMPORTER = 'tools/x.ts'
const SCRIPTS_ALIAS = '#scripts/*'
const ALIASED_MODULE = 'scripts/test/pinned-cache.ts'

const SOURCES: Readonly<Record<string, string>> = {
	[HEAVY_FILE]: "import { harness } from './josh-harness'\n",
	[IMPORTING_FILE]: "import { build_hooks } from './build-hooks'\n",
	[ALIASED_FILE]: "import { cache } from '#scripts/test/pinned-cache'\nimport { z } from 'zod'\n",
}

const READER: HeavyReader = {
	durations: {
		[HEAVY_FILE]: HEAVY_TEST_MS + 1,
		[IMPORTING_FILE]: HEAVY_TEST_MS + 1,
		[ALIASED_FILE]: HEAVY_TEST_MS + 1,
		[LIGHT_FILE]: HEAVY_TEST_MS,
	},
	imports: Object.fromEntries([[SCRIPTS_ALIAS, './scripts/*.ts']]),
	read_source: (file) => SOURCES[file],
}

function related(...files: ReadonlyArray<string>): RelatedScope {
	return { mode: 'related', files: files.map((file) => path.join(ROOT, file)), reason: '' }
}

describe('related_heavy_tests.heavy_tests', () => {
	it('names only the files recorded over the threshold', () => {
		expect(related_heavy_tests.heavy_tests(READER.durations)).toEqual([
			HEAVY_FILE,
			IMPORTING_FILE,
			ALIASED_FILE,
		])
	})
})

describe('related_heavy_tests.specifiers_of', () => {
	it('reads static, dynamic, export-from and mocked specifiers', () => {
		const source = [
			"import a from './a'",
			"import './b'",
			"export { c } from '#scripts/c'",
			"const d = await import('./d.ts')",
			"vi.mock('./e')",
		].join('\n')

		expect(related_heavy_tests.specifiers_of(source)).toEqual([
			'./a',
			'./b',
			'#scripts/c',
			'./d.ts',
			'./e',
		])
	})
})

describe('related_heavy_tests.resolve_specifier', () => {
	it('resolves a relative specifier beside the importing file, extension dropped', () => {
		expect(
			related_heavy_tests.resolve_specifier('../git/base.ts', 'scripts/test/x.test.ts', {}),
		).toBe(BASE_MODULE_KEY)
	})

	it('resolves an alias through the package imports', () => {
		expect(
			related_heavy_tests.resolve_specifier('#scripts/git/base', IMPORTER, READER.imports),
		).toBe(BASE_MODULE_KEY)
	})

	it('answers nothing for a package import', () => {
		expect(related_heavy_tests.resolve_specifier('zod', IMPORTER, READER.imports)).toBeUndefined()
	})
})

describe('related_heavy_tests.exclude_flags', () => {
	it('leaves out a heavy file the scope reaches only indirectly', () => {
		expect(related_heavy_tests.exclude_flags(related(LIGHT_FILE), ROOT, READER)).toEqual([
			EXCLUDE_FLAG,
			HEAVY_FILE,
			EXCLUDE_FLAG,
			IMPORTING_FILE,
			EXCLUDE_FLAG,
			ALIASED_FILE,
		])
	})

	it('keeps a heavy file this change moved', () => {
		expect(related_heavy_tests.exclude_flags(related(HEAVY_FILE), ROOT, READER)).not.toContain(
			HEAVY_FILE,
		)
	})

	it('keeps a heavy file importing a changed module directly, relative or aliased', () => {
		const flags = related_heavy_tests.exclude_flags(
			related(CHANGED_MODULE, ALIASED_MODULE),
			ROOT,
			READER,
		)

		expect(flags).toEqual([EXCLUDE_FLAG, HEAVY_FILE])
	})

	it('keeps a heavy file whose source cannot be read', () => {
		const reader = { ...READER, durations: { [UNREADABLE_FILE]: HEAVY_TEST_MS + 1 } }

		expect(related_heavy_tests.exclude_flags(related(LIGHT_FILE), ROOT, reader)).toEqual([])
	})

	it('excludes nothing from a whole-suite run', () => {
		const scope: RelatedScope = { mode: 'all', files: [], reason: '' }

		expect(related_heavy_tests.exclude_flags(scope, ROOT, READER)).toEqual([])
	})
})
