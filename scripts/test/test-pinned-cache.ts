import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { git_spawn } from '#scripts/git/git-spawn'
import { test_declared_logic } from './test-declared-logic'
import {
	test_pinned_cache_logic,
	type CachedVerdict,
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

interface LoadedCache {
	file: string
	test_set: string
	test_contents: string
	entries: Record<string, CachedVerdict>
	// No test file's content changed since the cache was written.
	is_unchanged: boolean
}

async function read_text(file: string): Promise<string> {
	return existsSync(file) ? await readFile(file, 'utf8') : ''
}

// Every test file in the work tree, tracked or untracked but not ignored.
async function test_files(): Promise<Array<string>> {
	const listed = await git_spawn.read(['ls-files', '-co', '--exclude-standard'])

	return listed.split(LINE_BREAK).filter((file) => test_declared_logic.is_test_file(file))
}

// The digest of each named test file the work tree still holds.
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

async function load(): Promise<LoadedCache> {
	const file = path.resolve(await git_spawn.read(['rev-parse', '--git-path', CACHE_NAME]))
	const files = await test_files()
	const [text, test_contents] = await Promise.all([read_text(file), contents_digest(files)])
	const test_set = test_pinned_cache_logic.test_set_of(files)
	const entries = test_pinned_cache_logic.entries_of(text, test_set)
	const is_unchanged = test_pinned_cache_logic.contents_of(text) === test_contents

	return { file, test_set, test_contents, entries, is_unchanged }
}

// The entry stored under each key, or `undefined` where none is stored or a test it rests on changed.
async function known(
	cache: LoadedCache,
	keys: ReadonlyArray<string>,
): Promise<Array<CachedVerdict | undefined>> {
	const entries = keys.map((key) => cache.entries[key])
	const digests = await digests_of(entries.flatMap((entry) => Object.keys(entry?.tests ?? {})))

	return entries.map((entry) =>
		test_pinned_cache_logic.fresh_entry(entry, digests, cache.is_unchanged),
	)
}

async function entry_for(
	verdict: RedVerdict,
	tests: ReadonlyArray<string>,
): Promise<CachedVerdict> {
	return { verdict, tests: Object.fromEntries(await digests_of(tests)) }
}

// Only the entries this run used are written, so the file never holds a hunk the branch has left behind.
async function save(cache: LoadedCache, entries: Record<string, CachedVerdict>): Promise<void> {
	const content: VerdictCache = {
		test_set: cache.test_set,
		test_contents: cache.test_contents,
		entries,
	}

	await mkdir(path.dirname(cache.file), { recursive: true })
	await writeFile(cache.file, `${JSON.stringify(content)}${LINE_BREAK}`)
}

const test_pinned_cache = { entry_for, known, load, save }

export type { LoadedCache }
export { test_pinned_cache }
