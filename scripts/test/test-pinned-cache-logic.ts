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
// **Past those tree-wide digests, a verdict also holds while its own `basis` is the same**
// (joshuafolkken/kit#4873): for a `red`, the base commit, the changed non-code and whole-suite files,
// and each failed test's import closure; for any other, the tests whose imports reach the hunk's file,
// with their content. An edit outside them keeps the verdict; with no basis — no import graph, no
// failed file recorded — only the tree-wide digests hold it, as before.
// **A `red` verdict also holds while `pruned` reads the same** (joshuafolkken/kit#5004): the code
// change since differs only by lines removed from `green` hunks (`test-pinned-prune-logic.ts`).
// **Past all of those, a verdict is rechecked rather than probed whole** (`recheck_of`).

const DIGEST_ALGORITHM = 'sha256'
const LINE_BREAK = '\n'
const VERDICTS = ['red', 'green', 'no-test', 'test-only'] as const

// A hunk's verdict, with the content digest of each test file that failed on it and what it rests on.
// `related` is a `green` or `no-test` basis's own tests with their digests, so a later run can tell
// which of them were added or edited (joshuafolkken/kit#4936).
interface StoredVerdict {
	verdict: RedVerdict
	tests: Record<string, string>
	basis?: string | undefined
	related?: Record<string, string> | undefined
}

// What a verdict rests on now: its `basis` digest, and for a `green` or `no-test` one its tests.
interface Basis {
	digest: string
	related?: Record<string, string> | undefined
}

// A `green` or `no-test` verdict that holds once `recheck` — the tests added or edited since, among
// those reaching its hunk — stays green with the hunk reverted (joshuafolkken/kit#4936), or a `red`
// one once the tests it failed in still fail (joshuafolkken/kit#5129).
interface Recheck {
	verdict: RedVerdict
	recheck: ReadonlyArray<string>
}

// What the cache knows of a hunk: a verdict, one to recheck against a few tests, or nothing.
type Known = RedProbe | Recheck | undefined

// A `green` hunk as the cache records it: its file, its base lines and the lines it held.
interface GreenHunk {
	file: string
	old_lines: Array<string>
	new_lines: Array<string>
}

// `pruned` is the code change with every `green` hunk in `green` reverted.
interface VerdictCache {
	test_contents: string
	change: string
	entries: Record<string, StoredVerdict>
	pruned?: string | undefined
	green?: Array<GreenHunk> | undefined
}

// What the work tree holds now, set against what the cache was written under.
interface Freshness {
	is_same_change: boolean
	is_unchanged: boolean
	is_pruned: boolean
}

