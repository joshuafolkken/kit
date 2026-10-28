import path from 'node:path'
import { input_fingerprint } from '#scripts/gate/input-fingerprint'
import { changed_paths } from '#scripts/git/changed-paths'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { test_read_map, type ReadMap } from './test-read-map'
import { test_related } from './test-related'

// joshuafolkken/kit#4314: the gate reuses a green unit step only when `josh test:related` would run no
// test for what moved since — and never when the map that answers it is missing or too old to diff.

vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: {
		read_changed_paths: vi.fn(),
		read_changed_since: vi.fn(),
		read_held_at: vi.fn(),
	},
}))

const mocked_since = vi.mocked(changed_paths.read_changed_since)
const mocked_held = vi.mocked(changed_paths.read_held_at)

const ROOT = process.cwd()
const READER = path.join('scripts', 'test', 'test-related.test.ts')
const READ_DOCUMENT = 'README.md'
const UNREAD_DOCUMENT = 'CONTRIBUTING.md'
const SOURCE = path.join('scripts', 'test', 'test-related.ts')
// A real source whose text names the document, as a file-system read of it does.
const NAMING_SOURCE = path.join('scripts', 'doctor', 'doctor-logic.ts')
const NAMED_DOCUMENT = path.join('docs', 'josh-commands.md')

const MAP: ReadMap = {
	version: test_read_map.MAP_VERSION,
	commit: 'f00dcafe',
	dirty: {},
	change: [],
	directories: [],
	readers: { [READ_DOCUMENT]: [READER] },
}

beforeEach(() => {
	vi.restoreAllMocks()
	mocked_since.mockResolvedValue([])
	mocked_held.mockImplementation(async (_commit, files) => [...files])
	vi.spyOn(test_read_map, 'read_map').mockReturnValue(MAP)
})

describe('test_related.reaches_tests', () => {
	it('answers false when every moved file is one no recorded test reads', async () => {
		await expect(test_related.reaches_tests(ROOT, [UNREAD_DOCUMENT])).resolves.toBe(false)
	})

	it('answers true when a recorded test reads a moved file', async () => {
		await expect(test_related.reaches_tests(ROOT, [UNREAD_DOCUMENT, READ_DOCUMENT])).resolves.toBe(
			true,
		)
	})

	it('answers true for a moved module, which the module graph alone can relate', async () => {
		await expect(test_related.reaches_tests(ROOT, [SOURCE])).resolves.toBe(true)
	})

	it('answers false when nothing moved, whatever the map', async () => {
		vi.mocked(test_read_map.read_map).mockReturnValue(undefined)

		await expect(test_related.reaches_tests(ROOT, [])).resolves.toBe(false)
	})

	it('answers true when no map can be read', async () => {
		vi.mocked(test_read_map.read_map).mockReturnValue(undefined)

		await expect(test_related.reaches_tests(ROOT, [UNREAD_DOCUMENT])).resolves.toBe(true)
	})

	it('answers true when the map was recorded on a tree git can no longer diff against', async () => {
		mocked_since.mockRejectedValue(new Error('bad revision'))

		await expect(test_related.reaches_tests(ROOT, [UNREAD_DOCUMENT])).resolves.toBe(true)
	})

	// joshuafolkken/kit#4532, joshuafolkken/kit#4896: code changed since the map — a test among it —
	// reaches only through naming what moved.
	it('answers false when a test changed since the map names no moved file', async () => {
		mocked_since.mockResolvedValue([READER])

		await expect(test_related.reaches_tests(ROOT, [UNREAD_DOCUMENT])).resolves.toBe(false)
	})

	it('answers true when a source changed since the map names a moved file', async () => {
		mocked_since.mockResolvedValue([NAMING_SOURCE])

		await expect(test_related.reaches_tests(ROOT, [NAMED_DOCUMENT])).resolves.toBe(true)
	})
})

// joshuafolkken/kit#4425: the lane's own uncommitted code the map was recorded over is no change
// since the map, so a gate whose unit inputs did not move reuses its green unit step.
function map_dirty_with(digest: string): void {
	vi.mocked(test_read_map.read_map).mockReturnValue({ ...MAP, dirty: { [SOURCE]: digest } })
	mocked_since.mockResolvedValue([SOURCE])
}

describe('test_related.reaches_tests — code dirty when the map was recorded', () => {
	it('answers false while that code holds the content the map was recorded on', async () => {
		map_dirty_with(input_fingerprint.of_file(path.join(ROOT, SOURCE)))

		await expect(test_related.reaches_tests(ROOT, [UNREAD_DOCUMENT])).resolves.toBe(false)
	})

	// joshuafolkken/kit#4532: what moved since the green unit step is `paths`; that code is not in it.
	it('answers false once that code moved since the map, while it names no moved file', async () => {
		map_dirty_with('digest-then')

		await expect(test_related.reaches_tests(ROOT, [UNREAD_DOCUMENT])).resolves.toBe(false)
	})

	it('answers true for a moved file a recorded test reads, whatever the dirty code', async () => {
		map_dirty_with(input_fingerprint.of_file(path.join(ROOT, SOURCE)))

		await expect(test_related.reaches_tests(ROOT, [READ_DOCUMENT])).resolves.toBe(true)
	})
})
