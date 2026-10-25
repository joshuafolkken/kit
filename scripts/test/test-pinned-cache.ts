import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_spawn } from '#scripts/git/git-spawn'
import { OBSERVATION_LEDGER_DIRECTORY } from '#scripts/observations/observation-ledger'
import { release_approval_prune } from '#scripts/release/release-approval-prune'
import { test_declared_logic } from './test-declared-logic'
import {
	test_pinned_cache_logic,
	type Freshness,
	type VerdictCache,
} from './test-pinned-cache-logic'
import { test_pinned_reach, type Reach, type ReachInputs } from './test-pinned-reach'
import type { RedProbe } from './test-red-logic'

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
// The ledger's own directory only: its legacy paths sit under `docs/`, which a test does read.
const OBSERVATION_PREFIX = `${OBSERVATION_LEDGER_DIRECTORY}/`

interface TreeRead {
	test_digests: ReadonlyMap<string, string>
	code: Omit<ReachInputs, 'test_digests'>
	test_contents: string
	change: string
}

interface LoadedCache extends VerdictCache {
	file: string
	base: string
	freshness: Freshness
	test_digests: ReadonlyMap<string, string>
	reach: Reach
}

async function read_text(file: string): Promise<string> {
	return existsSync(file) ? await readFile(file, 'utf8') : ''
}

// Every test file in the work tree, tracked or untracked but not ignored.
async function test_files(): Promise<Array<string>> {
	const listed = await test_pinned_reach.work_tree_files()

	return listed.filter((file) => test_declared_logic.is_test_file(file))
}

// The digest of each named file the work tree still holds.
async function digests_of(files: ReadonlyArray<string>): Promise<Map<string, string>> {
	const existing = [...new Set(files)].filter((file) => existsSync(file))
	const texts = await Promise.all(existing.map(async (file) => await readFile(file, 'utf8')))
	const digests = texts.map((text) => test_pinned_cache_logic.digest_of(text))

	return new Map(existing.map((file, index) => [file, digests[index] ?? '']))
}

// Each test file's content digest, keyed by its path.
async function test_digests_of(): Promise<Map<string, string>> {
	return await digests_of(await test_files())
}

// One digest over every test file's path and content.
function contents_digest(digests: ReadonlyMap<string, string>): string {
	return test_pinned_cache_logic.test_set_of(
		[...digests].map(([file, digest]) => `${file} ${digest}`),
	)
}

// A run's own record — an observation line or a `josh metrics` approval — which no test reads, so one
// written after a probe keeps its `red` (joshuafolkken/kit#4856).
function is_run_record(file: string): boolean {
	return release_approval_prune.is_approval(file) || file.startsWith(OBSERVATION_PREFIX)
}

// The code change: `base` as a commit, and every non-test path changed since it with its content. A
// test file is left out — a `red` rests on the test files it failed in, not on every test — and so is
// a run record.
async function code_change(base: string): Promise<Omit<ReachInputs, 'test_digests'>> {
	const [commit, paths] = await Promise.all([
		git_spawn.read(['rev-parse', '--verify', `${base}${AS_COMMIT}`]),
		changed_paths.read_changed_since(base),
	])
	const code = paths.filter(
		(file) => !test_declared_logic.is_test_file(file) && !is_run_record(file),
	)

	return { commit: commit.trim(), code, digests: await digests_of(code) }
}

// The work tree's tree-wide digests, with what they were read off.
async function read_tree(base: string): Promise<TreeRead> {
	const [test_digests, code] = await Promise.all([test_digests_of(), code_change(base)])
	const test_contents = contents_digest(test_digests)
	const change = test_pinned_cache_logic.change_of(code.commit, code.code, code.digests)

	return { test_digests, code, test_contents, change }
}

