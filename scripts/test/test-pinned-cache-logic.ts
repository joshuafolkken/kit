import { createHash } from 'node:crypto'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import type { Hunk } from './test-pinned-logic'
import type { RedProbe, RedVerdict } from './test-red-logic'

// The pure half of `josh test:pinned`'s verdict cache (joshuafolkken/kit#4706): the key a hunk's verdict
// is stored under, and whether a stored one still holds. The reads and writes are `test-pinned-cache.ts`.
//
// **A verdict is keyed by the hunk's own lines, never its position**, so a hunk that only moved — an
// edit above it in the same file — keeps its verdict.
// **A `red` verdict holds while the code change and the test files it failed in are the same**
// (`change`: the base commit and the content of every non-test path changed since it, a run's own
// record under `.josh/` left out since no test reads one, joshuafolkken/kit#4856; `tests`: the
// content digest of each failed test file, joshuafolkken/kit#4790). A hunk goes red on the tree with
// only it reverted, so a fixture, a config or another source file can decide it — a test that already
// failed before the revert reads red too — and a red kept past any of those, or past an edit to the test
// that failed, would pass an unpinned hunk. A test added or edited elsewhere cannot make that test
// pass, so it keeps the red. A red with no failed file recorded holds only while no test file changed either.
// **A `green` or `no-test` one holds while no test file's path or content changed** (`test_contents`):
// it is only rechecked when a test could have come to reach it, and a stale one stops a lane rather
// than passing it.

const DIGEST_ALGORITHM = 'sha256'
const LINE_BREAK = '\n'
const VERDICTS = ['red', 'green', 'no-test', 'test-only'] as const

// A hunk's verdict, with the content digest of each test file that failed on it.
interface StoredVerdict {
	verdict: RedVerdict
	tests: Record<string, string>
}

interface VerdictCache {
	test_contents: string
	change: string
	entries: Record<string, StoredVerdict>
}

// What the work tree holds now, set against what the cache was written under.
interface Freshness {
	is_same_change: boolean
	is_unchanged: boolean
}

const STORED_SCHEMA = z.object({
	verdict: z.enum(VERDICTS),
	tests: z.record(z.string(), z.string()),
})
const CACHE_SCHEMA = z.object({
	test_contents: z.string(),
	change: z.string(),
	entries: z.record(z.string(), STORED_SCHEMA),
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

// An unreadable cache holds nothing.
function entries_of(text: string): Record<string, StoredVerdict> {
	return json_value.parse_with(text, CACHE_SCHEMA)?.entries ?? {}
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

// Each failed test file still holds the content it failed with; with none recorded, no test file changed.
function holds_tests(
	tests: Record<string, string>,
	freshness: Freshness,
	digests: ReadonlyMap<string, string>,
): boolean {
	const files = Object.entries(tests)
	if (files.length === 0) return freshness.is_unchanged

	return files.every(([file, digest]) => digests.get(file) === digest)
}

function holds(
	entry: StoredVerdict,
	freshness: Freshness,
	digests: ReadonlyMap<string, string>,
): boolean {
	if (entry.verdict !== 'red') return freshness.is_unchanged

	return freshness.is_same_change && holds_tests(entry.tests, freshness, digests)
}

// The stored verdict while what it rests on is unchanged: the code change and the failed test files for
// `red`, every test file for any other. `digests` holds each test file's content digest now.
function fresh_verdict(
	entry: StoredVerdict | undefined,
	freshness: Freshness,
	digests: ReadonlyMap<string, string>,
): RedProbe | undefined {
	if (entry === undefined || !holds(entry, freshness, digests)) return undefined

	return { verdict: entry.verdict, failed: Object.keys(entry.tests) }
}

// Each failed file with its digest now; a failed file with none — not a test file this cache digests —
// records none, so the verdict rests on every test file instead.
function tests_of(
	failed: ReadonlyArray<string>,
	digests: ReadonlyMap<string, string>,
): Record<string, string> {
	const pairs = failed.flatMap((file) => {
		const digest = digests.get(file)

		return digest === undefined ? [] : [[file, digest] as const]
	})

	return pairs.length === failed.length ? Object.fromEntries(pairs) : {}
}

// The verdicts to write back, keyed; a key with no verdict is left out.
function stored(
	keys: ReadonlyArray<string>,
	probes: ReadonlyArray<RedProbe | undefined>,
	digests: ReadonlyMap<string, string>,
): Record<string, StoredVerdict> {
	const pairs = keys.flatMap((key, index) => {
		const probe = probes[index]
		if (probe === undefined) return []

		return [[key, { verdict: probe.verdict, tests: tests_of(probe.failed, digests) }] as const]
	})

	return Object.fromEntries(pairs)
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

export type { Freshness, StoredVerdict, VerdictCache }
export { test_pinned_cache_logic }
