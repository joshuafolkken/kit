import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_spawn } from '#scripts/git/git-spawn'
import { test_declared_logic } from './test-declared-logic'
import {
	test_pinned_cache_logic,
	type Freshness,
	type VerdictCache,
} from './test-pinned-cache-logic'
import type { RedProbe } from './test-red-logic'

// The reads and writes of `josh test:pinned`'s verdict cache (joshuafolkken/kit#4706); what a key is and
// when an entry holds is `test-pinned-cache-logic.ts`. `josh run:review` calls the same `test_pinned.run`,
// so the two share it.
//
// **The cache sits in the checkout's own git directory** (`git rev-parse --git-path`, per worktree), so
// a lane never reads another lane's verdicts, and nothing is written into the work tree.

const CACHE_NAME = 'josh-test-pinned-verdicts.json'
const LINE_BREAK = '\n'
const NUL = '\0'
// Peels a ref or tag to the commit it names, so a branch name and its SHA key the same change.
const AS_COMMIT = '^{commit}'

interface LoadedCache extends VerdictCache {
	file: string
	freshness: Freshness
	test_digests: ReadonlyMap<string, string>
}

async function read_text(file: string): Promise<string> {
	return existsSync(file) ? await readFile(file, 'utf8') : ''
}

// Every test file in the work tree, tracked or untracked but not ignored. `-z` lists a path as it is,
// where `core.quotePath` would quote a non-ASCII one.
async function test_files(): Promise<Array<string>> {
	const listed = await git_spawn.read(['ls-files', '-coz', '--exclude-standard'])

	return listed.split(NUL).filter((file) => test_declared_logic.is_test_file(file))
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

// The code change: `base` as a commit, and every non-test path changed since it with its content. A
// test file is left out — a `red` rests on the test files it failed in, not on every test.
async function change_digest(base: string): Promise<string> {
	const [commit, paths] = await Promise.all([
		git_spawn.read(['rev-parse', '--verify', `${base}${AS_COMMIT}`]),
		changed_paths.read_changed_since(base),
	])
	const code = paths.filter((file) => !test_declared_logic.is_test_file(file))

	return test_pinned_cache_logic.change_of(commit.trim(), code, await digests_of(code))
}

async function load(base: string): Promise<LoadedCache> {
	const file = path.resolve(await git_spawn.read(['rev-parse', '--git-path', CACHE_NAME]))
	const [text, test_digests, change] = await Promise.all([
		read_text(file),
		test_digests_of(),
		change_digest(base),
	])
	const test_contents = contents_digest(test_digests)
	const entries = test_pinned_cache_logic.entries_of(text)
	const freshness = test_pinned_cache_logic.freshness_of(text, { change, test_contents })

	return { file, test_contents, change, entries, freshness, test_digests }
}

// The verdict stored under each key, or `undefined` where none is stored or what it rests on changed.
function known(cache: LoadedCache, keys: ReadonlyArray<string>): Array<RedProbe | undefined> {
	return keys.map((key) =>
		test_pinned_cache_logic.fresh_verdict(cache.entries[key], cache.freshness, cache.test_digests),
	)
}

// Only the verdicts this run used are written, so the file never holds a hunk the branch has left behind.
async function save(
	cache: LoadedCache,
	keys: ReadonlyArray<string>,
	probes: ReadonlyArray<RedProbe | undefined>,
): Promise<void> {
	const content: VerdictCache = {
		test_contents: cache.test_contents,
		change: cache.change,
		entries: test_pinned_cache_logic.stored(keys, probes, cache.test_digests),
	}

	await mkdir(path.dirname(cache.file), { recursive: true })
	await writeFile(cache.file, `${JSON.stringify(content)}${LINE_BREAK}`)
}

const test_pinned_cache = { known, load, save }

export type { LoadedCache }
export { test_pinned_cache }
