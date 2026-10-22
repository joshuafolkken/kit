import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
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
const DEEP_DOCUMENT = path.join('.josh', 'observations', 'c.md')
const READER = 'reader.ts'
const WALKER = 'walker.ts'
const LISTER = 'lister.ts'
const DIRTY = 'notes.md'
const DIGEST_THEN = 'digest-then'
const ROOT_WALKER = 'root-walker.ts'
const ROOT_LISTER = 'root-lister.ts'
const ROOT_PROBER = 'root-prober.ts'

const { ROOT_ENTRY } = test_read_trace

const MAP: ReadMap = {
	version: test_read_map.MAP_VERSION,
	commit: 'abc',
	dirty: { [DIRTY]: DIGEST_THEN },
	directories: [
		'.josh',
		path.dirname(DEEP_DOCUMENT),
		'docs',
		path.join('docs', 'guide'),
		'prompts',
	],
	readers: {
		[DOCUMENT]: [READER],
		[test_read_trace.read_key('docs', 'walk')]: [WALKER],
		[test_read_trace.read_key(path.join('docs', 'guide'), 'listing')]: [LISTER],
		[test_read_trace.read_key(ROOT_ENTRY, 'walk')]: [ROOT_WALKER],
	},
}

// joshuafolkken/kit#4071: what reads the root without walking it — a listing of its own entries,
// or a probe of the directory itself — and what a change deep in the tree leaves untouched.
const SHALLOW_ROOT_MAP: ReadMap = {
	...MAP,
	readers: {
		[test_read_trace.read_key(ROOT_ENTRY, 'listing')]: [ROOT_LISTER],
		[test_read_trace.read_key(ROOT_ENTRY, 'path')]: [ROOT_PROBER],
		[path.join(path.dirname(DEEP_DOCUMENT), 'other.md')]: [READER],
	},
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
		['a dirty list without digests', JSON.stringify({ ...MAP, dirty: [DIRTY] })],
		['a dirty digest that is not a string', JSON.stringify({ ...MAP, dirty: { [DIRTY]: 1 } })],
	])('reads %s as no map', (_case, text) => {
		expect(test_read_map.parse_map(text)).toBeUndefined()
	})
})

// joshuafolkken/kit#4425: a file dirty when the map was recorded is changed only when its content
// moved, so a lane's own unchanged change no longer reaches every test on each later gate.
describe('test_read_map.changed_since_tree', () => {
	const FRESH = 'fresh.ts'

	it('leaves out a file dirty then whose content has not moved', () => {
		expect(test_read_map.changed_since_tree(MAP, [DIRTY], { [DIRTY]: DIGEST_THEN })).toEqual([])
	})

	it('counts a file dirty then whose content moved, even back to the commit’s', () => {
		expect(test_read_map.changed_since_tree(MAP, [], { [DIRTY]: 'digest-now' })).toEqual([DIRTY])
	})

	it('counts a file dirty then that no digest can be read for', () => {
		expect(test_read_map.changed_since_tree(MAP, [DIRTY], {})).toEqual([DIRTY])
	})

	it('counts every file that differs from the commit and was not dirty then', () => {
		expect(test_read_map.changed_since_tree(MAP, [FRESH, DIRTY], { [DIRTY]: DIGEST_THEN })).toEqual(
			[FRESH],
		)
	})
})

describe('test_read_map.readers_of', () => {
	it('answers the file’s own readers and every walk above it, up to the root', () => {
		expect(test_read_map.readers_of(MAP, DOCUMENT)).toEqual([READER, WALKER, ROOT_WALKER])
	})

	it('reaches a file no test read through its directory’s listing and every walk above it', () => {
		expect(test_read_map.readers_of(MAP, NESTED_DOCUMENT)).toEqual([LISTER, WALKER, ROOT_WALKER])
	})

	it('leaves out a listing or a probe of the root when the change is deeper down', () => {
		expect(test_read_map.readers_of(SHALLOW_ROOT_MAP, DEEP_DOCUMENT)).toEqual([])
	})

	it('reaches a file at the top level through the listing of the root', () => {
		expect(test_read_map.readers_of(SHALLOW_ROOT_MAP, DIRTY)).toEqual([ROOT_LISTER])
	})

	it('leaves out the listing above a directory that existed though no test read it', () => {
		const added = path.join('prompts', 'x.md')

		expect(test_read_map.readers_of(SHALLOW_ROOT_MAP, added)).toEqual([])
	})

	it('reaches a file in a directory new since the recording through the listing that gains it', () => {
		const added = path.join('scratch', 'x.md')

		expect(test_read_map.readers_of(SHALLOW_ROOT_MAP, added)).toEqual([ROOT_LISTER])
	})

	it('reaches a file in a directory new since the recording through a probe of that directory', () => {
		const created = path.join('prompts', 'new-dir')
		const map = { ...SHALLOW_ROOT_MAP, readers: { [created]: [ROOT_PROBER] } }

		expect(test_read_map.readers_of(map, path.join(created, 'x.md'))).toEqual([ROOT_PROBER])
	})

	it('answers nothing when neither the file nor any directory above it was read', () => {
		const map = { ...MAP, readers: { [DOCUMENT]: [READER] } }

		expect(test_read_map.readers_of(map, NESTED_DOCUMENT)).toEqual([])
	})
})

