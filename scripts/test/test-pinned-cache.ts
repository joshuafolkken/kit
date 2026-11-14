import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { config_fingerprint } from '#eslint/config-fingerprint.js'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_spawn } from '#scripts/git/git-spawn'
import { run_record_path } from '#scripts/josh/run-record-path'
import { atomic_write } from '#scripts/lib/atomic-write'
import { test_declared_logic } from './test-declared-logic'
import {
	test_pinned_cache_logic,
	type Basis,
	type Freshness,
	type Known,
	type StoredVerdict,
	type VerdictCache,
} from './test-pinned-cache-logic'
import type { Hunk } from './test-pinned-logic'
import { test_pinned_prune_logic, type CodeChange } from './test-pinned-prune-logic'
import { test_pinned_reach, type Reach } from './test-pinned-reach'
import type { RedProbe } from './test-red-logic'
import { test_runner_config } from './test-runner-config'

// The reads and writes of `josh test:pinned`'s verdict cache (joshuafolkken/kit#4706); what a key is and
// when an entry holds is `test-pinned-cache-logic.ts`. `josh run:review` calls the same `test_pinned.run`,
// so the two share it.
//
// **The cache sits in the checkout's own git directory** (`git rev-parse --git-path`, per worktree), so
// a lane never reads another lane's verdicts, and nothing is written into the work tree.

const CACHE_NAME = 'josh-test-pinned-verdicts.json'
const LINE_BREAK = '\n'
// Peels a ref or tag to the commit it names, so a branch name and its SHA key the same change.
const AS_COMMIT = '^{commit}'

// `config` is one digest over the test runner's configuration files, which `test_contents` covers too.
interface TreeRead {
	test_digests: ReadonlyMap<string, string>
	code: CodeChange
	config: string
	test_contents: string
	change: string
}

// `hunks` are the run's own, and `contents` each of their files and each recorded `green` hunk's file
// as `load` read them, so `pruned` is written off the tree the verdicts were reached on.
interface LoadedCache extends VerdictCache {
	file: string
	base: string
	freshness: Freshness
	test_digests: ReadonlyMap<string, string>
	config: string
	reach: Reach
	code: CodeChange
	hunks: ReadonlyArray<Hunk>
	contents: ReadonlyMap<string, string>
}

// A verdict reached by a run, with the index of the key it answers.
type Reached = readonly [number, RedProbe]

interface CacheWriter {
	record: (reached: ReadonlyArray<Reached>) => Promise<void>
}

// The verdicts a run reached so far, each with the basis read when it was reached.
interface WriterState {
	cache: LoadedCache
	keys: ReadonlyArray<string>
	files: ReadonlyArray<string>
	probes: Array<RedProbe | undefined>
	bases: Array<Basis | undefined>
}

async function read_text(file: string): Promise<string> {
	return existsSync(file) ? await readFile(file, 'utf8') : ''
}

// The content of each named file the work tree still holds.
async function contents_of(files: ReadonlyArray<string>): Promise<Map<string, string>> {
	const existing = [...new Set(files)].filter((file) => existsSync(file))
	const texts = await Promise.all(existing.map(async (file) => await readFile(file, 'utf8')))

	return new Map(existing.map((file, index) => [file, texts[index] ?? '']))
}

// Every file in the work tree `is_kept` accepts, tracked or untracked but not ignored.
async function work_tree_files(is_kept: (file: string) => boolean): Promise<Array<string>> {
	const listed = await test_pinned_reach.work_tree_files()

	return listed.filter((file) => is_kept(file))
}

// The digest of each named file the work tree still holds.
async function digests_of(files: ReadonlyArray<string>): Promise<Map<string, string>> {
	const contents = await contents_of(files)

	return new Map(
		[...contents].map(([file, text]) => [file, test_pinned_cache_logic.digest_of(text)]),
	)
}

// Each work tree file's content digest `is_kept` accepts, keyed by its path.
async function kept_digests_of(is_kept: (file: string) => boolean): Promise<Map<string, string>> {
	return await digests_of(await work_tree_files(is_kept))
}

// Each test runner configuration file and every local module it imports — where an `include` list may
// sit, as `tools/test/vitest-include-globs.ts` does here — with its content digest.
async function config_digests_of(): Promise<Map<string, string>> {
	const configs = await work_tree_files((file) => test_runner_config.is_config(file))
	const reached = config_fingerprint.list_reachable_modules(
		configs.map((file) => path.resolve(file)),
	)

	return await digests_of([...reached].map((file) => path.relative(process.cwd(), file)))
}

