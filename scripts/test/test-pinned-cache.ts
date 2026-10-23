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
import type { RedVerdict } from './test-red-logic'

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

interface LoadedCache extends Omit<VerdictCache, 'entries'> {
	file: string
	entries: Record<string, RedVerdict>
	freshness: Freshness
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

// One digest over every test file's path and content.
async function contents_digest(files: ReadonlyArray<string>): Promise<string> {
	const digests = await digests_of(files)

	return test_pinned_cache_logic.test_set_of(
		[...digests].map(([file, digest]) => `${file} ${digest}`),
	)
}

// The whole change: `base` as a commit, and every path changed since it with its content.
async function change_digest(base: string): Promise<string> {
	const [commit, paths] = await Promise.all([
		git_spawn.read(['rev-parse', '--verify', `${base}${AS_COMMIT}`]),
		changed_paths.read_changed_since(base),
	])

	return test_pinned_cache_logic.change_of(commit.trim(), paths, await digests_of(paths))
}

async function load(base: string): Promise<LoadedCache> {
	const file = path.resolve(await git_spawn.read(['rev-parse', '--git-path', CACHE_NAME]))
	const files = await test_files()
	const [text, test_contents, change] = await Promise.all([
		read_text(file),
		contents_digest(files),
		change_digest(base),
	])
	const test_set = test_pinned_cache_logic.test_set_of(files)
	const entries = test_pinned_cache_logic.entries_of(text, test_set)
	const freshness = test_pinned_cache_logic.freshness_of(text, { change, test_contents })

	return { file, test_set, test_contents, change, entries, freshness }
}

// The verdict stored under each key, or `undefined` where none is stored or what it rests on changed.
function known(cache: LoadedCache, keys: ReadonlyArray<string>): Array<RedVerdict | undefined> {
	return keys.map((key) =>
		test_pinned_cache_logic.fresh_verdict(cache.entries[key], cache.freshness),
	)
}

// Only the verdicts this run used are written, so the file never holds a hunk the branch has left behind.
async function save(cache: LoadedCache, entries: Record<string, RedVerdict>): Promise<void> {
	const content: VerdictCache = {
		test_set: cache.test_set,
		test_contents: cache.test_contents,
		change: cache.change,
		entries,
	}

	await mkdir(path.dirname(cache.file), { recursive: true })
	await writeFile(cache.file, `${JSON.stringify(content)}${LINE_BREAK}`)
}

const test_pinned_cache = { known, load, save }

export type { LoadedCache }
export { test_pinned_cache }
