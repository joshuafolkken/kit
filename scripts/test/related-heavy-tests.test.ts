import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { related_heavy_tests, type HeavyReader } from './related-heavy-tests'
import type { RelatedScope } from './test-related-scope'
import { unit_durations } from './unit-durations'

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
const NAMED_MODULE = 'tools/test/harness-kit.ts'
const SCRIPTS_ALIAS = '#scripts/*'
const SCRIPTS_TARGET = './scripts/*.ts'
const CONDITIONAL_ALIAS = '#c'
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
	imports: Object.fromEntries([[SCRIPTS_ALIAS, SCRIPTS_TARGET]]),
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

describe('related_heavy_tests.exclude_flags — the test named for a changed module', () => {
	it('keeps it when it reaches that module only through a harness', () => {
		const flags = related_heavy_tests.exclude_flags(related(NAMED_MODULE), ROOT, READER)

		expect(flags).not.toContain(HEAVY_FILE)
		expect(flags).toContain(IMPORTING_FILE)
	})
})

function write_file(root: string, file: string, text: string): void {
	mkdirSync(path.join(root, path.dirname(file)), { recursive: true })
	writeFileSync(path.join(root, file), text)
}

describe('related_heavy_tests.exclude_flags — the records it reads off the checkout', () => {
	it('resolves nothing through a conditional package import instead of throwing', () => {
		const root = mkdtempSync(path.join(tmpdir(), 'related-heavy-tests-'))
		const package_imports = Object.fromEntries<unknown>([
			[CONDITIONAL_ALIAS, { node: './c.js' }],
			[SCRIPTS_ALIAS, SCRIPTS_TARGET],
		])

		write_file(root, 'package.json', JSON.stringify({ imports: package_imports }))
		write_file(
			root,
			unit_durations.RECORD_FILE,
			JSON.stringify({ [HEAVY_FILE]: HEAVY_TEST_MS + 1 }),
		)
		write_file(root, HEAVY_FILE, `import { c } from '${CONDITIONAL_ALIAS}'\n`)

		const scope = related(LIGHT_FILE)
		const at_root = {
			...scope,
			files: scope.files.map((file) => path.join(root, path.relative(ROOT, file))),
		}

		expect(related_heavy_tests.exclude_flags(at_root, root)).toEqual([EXCLUDE_FLAG, HEAVY_FILE])
		rmSync(root, { recursive: true, force: true })
	})
})
