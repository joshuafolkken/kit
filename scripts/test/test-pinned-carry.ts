import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { atomic_write } from '#scripts/lib/atomic-write'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import { test_pinned_cache, type LoadedCache } from './test-pinned-cache'
import { test_pinned_cache_logic } from './test-pinned-cache-logic'
import { test_pinned_logic, type Hunk } from './test-pinned-logic'

const CARRY_NAME = 'josh-test-pinned-carry.json'
const SCHEMA = z.object({ tree: z.string(), pending: z.array(z.string()) })

function tree_of(cache: LoadedCache): string {
	return test_pinned_cache_logic.digest_of(`${cache.change}:${cache.test_contents}`)
}

function file_of(cache: LoadedCache): string {
	return path.join(path.dirname(cache.file), CARRY_NAME)
}

async function pending_of(cache: LoadedCache): Promise<ReadonlyArray<string>> {
	try {
		const text = await readFile(file_of(cache), 'utf8')
		const stored = json_value.parse_with(text, SCHEMA)

		return stored?.tree === tree_of(cache) ? stored.pending : []
	} catch {
		return []
	}
}

function keys_of(cache: LoadedCache): Array<string> {
	return test_pinned_cache_logic.distinct(
		cache.hunks.map((hunk) =>
			test_pinned_cache_logic.hunk_key(hunk, cache.contents.get(hunk.file) ?? ''),
		),
	)
}

type Known = Awaited<ReturnType<typeof test_pinned_cache.known>>[number]
type Selection = ReturnType<typeof test_pinned_logic.split>

function is_held(known: Known): boolean {
	return known !== undefined && !test_pinned_cache_logic.is_recheck(known)
}

function keyed_of(cache: LoadedCache): ReadonlyMap<Hunk, string> {
	const identifiers = keys_of(cache)

	return new Map(cache.hunks.map((hunk, index) => [hunk, identifiers[index] ?? '']))
}

function keys(cache: LoadedCache, hunks: ReadonlyArray<Hunk>): Array<string> {
	const keyed = keyed_of(cache)

	return hunks.map((hunk) => keyed.get(hunk) ?? '')
}

function ordered_of(cache: LoadedCache, pending: ReadonlySet<string>): Array<Hunk> {
	const keyed = keyed_of(cache)

	return cache.hunks.toSorted(
		(left, right) =>
			Number(pending.has(keyed.get(right) ?? '')) - Number(pending.has(keyed.get(left) ?? '')),
	)
}

// Held verdicts consume no fresh-probe slots; only matching current hunk keys can be prioritized.
async function select(cache: LoadedCache, max_hunks: number): Promise<Selection> {
	const identifiers = keys_of(cache)
	const pending = new Set(await pending_of(cache))
	const known = await test_pinned_cache.known(
		cache,
		identifiers,
		cache.hunks.map((hunk) => hunk.file),
	)
	const held = cache.hunks.filter((_hunk, index) => is_held(known[index]))
	const held_set = new Set(held)
	const ordered = ordered_of(cache, pending).filter((hunk) => !held_set.has(hunk))
	const split = test_pinned_logic.split(ordered, max_hunks)

	return { checked: [...held, ...split.checked], unchecked: split.unchecked }
}

function record(cache: LoadedCache, hunks: ReadonlyArray<Hunk>): void {
	const pending = keys(cache, hunks)

	atomic_write.replace_file(file_of(cache), JSON.stringify({ tree: tree_of(cache), pending }))
}

const test_pinned_carry = { select, record, keys }

export { test_pinned_carry }