const STORED_SCHEMA = z.object({
	verdict: z.enum(VERDICTS),
	tests: z.record(z.string(), z.string()),
	basis: z.string().optional(),
	related: z.record(z.string(), z.string()).optional(),
})
const GREEN_SCHEMA = z.object({
	file: z.string(),
	old_lines: z.array(z.string()),
	new_lines: z.array(z.string()),
})
const CACHE_SCHEMA = z.object({
	test_contents: z.string(),
	change: z.string(),
	entries: z.record(z.string(), STORED_SCHEMA),
	pruned: z.string().optional(),
	green: z.array(GREEN_SCHEMA).optional(),
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

// The `green` hunks the cache recorded; an unreadable cache recorded none.
function greens_of(text: string): Array<GreenHunk> {
	return json_value.parse_with(text, CACHE_SCHEMA)?.green ?? []
}

// How `text` was written against the work tree now; an unreadable cache was written under nothing, and
// one with no `pruned` recorded never reads the same as one pruned now.
function freshness_of(
	text: string,
	now: Pick<VerdictCache, 'change' | 'pruned' | 'test_contents'>,
): Freshness {
	const cache = json_value.parse_with(text, CACHE_SCHEMA)

	return {
		is_same_change: cache?.change === now.change,
		is_unchanged: cache?.test_contents === now.test_contents,
		is_pruned: cache?.pruned !== undefined && cache.pruned === now.pruned,
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

// The entry was stored with a basis, and what it rests on reads the same now.
function is_based(entry: StoredVerdict, basis: string | undefined): boolean {
	return entry.basis !== undefined && entry.basis === basis
}

// The code a `red` verdict was reached on reads the same, or differs only by lines removed from `green`
// hunks.
function is_same_code(freshness: Freshness): boolean {
	return freshness.is_same_change || freshness.is_pruned
}

function holds(
	entry: StoredVerdict,
	freshness: Freshness,
	digests: ReadonlyMap<string, string>,
	basis: string | undefined,
): boolean {
	if (entry.verdict !== 'red') return freshness.is_unchanged || is_based(entry, basis)
	const is_same = is_same_code(freshness) || is_based(entry, basis)

	return is_same && holds_tests(entry.tests, freshness, digests)
}

// The stored verdict while what it rests on is unchanged: the code change and the failed test files for
// `red`, every test file for any other — or, past either, its own `basis` read now. `digests` holds each
// test file's content digest now.
function fresh_verdict(
	entry: StoredVerdict | undefined,
	freshness: Freshness,
	digests: ReadonlyMap<string, string>,
	basis?: string,
): RedProbe | undefined {
	if (entry === undefined || !holds(entry, freshness, digests, basis)) return undefined

	return { verdict: entry.verdict, failed: Object.keys(entry.tests) }
}

// A `green` or `no-test` verdict's basis: each test whose imports reach the hunk's file, with its content.
function related_basis(tests: ReadonlyArray<string>, digests: ReadonlyMap<string, string>): Basis {
	const pairs = sorted(tests).map((file) => [file, digests.get(file) ?? ''] as const)

	return { digest: digest_of(JSON.stringify(pairs)), related: Object.fromEntries(pairs) }
}

// The tests added or edited since `before` was read; `undefined` once one of its tests is gone or no
// longer reaches the hunk, which only a run over every reaching test can answer.
function changed_tests(
	before: Record<string, string>,
	now: Record<string, string>,
): Array<string> | undefined {
	if (Object.keys(before).some((file) => now[file] === undefined)) return undefined

	return Object.keys(now).filter((file) => before[file] !== now[file])
}

function recheck_tests(entry: StoredVerdict, basis: Basis | undefined): Array<string> | undefined {
	if (entry.related === undefined || basis?.related === undefined) return undefined

	return changed_tests(entry.related, basis.related)
}

// A `red` verdict rechecked against the test files it failed in, while each is still there
// (joshuafolkken/kit#5129); none where no failed file was recorded.
function failed_recheck(
	entry: StoredVerdict,
	digests: ReadonlyMap<string, string>,
): Recheck | undefined {
	const failed = Object.keys(entry.tests)
	if (failed.length === 0 || failed.some((file) => !digests.has(file))) return undefined

	return { verdict: entry.verdict, recheck: failed }
}

// A `red` verdict past its basis is rechecked against its failed tests: one still failing pins the hunk
// on the tree now, whatever moved (`rechecked`), so an edit to a doc no import names re-runs a few tests,
// not every test reaching a hub file. A `green` or `no-test` one whose code change is the same is
// rechecked against only the tests added or edited since; a source change, a removed test or no recorded
// tests reruns every reaching test. `digests` holds each test file's content digest now.
function recheck_of(
	entry: StoredVerdict,
	freshness: Freshness,
	basis: Basis | undefined,
	digests: ReadonlyMap<string, string>,
): Recheck | undefined {
	if (entry.verdict === 'red') return failed_recheck(entry, digests)
	if (!freshness.is_same_change) return undefined
	const recheck = recheck_tests(entry, basis) ?? []

	return recheck.length === 0 ? undefined : { verdict: entry.verdict, recheck }
}

// The verdict a recheck answers: a red test pins the hunk; otherwise the stored verdict stands, raised
// to `green` when a stored `no-test` now has a test that ran. A `red` one whose tests no longer fail
// answers nothing — only a run over every reaching test can — and a stopped run answers as it stopped.
function rechecked(known: Recheck, probe: RedProbe): RedProbe | undefined {
	if (known.verdict !== 'red') {
		return probe.verdict === 'no-test' ? { verdict: known.verdict, failed: [] } : probe
	}

	return probe.verdict === 'green' || probe.verdict === 'no-test' ? undefined : probe
}

function is_recheck(known: Known): known is Recheck {
	return known !== undefined && 'recheck' in known
}

// A `red` verdict's basis: the base commit with the changed files no import graph follows (`assets`,
// a `change_of` digest), and each failed test's import closure.
function red_basis(assets: string, closures: ReadonlyArray<readonly [string, string]>): string {
	const named = closures.toSorted(([left], [right]) => left.localeCompare(right))

	return digest_of(JSON.stringify([assets, named]))
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

function stored_of(
	probe: RedProbe,
	digests: ReadonlyMap<string, string>,
	basis: Basis | undefined,
): StoredVerdict {
	const entry = { verdict: probe.verdict, tests: tests_of(probe.failed, digests) }
	if (basis === undefined) return entry

	return basis.related === undefined
		? { ...entry, basis: basis.digest }
		: { ...entry, basis: basis.digest, related: basis.related }
}

// The verdicts to write back, keyed, each with its basis where one was read; a key with no verdict is
// left out. A `stopped` verdict is left out too: the config that decides it is not a test file the
// freshness rules watch, so a stale one would set the hunk aside after the config is fixed — it is
// probed again on every run (#5043).
function stored(
	keys: ReadonlyArray<string>,
	probes: ReadonlyArray<RedProbe | undefined>,
	digests: ReadonlyMap<string, string>,
	bases: ReadonlyArray<Basis | undefined> = [],
): Record<string, StoredVerdict> {
	const pairs = keys.flatMap((key, index) => {
		const probe = probes[index]
		if (probe === undefined || probe.verdict === 'stopped') return []

		return [[key, stored_of(probe, digests, bases[index])] as const]
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
	greens_of,
	hunk_key,
	is_recheck,
	recheck_of,
	rechecked,
	red_basis,
	related_basis,
	stored,
	tests_of,
	test_set_of,
}

export type { Basis, Freshness, GreenHunk, Known, Recheck, StoredVerdict, VerdictCache }
export { test_pinned_cache_logic }
