import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { RECORD, reuse_operations } from '#scripts/gate/reuse-operations-fixture'
import {
	ESLINT_CONFIG,
	LOCKFILE,
	reuse_world,
	TSCONFIG,
	type World,
} from '#scripts/gate/reuse-world-fixture'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import fc from 'fast-check'
import { parse, stringify } from 'flatted'
import { describe, expect, it, vi } from 'vitest'
import { eslint_cache_dependencies } from './eslint-cache-dependencies'
import { eslint_daemon } from './eslint-daemon'
import { reuse_disk, type Disk } from './reuse-disk-fixture'

// joshuafolkken/kit#4494: the ESLint side of reusing a verdict — a cached entry answers for a file
// whose imports changed underneath it (#4407, #4415), and a warm daemon keeps the types a merge
// replaced (#4443). The edits of `reuse-verdicts.test.ts` are written to a real project here, and
// after every step the cache guard has to keep exactly the entries whose reads are unchanged, and the
// daemon has to restart exactly when its configuration or the merged sources moved.
//
// **An entry reads every file its imports reach, every ambient declaration and the tsconfig** — its
// own content is eslint's own cache key, so the guard leaves it to eslint. A `.d.ts` with no module
// statement and a module declaring `global` reach every file without being imported. The daemon reads
// the eslint config and the lockfile, and its type program the tsconfig, which it never watches; a
// source edit reaches it through the edit hook, a merge only through the HEAD reflog.

const MAX_STEPS = 20
const NUM_RUNS = 25
const CACHE_FILE = '.eslintcache'
const ABSENT = '<absent>'
const LINTED_KINDS: ReadonlySet<string> = new Set(['module', 'declaration', 'globals'])
const AMBIENT_KINDS: ReadonlySet<string> = new Set(['declaration', 'globals'])
const DAEMON_INPUTS: ReadonlyArray<string> = [ESLINT_CONFIG, LOCKFILE, TSCONFIG]

interface Walk {
	world: World
	disk: Disk
	// What each cached entry's verdict read, as `closure` renders it.
	linted: Map<string, string>
	daemon_started: number
}

interface Verdicts {
	kept: ReadonlyArray<string>
	daemon_restarts: boolean
}

interface CacheEntry {
	key: string
	// `content` stands in for eslint's own content key: the file as it was when this verdict was made.
	value: { data: Record<string, unknown>; content?: string | undefined }
}

vi.spyOn(git_spawn_sync, 'read').mockReturnValue(reuse_disk.HEAD_REFLOG)

function reached(world: World, start: string): ReadonlyArray<string> {
	const seen = new Set([start])
	const pending = [start]

	for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
		const fresh = (world.imports.get(current) ?? []).filter((relative) => !seen.has(relative))

		for (const relative of fresh) seen.add(relative)
		pending.push(...fresh)
	}

	return [...seen]
}

function files_of(world: World, kinds: ReadonlySet<string>): ReadonlyArray<string> {
	return [...world.contents.keys()].filter((relative) => kinds.has(reuse_world.kind_of(relative)))
}

function closure(world: World, file: string): string {
	const read = new Set([...reached(world, file), ...files_of(world, AMBIENT_KINDS), TSCONFIG])

	read.delete(file)

	const contents = [...read]
		.toSorted(reuse_world.by_name)
		.map((relative) => [relative, world.contents.get(relative) ?? ABSENT])

	return JSON.stringify(contents)
}

function is_entry(item: unknown): item is CacheEntry {
	return typeof item === 'object' && item !== null && 'key' in item && typeof item.key === 'string'
}

function read_entries(cache: string): ReadonlyArray<CacheEntry> {
	try {
		const parsed: unknown = parse(readFileSync(cache, 'utf8'))

		return Array.isArray(parsed) ? parsed.filter((item) => is_entry(item)) : []
	} catch {
		return []
	}
}

function linted_entry(walk: Walk, relative: string): CacheEntry {
	const content = walk.world.contents.get(relative)

	return { key: path.join(walk.disk.root, relative), value: { data: {}, content } }
}

// eslint re-lints a kept entry whose own content changed and replaces its data whole.
function lint_again_if_changed(walk: Walk, entry: CacheEntry): CacheEntry {
	const relative = path.relative(walk.disk.root, entry.key)

	if (entry.value.content === walk.world.contents.get(relative)) return entry

	return linted_entry(walk, relative)
}