// One digest over every test file's path and content.
function contents_digest(digests: ReadonlyMap<string, string>): string {
	return test_pinned_cache_logic.test_set_of(
		[...digests].map(([file, digest]) => `${file} ${digest}`),
	)
}

// The code change: `base` as a commit, and every non-test path changed since it with its content. A
// test file is left out — a `red` rests on the test files it failed in, not on every test — and so is
// a run record, which no test reads, so one written after a probe keeps its `red`
// (joshuafolkken/kit#4856, `run-record-path.ts`).
async function code_change(base: string): Promise<CodeChange> {
	const [commit, paths] = await Promise.all([
		git_spawn.read(['rev-parse', '--verify', `${base}${AS_COMMIT}`]),
		changed_paths.read_changed_since(base),
	])
	const code = paths.filter(
		(file) => !test_declared_logic.is_test_file(file) && !run_record_path.is_run_record(file),
	)

	return { commit: commit.trim(), code, digests: await digests_of(code) }
}

// The work tree's tree-wide digests, with what they were read off. A test runner configuration change
// can make a test run that never ran, so it moves `test_contents` as a test file would
// (joshuafolkken/kit#7521).
async function read_tree(base: string): Promise<TreeRead> {
	const [test_digests, configs, code] = await Promise.all([
		kept_digests_of((file) => test_declared_logic.is_test_file(file)),
		config_digests_of(),
		code_change(base),
	])
	const test_contents = contents_digest(new Map([...test_digests, ...configs]))
	const change = test_pinned_cache_logic.change_of(code.commit, code.code, code.digests)

	return { test_digests, code, config: contents_digest(configs), test_contents, change }
}

// The cache file's text and what the work tree holds now, with the files `hunks` and the recorded
// `green` hunks sit in.
async function read_all(
	file: string,
	base: string,
	hunks: ReadonlyArray<Hunk>,
): Promise<[string, TreeRead, Map<string, string>]> {
	const text = await read_text(file)
	const greens = test_pinned_cache_logic.greens_of(text)
	const files = [...hunks, ...greens].map((hunk) => hunk.file)

	return [text, ...(await Promise.all([read_tree(base), contents_of(files)]))]
}

// `hunks` are the ones this run checks; `pruned` is read now against the `green` hunks the cache recorded.
async function load(
	base: string,
	hunks: ReadonlyArray<Hunk>,
	cache_file?: string,
): Promise<LoadedCache> {
	const file =
		cache_file ?? path.resolve(await git_spawn.read(['rev-parse', '--git-path', CACHE_NAME]))
	const [text, tree, contents] = await read_all(file, base, hunks)
	const { test_digests, code, test_contents, change } = tree
	const greens = test_pinned_cache_logic.greens_of(text)
	const remnants = test_pinned_prune_logic.remnants_of(hunks, greens)
	const pruned = test_pinned_prune_logic.pruned_of(code, contents, remnants, greens)
	const freshness = test_pinned_cache_logic.freshness_of(text, { change, pruned, test_contents })
	const reach = test_pinned_reach.create({ ...code, test_digests })
	const entries = test_pinned_cache_logic.entries_of(text)

	return { file, base, ...tree, entries, freshness, reach, hunks, contents }
}

// What a verdict on a hunk of `file` rests on now: the failed tests' closures for a `red`, the tests
// reaching `file` for any other.
async function basis_of(
	cache: LoadedCache,
	probe: RedProbe,
	file: string,
): Promise<Basis | undefined> {
	if (probe.verdict !== 'red') {
		const tests = await cache.reach.related(file)

		return tests && test_pinned_cache_logic.related_basis(tests, cache.test_digests, cache.config)
	}

	const digest = await cache.reach.failed(probe.failed)

	return digest === undefined ? undefined : { digest }
}

// The tree-wide digests first; only an entry they drop has its basis read, so an unchanged tree builds
// no import graph. Past the basis, it may still be rechecked against a few tests (`recheck_of`).
async function known_by_basis(
	cache: LoadedCache,
	entry: StoredVerdict,
	file: string,
): Promise<Known> {
	const { freshness, test_digests } = cache
	const stored = { verdict: entry.verdict, failed: Object.keys(entry.tests) }
	const basis = await basis_of(cache, stored, file)
	const held = test_pinned_cache_logic.fresh_verdict(entry, freshness, test_digests, basis?.digest)

	return held ?? test_pinned_cache_logic.recheck_of(entry, freshness, basis, test_digests)
}

