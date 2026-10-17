import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_read_map, type ReadMap } from './test-read-map'
import { test_read_trace } from './test-read-trace'

// joshuafolkken/kit#4065: the map `josh test:related` narrows a changed non-code file through. A
// map it cannot trust must read as no map at all, which runs the whole suite.

vi.mock('#scripts/git/git-common-directory', () => ({
	git_common_directory: { repository: vi.fn() },
}))

const mocked_common = vi.mocked(git_common_directory.repository)

const ROOT = path.resolve('/repo')
const DOCUMENT = path.join('docs', 'a.md')
const NESTED_DOCUMENT = path.join('docs', 'guide', 'b.md')
const READER = 'reader.ts'
const WALKER = 'walker.ts'
const ROOT_WALKER = 'root-walker.ts'

const MAP: ReadMap = {
	version: test_read_map.MAP_VERSION,
	commit: 'abc',
	dirty: ['notes.md'],
	readers: { [DOCUMENT]: [READER], docs: [WALKER], [test_read_trace.ROOT_ENTRY]: [ROOT_WALKER] },
}

// A holder rather than a top-level `let`: `unicorn/no-top-level-assignment-in-function` refuses a
// hook assigning to a top-level binding, so the per-test common directory lives on this object.
const common = { directory: '' }

beforeEach(() => {
	common.directory = mkdtempSync(path.join(tmpdir(), 'josh-test-read-map-'))
	mocked_common.mockReturnValue(common.directory)
})

afterEach(() => {
	rmSync(common.directory, { recursive: true, force: true })
})

describe('test_read_map.merge_records', () => {
	it('unions the readers of one path across workers', () => {
		const merged = test_read_map.merge_records([
			{ [DOCUMENT]: [READER] },
			{ [DOCUMENT]: [WALKER, READER] },
		])

		expect(merged).toEqual({ [DOCUMENT]: [READER, WALKER] })
	})
})

describe('test_read_map.parse_map', () => {
	it('reads back what it wrote', () => {
		expect(test_read_map.parse_map(JSON.stringify(MAP))).toEqual(MAP)
	})

	it.each([
		['malformed JSON', '{'],
		['another version', JSON.stringify({ ...MAP, version: test_read_map.MAP_VERSION + 1 })],
		['a reader list that is not strings', JSON.stringify({ ...MAP, readers: { a: [1] } })],
		['no commit', JSON.stringify({ ...MAP, commit: undefined })],
	])('reads %s as no map', (_case, text) => {
		expect(test_read_map.parse_map(text)).toBeUndefined()
	})
})

describe('test_read_map.readers_of', () => {
	it('answers the file’s own readers and every walk above it, up to the root', () => {
		expect(test_read_map.readers_of(MAP, DOCUMENT)).toEqual([READER, WALKER, ROOT_WALKER])
	})

	it('reaches a file no test read through the directories above it', () => {
		expect(test_read_map.readers_of(MAP, NESTED_DOCUMENT)).toEqual([WALKER, ROOT_WALKER])
	})

	it('answers nothing when neither the file nor any directory above it was read', () => {
		const map = { ...MAP, readers: { [DOCUMENT]: [READER] } }

		expect(test_read_map.readers_of(map, NESTED_DOCUMENT)).toEqual([])
	})
})

describe('test_read_map.read_map and write_map', () => {
	it('round-trips through the git common directory', () => {
		test_read_map.write_map(ROOT, MAP)

		expect(test_read_map.read_map(ROOT)).toEqual(MAP)
		expect(test_read_map.map_path(ROOT)).toBe(
			path.join(common.directory, 'josh', 'test-read-map.json'),
		)
	})

	it('reads no map where none was written', () => {
		expect(test_read_map.read_map(ROOT)).toBeUndefined()
	})

	it('reads and writes nothing outside a repository', () => {
		mocked_common.mockReturnValue(undefined)
		test_read_map.write_map(ROOT, MAP)

		expect(test_read_map.read_map(ROOT)).toBeUndefined()
	})
})

describe('test_read_map.collect_records', () => {
	it('reads every worker’s record file and skips anything else', () => {
		writeFileSync(
			path.join(common.directory, '1-1-1.json'),
			JSON.stringify({ [DOCUMENT]: [READER] }),
		)
		writeFileSync(path.join(common.directory, '1-2-1.json'), 'not json')
		writeFileSync(
			path.join(common.directory, 'stray.txt'),
			JSON.stringify({ [DOCUMENT]: [WALKER] }),
		)

		expect(test_read_map.collect_records(common.directory)).toEqual([{ [DOCUMENT]: [READER] }, {}])
	})
})
