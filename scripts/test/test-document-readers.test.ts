import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { direct_importers } from './direct-importers'
import { test_document_readers } from './test-document-readers'
import { test_read_map, type ReadMap } from './test-read-map'

// joshuafolkken/kit#7978: a changed document's readers are found by its path in the test files' text
// and, for a test the read map has not recorded, in the modules it imports directly.

const DOCUMENT = 'prompts/guide.md'
const UNNAMED_DOCUMENT = 'docs/unnamed.md'
const NAMING_TEST = 'scripts/naming.test.ts'
const HELPER_TEST = 'scripts/helped.test.ts'
const HELPER = 'scripts/guide-fixture.ts'
const LISTING_TEST = 'scripts/listing.test.ts'
const COMMENTING_TEST = 'scripts/commenting.test.ts'

const FILES: Readonly<Record<string, string>> = {
	[NAMING_TEST]: `const FILE = '${DOCUMENT}'\n`,
	[HELPER_TEST]: `import { fixture } from './guide-fixture'\n`,
	[HELPER]: `export const fixture = '${DOCUMENT}'\n`,
	[LISTING_TEST]: `const FILES = readdirSync('prompts')\n`,
	[COMMENTING_TEST]: `// Mirrors \`${DOCUMENT}\`.\nconst RULE = 1\n`,
	[DOCUMENT]: '# Guide\n',
}

// A map that recorded the helper's importer reading something else.
const MAP: ReadMap = {
	version: 1,
	commit: 'abc',
	dirty: {},
	change: [],
	directories: ['docs'],
	readers: { [UNNAMED_DOCUMENT]: [HELPER_TEST] },
}

const create = temporary_directory('suite')

function written_tree(): string {
	const directory = create('document-readers-')

	for (const [file, text] of Object.entries(FILES)) {
		mkdirSync(path.dirname(path.join(directory, file)), { recursive: true })
		writeFileSync(path.join(directory, file), text)
	}

	return directory
}

const ROOT = written_tree()

beforeEach(() => {
	vi.spyOn(direct_importers, 'work_tree_files').mockResolvedValue(Object.keys(FILES))
	vi.spyOn(test_read_map, 'read_map').mockReturnValue(undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('test_document_readers.readers_of', () => {
	it('finds the tests naming the path themselves or through a module they import', async () => {
		const readers = await test_document_readers.readers_of(ROOT, [DOCUMENT])

		expect(readers.get(DOCUMENT)).toEqual([NAMING_TEST, HELPER_TEST])
	})

	it('leaves out a test that reads the document without naming its path', async () => {
		const readers = await test_document_readers.readers_of(ROOT, [DOCUMENT])

		expect(readers.get(DOCUMENT)).not.toContain(LISTING_TEST)
	})

	it('leaves out a test that names the path only in a comment', async () => {
		const readers = await test_document_readers.readers_of(ROOT, [DOCUMENT])

		expect(readers.get(DOCUMENT)).not.toContain(COMMENTING_TEST)
	})

	it('leaves the helper route of a test the map recorded to the map', async () => {
		vi.mocked(test_read_map.read_map).mockReturnValue(MAP)

		const readers = await test_document_readers.readers_of(ROOT, [DOCUMENT])

		expect(readers.get(DOCUMENT)).toEqual([NAMING_TEST])
	})

	it('maps a document no test names to none', async () => {
		const readers = await test_document_readers.readers_of(ROOT, [UNNAMED_DOCUMENT])

		expect(readers.get(UNNAMED_DOCUMENT)).toEqual([])
	})

	it('reads nothing when no document changed', async () => {
		expect(await test_document_readers.readers_of(ROOT, [])).toEqual(new Map())
		expect(direct_importers.work_tree_files).not.toHaveBeenCalled()
	})
})
