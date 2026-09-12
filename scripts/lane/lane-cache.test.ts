import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { GATE_CACHE_FILES } from '#scripts/josh/josh-command-types'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { lane_cache } from './lane-cache'

// joshuafolkken/kit#1849: a fresh lane copies the gate's content-addressed caches from the main
// checkout so its first `josh gate` is warm. The copy is per-lane, never a shared file, which is
// what keeps parallel lanes from discarding each other's entries.

const scratch = mkdtempSync(path.join(tmpdir(), 'lane-cache-test-'))
const SOURCE = path.join(scratch, 'main')
const DESTINATION = path.join(scratch, 'lane')

// A definite cache name at `index`: the suite needs one or two specific files, and indexing the
// readonly list directly is `string | undefined` under the strict index check.
function cache_at(index: number): string {
	const cache_file = GATE_CACHE_FILES[index]

	if (cache_file === undefined) throw new Error(`no gate cache file at index ${String(index)}`)

	return cache_file
}

function source_cache(cache_file: string, content: string): void {
	writeFileSync(path.join(SOURCE, cache_file), content)
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
	mkdirSync(SOURCE, { recursive: true })
	mkdirSync(DESTINATION, { recursive: true })
})

describe("seeding a lane's verification caches", () => {
	it('copies every gate cache the main checkout has', () => {
		for (const cache_file of GATE_CACHE_FILES) source_cache(cache_file, `warm:${cache_file}`)

		lane_cache.seed_caches(SOURCE, DESTINATION)

		for (const cache_file of GATE_CACHE_FILES) {
			expect(readFileSync(path.join(DESTINATION, cache_file), 'utf8')).toBe(`warm:${cache_file}`)
		}
	})

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

		expect(readFileSync(path.join(SOURCE, cache_file), 'utf8')).toBe('original')
	})

	// Warming must never fail the open: a destination that is not there is skipped, not thrown.
	it('does not throw when the destination directory is missing', () => {
		source_cache(cache_at(0), 'warm')

		expect(() => {
			lane_cache.seed_caches(SOURCE, path.join(scratch, 'no-such-lane'))
		}).not.toThrow()
	})
})