async function load(base: string): Promise<LoadedCache> {
	const file = path.resolve(await git_spawn.read(['rev-parse', '--git-path', CACHE_NAME]))
	const [text, tree] = await Promise.all([read_text(file), read_tree(base)])
	const { test_digests, code, test_contents, change } = tree
	const entries = test_pinned_cache_logic.entries_of(text)
	const freshness = test_pinned_cache_logic.freshness_of(text, { change, test_contents })
	const reach = test_pinned_reach.create({ ...code, test_digests })

	return { file, base, test_contents, change, entries, freshness, test_digests, reach }
}

// What a verdict on a hunk of `file` rests on now: the failed tests' closures for a `red`, the tests
// reaching `file` for any other.
async function basis_of(
	cache: LoadedCache,
	probe: RedProbe,
	file: string,
): Promise<string | undefined> {
	if (probe.verdict !== 'red') return await cache.reach.related(file)

	return await cache.reach.failed(probe.failed)
}

// The tree-wide digests first; only an entry they drop has its basis read, so an unchanged tree builds
// no import graph.
async function known_one(
	cache: LoadedCache,
	key: string,
	file: string,
): Promise<RedProbe | undefined> {
	const entry = cache.entries[key]
	const kept = test_pinned_cache_logic.fresh_verdict(entry, cache.freshness, cache.test_digests)
	if (kept !== undefined || entry?.basis === undefined) return kept
	const stored = { verdict: entry.verdict, failed: Object.keys(entry.tests) }
	const basis = await basis_of(cache, stored, file)

	return test_pinned_cache_logic.fresh_verdict(entry, cache.freshness, cache.test_digests, basis)
}

// The verdict stored under each key, or `undefined` where none is stored or what it rests on changed;
// `files` names each key's hunk file.
async function known(
	cache: LoadedCache,
	keys: ReadonlyArray<string>,
	files: ReadonlyArray<string>,
): Promise<Array<RedProbe | undefined>> {
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
): Promise<string | undefined> {
	const entry = cache.entries[key]
	const kept = test_pinned_cache_logic.fresh_verdict(entry, cache.freshness, cache.test_digests)
	if (kept?.verdict === probe.verdict) return entry?.basis
	const failed = Object.keys(test_pinned_cache_logic.tests_of(probe.failed, cache.test_digests))

	return await basis_of(cache, { ...probe, failed }, file)
}

async function read_bases(
	cache: LoadedCache,
	keys: ReadonlyArray<string>,
	probes: ReadonlyArray<RedProbe | undefined>,
	files: ReadonlyArray<string>,
): Promise<Array<string | undefined>> {
	return await Promise.all(
		keys.map(async (key, index) => {
			const probe = probes[index]

			return probe === undefined
				? undefined
				: await stored_basis(cache, key, probe, files[index] ?? '')
		}),
	)
}

// **A basis is read after the probes, so it is kept only while the tree still reads as it did at
// `load`**: one read off an edit made mid-run would hold a verdict the probes never saw.
async function bases_of(
	cache: LoadedCache,
	keys: ReadonlyArray<string>,
	probes: ReadonlyArray<RedProbe | undefined>,
	files: ReadonlyArray<string>,
): Promise<Array<string | undefined>> {
	const bases = await read_bases(cache, keys, probes, files)
	const now = await read_tree(cache.base)
	const is_steady = now.change === cache.change && now.test_contents === cache.test_contents

	return is_steady ? bases : []
}

// Only the verdicts this run used are written, so the file never holds a hunk the branch has left behind.
async function save(
	cache: LoadedCache,
	keys: ReadonlyArray<string>,
	probes: ReadonlyArray<RedProbe | undefined>,
	files: ReadonlyArray<string>,
): Promise<void> {
	const bases = await bases_of(cache, keys, probes, files)
	const content: VerdictCache = {
		test_contents: cache.test_contents,
		change: cache.change,
		entries: test_pinned_cache_logic.stored(keys, probes, cache.test_digests, bases),
	}

	await mkdir(path.dirname(cache.file), { recursive: true })
	await writeFile(cache.file, `${JSON.stringify(content)}${LINE_BREAK}`)
}

const test_pinned_cache = { known, load, save }

export type { LoadedCache }
export { test_pinned_cache }