// eslint's part of a cached run: re-lint every kept entry whose own content changed, and lint every
// source file the cache holds no verdict for.
function lint(walk: Walk, cache: string): ReadonlyArray<string> {
	const entries = read_entries(cache)
	const kept = entries.map((entry) => path.relative(walk.disk.root, entry.key))
	const added = files_of(walk.world, LINTED_KINDS)
		.filter((relative) => !kept.includes(relative))
		.map((relative) => linted_entry(walk, relative))
	const refreshed = entries.map((entry) => lint_again_if_changed(walk, entry))

	writeFileSync(cache, stringify([...refreshed, ...added]))

	return kept
}

async function actual_verdicts(walk: Walk): Promise<Verdicts> {
	const { root } = walk.disk
	const cache = path.join(root, CACHE_FILE)
	const kept = await eslint_cache_dependencies.guard(
		CACHE_FILE,
		async () => lint(walk, cache),
		root,
	)
	const newest = eslint_daemon.newest_config_mtime(root)

	return {
		kept: kept.toSorted(reuse_world.by_name),
		daemon_restarts: eslint_daemon.is_stale(walk.daemon_started, newest),
	}
}

function has_daemon_input_moved(world: World): boolean {
	const { recorded } = world
	const has_config_moved = DAEMON_INPUTS.some(
		(relative) => recorded.contents.get(relative) !== world.contents.get(relative),
	)

	return has_config_moved || recorded.base !== world.upstream.length
}

function expected_verdicts(walk: Walk): Verdicts {
	const kept = [...walk.linted].filter(([file, read]) => closure(walk.world, file) === read)

	return {
		kept: kept.map(([file]) => file).toSorted(reuse_world.by_name),
		daemon_restarts: has_daemon_input_moved(walk.world),
	}
}

// What the cache holds after the run: the entries it kept and every source file it linted afresh,
// each having read what it reads now.
function remember(walk: Walk, kept: ReadonlyArray<string>): void {
	const cached = new Set([...kept, ...files_of(walk.world, LINTED_KINDS)])

	walk.linted = new Map([...cached].map((file) => [file, closure(walk.world, file)]))
}

async function take(
	walk: Walk,
	choice: readonly [number, number],
	trace: Array<string>,
): Promise<void> {
	const step = reuse_operations.step_of(walk.world, choice)

	trace.push(step.name)
	step.apply()
	reuse_disk.sync(walk.disk, walk.world)
	if (step.name === RECORD) walk.daemon_started = reuse_disk.ms_at(walk.disk.tick)
	const expected = expected_verdicts(walk)
	const actual = await actual_verdicts(walk)

	expect(actual, `after ${trace.join(' → ')}`).toStrictEqual(expected)
	remember(walk, actual.kept)
}

async function start_walk(): Promise<Walk> {
	const world = reuse_world.create_world()
	const disk = reuse_disk.create_disk()
	const walk: Walk = { world, disk, linted: new Map(), daemon_started: 0 }

	reuse_disk.sync(disk, world)
	walk.daemon_started = reuse_disk.ms_at(disk.tick)
	const { kept } = await actual_verdicts(walk)

	remember(walk, kept)

	return walk
}

async function walk_through(choices: ReadonlyArray<readonly [number, number]>): Promise<void> {
	const walk = await start_walk()
	const trace: Array<string> = []

	try {
		for (const choice of choices) {
			// eslint-disable-next-line no-await-in-loop -- each step is chosen from the world the one before it left
			await take(walk, choice, trace)
		}
	} finally {
		reuse_disk.dispose(walk.disk)
	}
}

describe('reusing an ESLint verdict — the cache guard and the daemon agree with the reference model', () => {
	it('keeps an entry and a warm daemon only while nothing they read moved', async () => {
		const steps = { minLength: 1, maxLength: MAX_STEPS, size: 'max' } as const
		const step = fc.tuple(fc.nat(), fc.nat())
		const choices = fc.noBias(fc.array(step, steps))

		await expect(
			fc.assert(fc.asyncProperty(choices, walk_through), { numRuns: NUM_RUNS }),
		).resolves.toBeUndefined()
	})
})