// An entry stored with no basis is not held past the tree-wide digests, but a `red` one is still
// rechecked against its failed tests.
async function known_one(cache: LoadedCache, key: string, file: string): Promise<Known> {
	const { freshness, test_digests } = cache
	const entry = cache.entries[key]
	const kept = test_pinned_cache_logic.fresh_verdict(entry, freshness, test_digests)
	if (kept !== undefined || entry === undefined) return kept

	if (entry.basis === undefined) {
		return test_pinned_cache_logic.recheck_of(entry, freshness, undefined, test_digests)
	}

	return await known_by_basis(cache, entry, file)
}

// What the cache knows of each key: its stored verdict, one to recheck, or `undefined` where none is
// stored or what it rests on changed; `files` names each key's hunk file.
async function known(
	cache: LoadedCache,
	keys: ReadonlyArray<string>,
	files: ReadonlyArray<string>,
): Promise<Array<Known>> {
	return await Promise.all(
		keys.map(async (key, index) => await known_one(cache, key, files[index] ?? '')),
	)
}

// A verdict the tree-wide digests still hold keeps its stored basis; any other has its own read now.
async function stored_basis(
	cache: LoadedCache,
	key: string,
	probe: RedProbe,
	file: string,
): Promise<Basis | undefined> {
	const entry = cache.entries[key]
	const kept = test_pinned_cache_logic.fresh_verdict(entry, cache.freshness, cache.test_digests)

	if (kept?.verdict === probe.verdict && entry?.basis !== undefined) {
		return { digest: entry.basis, related: entry.related }
	}

	const failed = Object.keys(test_pinned_cache_logic.tests_of(probe.failed, cache.test_digests))

	return await basis_of(cache, { ...probe, failed }, file)
}

// Whether the tree still reads as it did at `load`.
async function is_steady(cache: LoadedCache): Promise<boolean> {
	const now = await read_tree(cache.base)

	return now.change === cache.change && now.test_contents === cache.test_contents
}

// Each `green` hunk among `probes` is recorded, with the code change those hunks reverted.
function write(
	cache: LoadedCache,
	entries: Record<string, StoredVerdict>,
	probes: ReadonlyArray<RedProbe | undefined>,
): void {
	const { code, contents, hunks } = cache
	const reached = test_pinned_prune_logic.greens_reached(
		hunks,
		probes.map((probe) => probe?.verdict),
	)
	const green = reached.map((hunk) => test_pinned_prune_logic.record_of(hunk))
	const pruned = test_pinned_prune_logic.pruned_of(code, contents, reached, green)
	const content: VerdictCache = {
		test_contents: cache.test_contents,
		change: cache.change,
		entries,
		pruned,
		green,
	}

	atomic_write.replace_file(cache.file, `${JSON.stringify(content)}${LINE_BREAK}`)
}

// **Each verdict is written as soon as it is reached** (joshuafolkken/kit#4936), so a run stopped
// mid-way — `josh run:review` stops one a round-1 fix moved the tree under — leaves the verdicts it
// already had for the next run to reuse. The writes are queued one after another, and each replaces the
// file whole, so a stopped run leaves either write, never half of one.
//
// **A basis is read once its verdict is reached, and kept only while the tree still reads as it did at
// `load`**: one read off an edit made mid-run would hold a verdict the probes never saw. A verdict
// reached before the edit keeps the basis it was written with.
//
// Only the verdicts this run used are written, so the file never holds a hunk the branch has left behind.
async function settle(state: WriterState, reached: ReadonlyArray<Reached>): Promise<void> {
	const { cache, keys, files, probes, bases } = state
	const read = await Promise.all(
		reached.map(
			async ([index, probe]) =>
				await stored_basis(cache, keys[index] ?? '', probe, files[index] ?? ''),
		),
	)
	const is_kept = await is_steady(cache)

	for (const [position, [index, probe]] of reached.entries()) {
		probes[index] = probe
		bases[index] = is_kept ? read[position] : undefined
	}

	write(cache, test_pinned_cache_logic.stored(keys, probes, cache.test_digests, bases), probes)
}

// `keys` name the hunks `load` was given, in their order.
function writer(cache: LoadedCache, keys: ReadonlyArray<string>): CacheWriter {
	const files = cache.hunks.map((hunk) => hunk.file)
	const state: WriterState = { cache, keys, files, probes: [], bases: [] }
	const queue = { last: Promise.resolve() }

	async function record(reached: ReadonlyArray<Reached>): Promise<void> {
		const previous = queue.last
		const current = (async (): Promise<void> => {
			await previous
			await settle(state, reached)
		})()

		queue.last = current
		await current
	}

	return { record }
}

const test_pinned_cache = { known, load, writer }

export type { CacheWriter, LoadedCache, Reached }
export { test_pinned_cache }
