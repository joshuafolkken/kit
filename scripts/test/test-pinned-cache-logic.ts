import { createHash } from 'node:crypto'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import type { Hunk } from './test-pinned-logic'
import type { RedVerdict } from './test-red-logic'

// The pure half of `josh test:pinned`'s verdict cache (joshuafolkken/kit#4706): the key a hunk's verdict
// is stored under, and whether a stored one still holds. The reads and writes are `test-pinned-cache.ts`.
//
// **A verdict is keyed by the hunk's own lines, never its position**, so a hunk that only moved — an
// edit above it in the same file — keeps its verdict.
// **A `red` verdict holds only while the whole change is the same** (`change`: the base commit and the
// content of every path changed since it). A hunk goes red on the tree with only it reverted, so a
// fixture, a config or another source file can decide it — a test that already failed before the revert
// reads red too — and a red kept past any of those would pass an unpinned hunk.
// **A `green` or `no-test` one holds while no test file's content changed** (`test_contents`): it is
// only rechecked when a test could have come to reach it, and a stale one stops a lane rather than
// passing it. A test file added or removed anywhere drops the whole cache (`test_set`).

const DIGEST_ALGORITHM = 'sha256'
const LINE_BREAK = '\n'
const VERDICTS = ['red', 'green', 'no-test', 'test-only'] as const

interface VerdictCache {
	test_set: string
	test_contents: string
	change: string
	entries: Record<string, RedVerdict>
}

// What the work tree holds now, set against what the cache was written under.
interface Freshness {
	is_same_change: boolean
	is_unchanged: boolean
}

const CACHE_SCHEMA = z.object({
	test_set: z.string(),
	test_contents: z.string(),
	change: z.string(),
	entries: z.record(z.string(), z.enum(VERDICTS)),
})

function digest_of(text: string): string {
	return createHash(DIGEST_ALGORITHM).update(text).digest('hex')
}

// The hunk's file, its old lines, the lines it holds now in `content` and the probed function's name.
function hunk_key(hunk: Hunk, content: string): string {
	const start = hunk.new_start - 1
	const lines = content.split(LINE_BREAK).slice(start, start + hunk.new_count)

	return digest_of(JSON.stringify([hunk.file, hunk.function_name ?? '', hunk.old_lines, lines]))
}

// A key an identical hunk already took gets its occurrence number, so each keeps a verdict of its own.
function distinct(keys: ReadonlyArray<string>): Array<string> {
	return keys.map((key, index) => {
		const seen = keys.slice(0, index).filter((earlier) => earlier === key).length

		return seen === 0 ? key : `${key}:${String(seen)}`
	})
}

function sorted(names: ReadonlyArray<string>): Array<string> {
	return names.toSorted((left, right) => left.localeCompare(right))
}

// The sorted test file paths, so the set reads the same whatever order git listed them in.
function test_set_of(test_files: ReadonlyArray<string>): string {
	return digest_of(sorted(test_files).join(LINE_BREAK))
}

// The base commit and each changed path with its content's digest — a deleted path has none.
function change_of(
	commit: string,
	paths: ReadonlyArray<string>,
	digests: ReadonlyMap<string, string>,
): string {
	return digest_of(JSON.stringify([commit, sorted(paths).map((file) => [file, digests.get(file)])]))
}

// An unreadable cache, or one written under another set of test files, holds nothing.
function entries_of(text: string, test_set: string): Record<string, RedVerdict> {
	const cache = json_value.parse_with(text, CACHE_SCHEMA)

	return cache?.test_set === test_set ? cache.entries : {}
}

// How `text` was written against the work tree now; an unreadable cache was written under nothing.
function freshness_of(
	text: string,
	now: Pick<VerdictCache, 'change' | 'test_contents'>,
): Freshness {
	const cache = json_value.parse_with(text, CACHE_SCHEMA)

	return {
		is_same_change: cache?.change === now.change,
		is_unchanged: cache?.test_contents === now.test_contents,
	}
}

// The stored verdict while what it rests on is unchanged: the whole change for `red`, every test
// file's content for any other.
function fresh_verdict(
	verdict: RedVerdict | undefined,
	freshness: Freshness,
): RedVerdict | undefined {
	if (verdict === undefined) return undefined
	const is_fresh = verdict === 'red' ? freshness.is_same_change : freshness.is_unchanged

	return is_fresh ? verdict : undefined
}

// The verdicts to write back, keyed; a key with no verdict is left out.
function stored(
	keys: ReadonlyArray<string>,
	verdicts: ReadonlyArray<RedVerdict | undefined>,
): Record<string, RedVerdict> {
	const pairs = keys.map((key, index) => [key, verdicts[index]] as const)

	return Object.fromEntries(
		pairs.filter((pair): pair is readonly [string, RedVerdict] => pair[1] !== undefined),
	)
}

const test_pinned_cache_logic = {
	change_of,
	digest_of,
	distinct,
	entries_of,
	fresh_verdict,
	freshness_of,
	hunk_key,
	stored,
	test_set_of,
}

export type { Freshness, VerdictCache }
export { test_pinned_cache_logic }
