import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
	type PathLike,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CSPELL_CACHE_FILE, ESLINT_CACHE_FILE } from '#scripts/josh/josh-command-types'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#3763: prettier walks the checkout while the cache copy is in flight, so the
// copy's temporary file must never be listed in a directory a tree scan reads. The rename is the one
// instant the staging file is guaranteed to exist, so each test lists the tree from inside it.

const before_rename = vi.hoisted(() => vi.fn<() => void>())

vi.mock(import('node:fs'), async (import_original) => {
	const actual = await import_original()

	function rename_after_probe(old_path: PathLike, new_path: PathLike): void {
		before_rename()
		actual.renameSync(old_path, new_path)
	}

	return { ...actual, renameSync: rename_after_probe }
})

const { lane_cache } = await import('./lane-cache')

const scratch = mkdtempSync(path.join(tmpdir(), 'lane-cache-staging-test-'))
const MAIN = path.join(scratch, 'main')
const LANE = path.join(scratch, 'lane')
const STAGING_ROOT = 'node_modules'
const CACHE_BODY = JSON.stringify('cached')

function staging_directory(root: string): string {
	return path.join(root, ...lane_cache.STAGING_SEGMENTS)
}

function listed_during_copy(root: string): Array<Array<string>> {
	const listings: Array<Array<string>> = []

	before_rename.mockImplementation(function list_scanned_tree(): void {
		listings.push(readdirSync(root))
	})

	return listings
}

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

beforeEach(() => {
	before_rename.mockReset()

	rmSync(MAIN, { force: true, recursive: true })
	rmSync(LANE, { force: true, recursive: true })
	mkdirSync(MAIN, { recursive: true })
	mkdirSync(LANE, { recursive: true })
})

describe('the tree a scan reads while a lane cache is copied', () => {
	it.each([ESLINT_CACHE_FILE, CSPELL_CACHE_FILE])(
		'lists no temporary file in the lane while %s is refreshed from main',
		(cache_file) => {
			writeFileSync(path.join(MAIN, cache_file), CACHE_BODY)
			const listings = listed_during_copy(LANE)

			lane_cache.sync_cache(MAIN, LANE, cache_file)

			expect(listings).toEqual([[STAGING_ROOT]])
			expect(readFileSync(path.join(LANE, cache_file), 'utf8')).toBe(CACHE_BODY)
		},
	)

	it.each([ESLINT_CACHE_FILE, CSPELL_CACHE_FILE])(
		'lists no temporary file in main while %s is published from the lane',
		(cache_file) => {
			writeFileSync(path.join(LANE, cache_file), CACHE_BODY)
			const listings = listed_during_copy(MAIN)

			lane_cache.sync_cache(LANE, MAIN, cache_file)

			expect(listings).toEqual([[STAGING_ROOT]])
			expect(readFileSync(path.join(MAIN, cache_file), 'utf8')).toBe(CACHE_BODY)
		},
	)

	it('stages the copy under the ignored dependency directory and leaves nothing behind', () => {
		writeFileSync(path.join(MAIN, CSPELL_CACHE_FILE), CACHE_BODY)
		const staged: Array<Array<string>> = []

		before_rename.mockImplementation(function list_staging(): void {
			staged.push(readdirSync(staging_directory(LANE)))
		})

		lane_cache.sync_cache(MAIN, LANE, CSPELL_CACHE_FILE)

		expect(staged).toHaveLength(1)
		expect(staged[0]).toEqual([expect.stringMatching(/^\.cspellcache\..+\.tmp$/u)])
		expect(readdirSync(staging_directory(LANE))).toEqual([])
	})
})

describe('a lane cache copy that cannot be published', () => {
	it('keeps the existing cache and removes its staging file when the rename fails', () => {
		const destination_cache = path.join(LANE, CSPELL_CACHE_FILE)

		writeFileSync(path.join(MAIN, CSPELL_CACHE_FILE), CACHE_BODY)
		writeFileSync(destination_cache, 'existing')

		before_rename.mockImplementation(function fail_rename(): never {
			throw new Error('EXDEV: cross-device link not permitted')
		})

		expect(() => {
			lane_cache.sync_cache(MAIN, LANE, CSPELL_CACHE_FILE)
		}).not.toThrow()

		expect(readFileSync(destination_cache, 'utf8')).toBe('existing')
		expect(readdirSync(staging_directory(LANE))).toEqual([])
	})

	it('does not create a checkout that is not there', () => {
		const missing_root = path.join(scratch, 'no-such-lane')

		writeFileSync(path.join(MAIN, CSPELL_CACHE_FILE), CACHE_BODY)

		lane_cache.sync_cache(MAIN, missing_root, CSPELL_CACHE_FILE)

		expect(existsSync(missing_root)).toBe(false)
	})
})