// joshuafolkken/kit#4303: whether a file added since the recording lands where no test reads.
describe('test_read_map.in_unread_directory', () => {
	it('holds a file added to a recorded directory nothing inside was read from', () => {
		expect(test_read_map.in_unread_directory(MAP, DEEP_DOCUMENT)).toBe(true)
	})

	it('rejects a directory one of whose files a test read', () => {
		expect(test_read_map.in_unread_directory(SHALLOW_ROOT_MAP, DEEP_DOCUMENT)).toBe(false)
	})

	it('rejects a directory a test listed or walked', () => {
		expect(test_read_map.in_unread_directory(MAP, NESTED_DOCUMENT)).toBe(false)
		expect(test_read_map.in_unread_directory(MAP, path.join('docs', 'x.md'))).toBe(false)
	})

	it('rejects a directory the recorded tree did not hold', () => {
		expect(test_read_map.in_unread_directory(MAP, path.join('scratch', 'x.md'))).toBe(false)
	})
})

describe('test_read_map.read_map and write_map', () => {
	it('round-trips through the git common directory', () => {
		test_read_map.write_map(ROOT, MAP)

		expect(test_read_map.read_map(ROOT)).toEqual(MAP)
		expect(test_read_map.map_path(ROOT)).toBe(
			path.join(common.directory, 'josh', `test-read-map.v${String(MAP.version)}.json`),
		)
	})

	// joshuafolkken/kit#4423: a lane on another kit writes its own version's file beside this one.
	it('still reads its own version once another version’s map is written', () => {
		const other: ReadMap = { ...MAP, version: MAP.version + 1, commit: 'def' }

		test_read_map.write_map(ROOT, MAP)
		test_read_map.write_map(ROOT, other)

		expect(test_read_map.read_map(ROOT)).toEqual(MAP)
		expect(existsSync(test_read_map.map_path(ROOT, other.version) ?? '')).toBe(true)
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

const EIGHT_DAYS_S = 691_200
const LEGACY_MAP = 'test-read-map.json'
const STALE_MAP = 'test-read-map.v2.json'
const FRESH_MAP = 'test-read-map.v3.json'
const STALE_OTHER = 'other.json'

function seed(name: string, stale: boolean): void {
	const file_path = path.join(common.directory, 'josh', name)
	const seconds = Date.now() / 1000 - (stale ? EIGHT_DAYS_S : 0)

	mkdirSync(path.dirname(file_path), { recursive: true })
	writeFileSync(file_path, '{}')
	utimesSync(file_path, seconds, seconds)
}

function survives(name: string): boolean {
	return existsSync(path.join(common.directory, 'josh', name))
}

// joshuafolkken/kit#4423: the per-version files must not pile up in the shared directory.
describe('test_read_map.write_map pruning', () => {
	beforeEach(() => {
		seed(LEGACY_MAP, true)
		seed(STALE_MAP, true)
		seed(FRESH_MAP, false)
		seed(STALE_OTHER, true)
		test_read_map.write_map(ROOT, MAP)
	})

	it('removes another version’s map no lane has written for a week, the unversioned one included', () => {
		expect(survives(LEGACY_MAP)).toBe(false)
		expect(survives(STALE_MAP)).toBe(false)
	})

	it('keeps a map another lane wrote recently, its own map and every other file', () => {
		expect(survives(FRESH_MAP)).toBe(true)
		expect(test_read_map.read_map(ROOT)).toEqual(MAP)
		expect(survives(STALE_OTHER)).toBe(true)
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
