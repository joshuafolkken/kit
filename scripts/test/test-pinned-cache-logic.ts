import { createHash } from 'node:crypto'
import path from 'node:path'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import type { Hunk } from './test-pinned-logic'
import type { RedVerdict } from './test-red-logic'

// The pure half of `josh test:pinned`'s verdict cache (joshuafolkken/kit#4706): the key a hunk's verdict
// is stored under, and whether a stored one still holds. The reads and writes are `test-pinned-cache.ts`.
//
// **A verdict is keyed by the hunk's own lines, never its position**, so a hunk that only moved — an
// edit above it in the same file — keeps its verdict, and only the hunk that changed is checked again.
// **A `red` verdict holds while every test file that ran for it is unchanged.** A `green` or `no-test`
// one names no test that reaches the hunk, so the test that comes to reach it can be any test file:
// it holds only while no test file's content changed (`test_contents`). A test file added or removed
// anywhere drops the whole cache (`test_set`).

const DIGEST_ALGORITHM = 'sha256'
const LINE_BREAK = '\n'
const VERDICTS = ['red', 'green', 'no-test', 'test-only'] as const

// One stored verdict, with the digest of each test file that ran for it.
interface CachedVerdict {
	verdict: RedVerdict
	tests: Record<string, string>
}

interface VerdictCache {
	test_set: string
	test_contents: string
	entries: Record<string, CachedVerdict>
}

const CACHED_VERDICT_SCHEMA = z.object({
	verdict: z.enum(VERDICTS),
	tests: z.record(z.string(), z.string()),
})
const CACHE_SCHEMA = z.object({
	test_set: z.string(),
	test_contents: z.string(),
	entries: z.record(z.string(), CACHED_VERDICT_SCHEMA),
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

// The sorted test file paths, so the set reads the same whatever order git listed them in.
function test_set_of(test_files: ReadonlyArray<string>): string {
	return digest_of(test_files.toSorted((left, right) => left.localeCompare(right)).join(LINE_BREAK))
}

// An unreadable cache, or one written under another set of test files, holds nothing.
function entries_of(text: string, test_set: string): Record<string, CachedVerdict> {
	const cache = json_value.parse_with(text, CACHE_SCHEMA)

	return cache?.test_set === test_set ? cache.entries : {}
}

// The test contents the cache was written under; an unreadable cache was written under none.
function contents_of(text: string): string {
	return json_value.parse_with(text, CACHE_SCHEMA)?.test_contents ?? ''
}

// Each absolute name relative to the first of `roots` it sits under; a name under none is dropped.
// A verdict's tests are keyed relative so the key holds across the throwaway trees it ran in.
function tree_relative(names: ReadonlyArray<string>, roots: ReadonlyArray<string>): Array<string> {
	return names.flatMap((name) => {
		const inside = roots.map((root) => path.relative(root, name))

		return inside.filter((relative) => !relative.startsWith('..')).slice(0, 1)
	})
}

// A `red` run that named the tests it ran; any other verdict rests on every test file.
function rests_on_own_tests(entry: CachedVerdict): boolean {
	return entry.verdict === 'red' && Object.keys(entry.tests).length > 0
}

function has_own_digests(entry: CachedVerdict, digests: ReadonlyMap<string, string>): boolean {
	return Object.entries(entry.tests).every(([file, digest]) => digests.get(file) === digest)
}

// The stored entry while the tests it rests on are unchanged: for a `red` one, each test file it ran
// still has the digest it had then; for any other, `is_unchanged` — no test file's content changed.
function fresh_entry(
	entry: CachedVerdict | undefined,
	digests: ReadonlyMap<string, string>,
	is_unchanged: boolean,
): CachedVerdict | undefined {
	if (entry === undefined) return undefined
	const is_fresh = rests_on_own_tests(entry) ? has_own_digests(entry, digests) : is_unchanged

	return is_fresh ? entry : undefined
}

// The entries to write back, keyed; a key with no entry is left out.
function stored(
	keys: ReadonlyArray<string>,
	entries: ReadonlyArray<CachedVerdict | undefined>,
): Record<string, CachedVerdict> {
	const pairs = keys.map((key, index) => [key, entries[index]] as const)

	return Object.fromEntries(
		pairs.filter((pair): pair is readonly [string, CachedVerdict] => pair[1] !== undefined),
	)
}

const test_pinned_cache_logic = {
	digest_of,
	contents_of,
	distinct,
	entries_of,
	fresh_entry,
	hunk_key,
	stored,
	test_set_of,
	tree_relative,
}

export type { CachedVerdict, VerdictCache }
export { test_pinned_cache_logic }
