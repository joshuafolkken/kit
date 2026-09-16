import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
	CSPELL_CACHE_FILE,
	ESLINT_CACHE_FILE,
	GATE_CACHE_FILES,
	TS_BUILD_INFO_FILE,
} from '#scripts/josh/josh-command-types'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { lane_cache } from './lane-cache'

// joshuafolkken/kit#1849: a fresh lane copies the gate's content-addressed caches from the main
// checkout so its first `josh gate` is warm. A tool runs against its per-lane file, then atomically
// publishes the whole cache to main; overlapping publications intentionally use last-writer-wins.

const scratch = mkdtempSync(path.join(tmpdir(), 'lane-cache-test-'))
const SOURCE = path.join(scratch, 'main')
const DESTINATION = path.join(scratch, 'lane')
const SECOND_DESTINATION = path.join(scratch, 'second-lane')

// A definite cache name at `index`: the suite needs one or two specific files, and indexing the
// readonly list directly is `string | undefined` under the strict index check.
function cache_at(index: number): string {
	const cache_file = GATE_CACHE_FILES[index]

	if (cache_file === undefined) throw new Error(`no gate cache file at index ${String(index)}`)

	return cache_file
}

function cache_content(cache_file: string, root: string, content: string): string {
	return cache_file === ESLINT_CACHE_FILE
		? JSON.stringify([path.join(root, content)])
		: JSON.stringify(content)
}

function source_cache(cache_file: string, content: string): void {
	writeFileSync(path.join(SOURCE, cache_file), cache_content(cache_file, SOURCE, content))
}

function is_in_destination(cache_file: string): boolean {
	return existsSync(path.join(DESTINATION, cache_file))
}

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

beforeEach(() => {
	rmSync(SOURCE, { force: true, recursive: true })
	rmSync(DESTINATION, { force: true, recursive: true })
	rmSync(SECOND_DESTINATION, { force: true, recursive: true })
	mkdirSync(SOURCE, { recursive: true })
	mkdirSync(DESTINATION, { recursive: true })
	mkdirSync(SECOND_DESTINATION, { recursive: true })
})

describe("seeding a lane's verification caches", () => {
	it('copies every gate cache the main checkout has', () => {
		for (const cache_file of GATE_CACHE_FILES) source_cache(cache_file, `warm:${cache_file}`)

		lane_cache.seed_caches(SOURCE, DESTINATION)

		for (const cache_file of GATE_CACHE_FILES) {
			expect(readFileSync(path.join(DESTINATION, cache_file), 'utf8')).toBe(
				cache_content(cache_file, DESTINATION, `warm:${cache_file}`),
			)
		}
	})

	it('rebases absolute paths inside an eslint cache', () => {
		const relative_file = path.join('scripts', 'lint', 'lint-parallel.ts')

		source_cache(ESLINT_CACHE_FILE, relative_file)

		lane_cache.seed_caches(SOURCE, DESTINATION)

		const copied = readFileSync(path.join(DESTINATION, ESLINT_CACHE_FILE), 'utf8')

		expect(copied).toContain(path.join(DESTINATION, relative_file))
		expect(copied).not.toContain(path.join(SOURCE, relative_file))
	})
})

describe('continuous lane cache sharing', () => {
	it('continuously shares each declared portable cache', () => {
		for (const cache_file of GATE_CACHE_FILES) source_cache(cache_file, `shared:${cache_file}`)

		lane_cache.sync_cache(SOURCE, DESTINATION, ESLINT_CACHE_FILE)
		lane_cache.sync_cache(SOURCE, DESTINATION, CSPELL_CACHE_FILE)

		expect(is_in_destination(ESLINT_CACHE_FILE)).toBe(true)
		expect(is_in_destination(CSPELL_CACHE_FILE)).toBe(true)
		expect(is_in_destination(TS_BUILD_INFO_FILE)).toBe(false)
		expect(readFileSync(path.join(DESTINATION, CSPELL_CACHE_FILE), 'utf8')).toBe(
			readFileSync(path.join(SOURCE, CSPELL_CACHE_FILE), 'utf8'),
		)
	})

	it('keeps an existing cache when the incoming eslint cache is invalid', () => {
		const destination_cache = path.join(DESTINATION, ESLINT_CACHE_FILE)

		writeFileSync(path.join(SOURCE, ESLINT_CACHE_FILE), 'not json')
		writeFileSync(destination_cache, 'existing')

		lane_cache.sync_cache(SOURCE, DESTINATION, ESLINT_CACHE_FILE)

		expect(readFileSync(destination_cache, 'utf8')).toBe('existing')
	})
})

describe('concurrent lane cache publication', () => {
	it('atomically keeps the last completed lane cache', () => {
		const relative_file = path.join('scripts', 'shared.ts')

		writeFileSync(
			path.join(DESTINATION, ESLINT_CACHE_FILE),
			JSON.stringify([path.join(DESTINATION, relative_file), 'first']),
		)
		writeFileSync(
			path.join(SECOND_DESTINATION, ESLINT_CACHE_FILE),
			JSON.stringify([path.join(SECOND_DESTINATION, relative_file), 'second']),
		)

		lane_cache.sync_cache(DESTINATION, SOURCE, ESLINT_CACHE_FILE)
		lane_cache.sync_cache(SECOND_DESTINATION, SOURCE, ESLINT_CACHE_FILE)

		const published = readFileSync(path.join(SOURCE, ESLINT_CACHE_FILE), 'utf8')

		expect(published).toContain(path.join(SOURCE, relative_file))
		expect(published).toContain('second')
		expect(published).not.toContain('first')
	})
})

describe('best-effort lane cache seeding', () => {
	// A checkout that has never run the gate has some caches and not others; the present ones still
	// seed and the absent ones are skipped rather than failing the copy.
	it('skips a cache the main checkout does not have, copying the rest', () => {
		const present = cache_at(0)
		const absent = cache_at(1)

		source_cache(present, 'warm')

		lane_cache.seed_caches(SOURCE, DESTINATION)

		expect(is_in_destination(present)).toBe(true)
		expect(is_in_destination(absent)).toBe(false)
	})

	it('copies nothing when the main checkout has no caches at all', () => {
		lane_cache.seed_caches(SOURCE, DESTINATION)

		for (const cache_file of GATE_CACHE_FILES) expect(is_in_destination(cache_file)).toBe(false)
	})

	// The copy is an independent file, so a lane rewriting its own cache cannot reach back into the
	// main checkout's or another lane's — which is what makes warming safe under the fan-out.
	it('copies into a file independent of the source', () => {
		const cache_file = cache_at(0)

		source_cache(cache_file, 'original')

		lane_cache.seed_caches(SOURCE, DESTINATION)
		writeFileSync(path.join(DESTINATION, cache_file), 'rewritten by the lane')

		expect(readFileSync(path.join(SOURCE, cache_file), 'utf8')).toBe(
			cache_content(cache_file, SOURCE, 'original'),
		)
	})

	// Warming must never fail the open: a destination that is not there is skipped, not thrown.
	it('does not throw when the destination directory is missing', () => {
		source_cache(cache_at(0), 'warm')

		expect(() => {
			lane_cache.seed_caches(SOURCE, path.join(scratch, 'no-such-lane'))
		}).not.toThrow()
	})
})
